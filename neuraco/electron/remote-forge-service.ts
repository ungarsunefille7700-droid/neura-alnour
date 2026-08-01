import path from 'node:path';
import type {
  NeuraCoForgeConnection,
  NeuraCoForgeInbox,
  NeuraCoForgeInboxItem,
  NeuraCoForgeIssue,
  NeuraCoForgeProvider,
  NeuraCoForgePullRequestCreate,
  NeuraCoForgePullRequestResult,
  NeuraCoProject
} from './ipc-contract';
import { runProcess } from './git-service';
import { redactSecrets } from './secret-redaction';

const MAX_REMOTE_OUTPUT = 2_000_000;
const MAX_ITEMS = 180;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

type CommandRunner = (
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
  extraEnv?: NodeJS.ProcessEnv
) => Promise<CommandResult>;

interface RemoteRepository {
  provider: NeuraCoForgeProvider;
  repository: string;
  remoteUrl: string;
  cli: 'gh' | 'glab';
}

interface RemoteForgeServiceOptions {
  runCommand?: CommandRunner;
}

const safeText = (value: unknown, maximum = 8_000): string => (
  redactSecrets(String(value || '')).trim().slice(0, maximum)
);

const safeDate = (value: unknown): string | undefined => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
};

const toArray = (value: unknown): Array<Record<string, unknown>> => (
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    ))
    : []
);

export const parseForgeRemote = (remoteUrl: string): RemoteRepository | null => {
  const raw = remoteUrl.trim();
  if (!raw) return null;
  const ssh = raw.match(/^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/i);
  let host = '';
  let repository = '';
  if (ssh) {
    host = ssh[1].toLowerCase();
    repository = ssh[2];
  } else {
    try {
      const parsed = new URL(raw);
      host = parsed.hostname.toLowerCase();
      repository = parsed.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }
  repository = repository.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  if (!repository || repository.split('/').length < 2 || repository.includes('..')) {
    return null;
  }
  if (host === 'github.com' || host.endsWith('.github.com')) {
    return { provider: 'github', repository, remoteUrl: raw, cli: 'gh' };
  }
  if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) {
    return { provider: 'gitlab', repository, remoteUrl: raw, cli: 'glab' };
  }
  return null;
};

const commandFailure = (result: CommandResult, fallback: string): string => {
  const detail = safeText(result.stderr || result.stdout, 1_000);
  return detail || fallback;
};

const normalizeState = (value: unknown, fallback = 'open'): string => (
  safeText(value, 40).toLowerCase() || fallback
);

const githubIssueItems = (records: Array<Record<string, unknown>>): NeuraCoForgeInboxItem[] => (
  records.map((record) => {
    const pullRequest = Boolean(record.pull_request);
    const number = Number(record.number);
    return {
      id: `github:${pullRequest ? 'pull_request' : 'issue'}:${number}`,
      kind: pullRequest ? 'pull_request' : 'issue',
      number: Number.isInteger(number) ? number : undefined,
      title: safeText(record.title, 500) || 'Sans titre',
      summary: safeText(record.body, 1_000),
      state: normalizeState(record.state),
      url: safeText(record.html_url, 2_000) || undefined,
      author: safeText(
        (record.user as Record<string, unknown> | undefined)?.login,
        200
      ) || undefined,
      updatedAt: safeDate(record.updated_at),
      requiresReview: true
    };
  })
);

const githubCommentItems = (records: Array<Record<string, unknown>>): NeuraCoForgeInboxItem[] => (
  records.map((record) => {
    const issueUrl = safeText(record.issue_url, 2_000);
    const issueNumber = Number(issueUrl.split('/').pop());
    return {
      id: `github:comment:${safeText(record.id, 120)}`,
      kind: 'comment',
      number: Number.isInteger(issueNumber) ? issueNumber : undefined,
      title: Number.isInteger(issueNumber)
        ? `Nouveau commentaire sur #${issueNumber}`
        : 'Nouveau commentaire',
      summary: safeText(record.body, 1_000),
      state: 'unread',
      url: safeText(record.html_url, 2_000) || undefined,
      author: safeText(
        (record.user as Record<string, unknown> | undefined)?.login,
        200
      ) || undefined,
      updatedAt: safeDate(record.updated_at || record.created_at),
      requiresReview: true
    };
  })
);

const githubCiItems = (records: Array<Record<string, unknown>>): NeuraCoForgeInboxItem[] => (
  records
    .filter((record) => ['failure', 'cancelled', 'timed_out', 'action_required']
      .includes(normalizeState(record.conclusion, '')))
    .map((record) => ({
      id: `github:ci:${safeText(record.id, 120)}`,
      kind: 'ci',
      title: safeText(record.name, 500) || 'Échec CI GitHub',
      summary: `Workflow ${safeText(record.display_title, 500) || 'sans titre'} sur ${
        safeText(record.head_branch, 200) || 'branche inconnue'
      }.`,
      state: normalizeState(record.conclusion, 'failure'),
      url: safeText(record.html_url, 2_000) || undefined,
      branch: safeText(record.head_branch, 200) || undefined,
      updatedAt: safeDate(record.updated_at),
      requiresReview: true
    }))
);

const githubAlertItems = (
  records: Array<Record<string, unknown>>,
  kind: 'security' | 'dependency'
): NeuraCoForgeInboxItem[] => records.map((record) => {
  const rule = record.rule as Record<string, unknown> | undefined;
  const advisory = record.security_advisory as Record<string, unknown> | undefined;
  const dependency = record.dependency as Record<string, unknown> | undefined;
  const pkg = dependency?.package as Record<string, unknown> | undefined;
  const number = Number(record.number);
  const title = safeText(
    advisory?.summary || rule?.description || pkg?.name,
    500
  ) || (kind === 'dependency' ? 'Dépendance vulnérable' : 'Alerte de sécurité');
  return {
    id: `github:${kind}:${Number.isInteger(number) ? number : safeText(record.id, 120)}`,
    kind,
    number: Number.isInteger(number) ? number : undefined,
    title,
    summary: safeText(
      advisory?.description || rule?.name || record.dismissed_reason,
      1_000
    ),
    state: normalizeState(record.state),
    url: safeText(record.html_url, 2_000) || undefined,
    updatedAt: safeDate(record.updated_at || record.created_at),
    requiresReview: true
  };
});

const gitlabBasicItems = (
  records: Array<Record<string, unknown>>,
  kind: 'issue' | 'pull_request'
): NeuraCoForgeInboxItem[] => records.map((record) => {
  const number = Number(record.iid);
  return {
    id: `gitlab:${kind}:${number}`,
    kind,
    number: Number.isInteger(number) ? number : undefined,
    title: safeText(record.title, 500) || 'Sans titre',
    summary: safeText(record.description, 1_000),
    state: normalizeState(record.state),
    url: safeText(record.web_url, 2_000) || undefined,
    author: safeText(
      (record.author as Record<string, unknown> | undefined)?.username,
      200
    ) || undefined,
    branch: kind === 'pull_request'
      ? safeText(record.source_branch, 200) || undefined
      : undefined,
    updatedAt: safeDate(record.updated_at),
    requiresReview: true
  };
});

const gitlabCiItems = (records: Array<Record<string, unknown>>): NeuraCoForgeInboxItem[] => (
  records
    .filter((record) => ['failed', 'canceled', 'skipped', 'manual']
      .includes(normalizeState(record.status, '')))
    .map((record) => ({
      id: `gitlab:ci:${safeText(record.id, 120)}`,
      kind: 'ci',
      title: `Pipeline ${safeText(record.ref, 300) || 'GitLab'} en échec`,
      summary: `Statut : ${normalizeState(record.status, 'failed')}.`,
      state: normalizeState(record.status, 'failed'),
      url: safeText(record.web_url, 2_000) || undefined,
      branch: safeText(record.ref, 200) || undefined,
      updatedAt: safeDate(record.updated_at || record.created_at),
      requiresReview: true
    }))
);

export class RemoteForgeService {
  private readonly runCommand: CommandRunner;

  constructor(options: RemoteForgeServiceOptions = {}) {
    this.runCommand = options.runCommand || runProcess;
  }

  private async remote(project: NeuraCoProject): Promise<RemoteRepository | null> {
    const result = await this.runCommand('git', [
      '-c',
      `safe.directory=${path.resolve(project.rootPath).replace(/\\/g, '/')}`,
      'remote',
      'get-url',
      'origin'
    ], project.rootPath, 10_000, { GIT_TERMINAL_PROMPT: '0' });
    if (result.exitCode !== 0) return null;
    return parseForgeRemote(result.stdout);
  }

  private async execute(
    remote: RemoteRepository,
    project: NeuraCoProject,
    args: string[],
    timeoutMs = 30_000
  ): Promise<CommandResult> {
    return this.runCommand(remote.cli, args, project.rootPath, timeoutMs, {
      GIT_TERMINAL_PROMPT: '0',
      GH_PROMPT_DISABLED: '1',
      GLAB_PROMPT_DISABLED: '1',
      NO_COLOR: '1'
    });
  }

  private parseJson(result: CommandResult, action: string): unknown {
    if (result.exitCode !== 0) {
      throw new Error(commandFailure(result, `${action} a échoué.`));
    }
    if (result.stdout.length > MAX_REMOTE_OUTPUT) {
      throw new Error(`${action} a renvoyé trop de données.`);
    }
    try {
      return JSON.parse(result.stdout || 'null');
    } catch {
      throw new Error(`${action} a renvoyé une réponse JSON invalide.`);
    }
  }

  private async api(
    remote: RemoteRepository,
    project: NeuraCoProject,
    endpoint: string
  ): Promise<unknown> {
    const args = remote.provider === 'github'
      ? ['api', '--method', 'GET', endpoint]
      : ['api', endpoint];
    return this.parseJson(
      await this.execute(remote, project, args),
      `La requête ${remote.provider}`
    );
  }

  async connection(project: NeuraCoProject): Promise<NeuraCoForgeConnection> {
    const remote = await this.remote(project);
    if (!remote) {
      return {
        configured: false,
        authenticated: false,
        message: 'Le remote origin ne pointe pas vers GitHub ou GitLab.'
      };
    }
    const version = await this.execute(remote, project, ['--version'], 10_000)
      .catch(() => null);
    if (!version || version.exitCode !== 0) {
      return {
        configured: true,
        authenticated: false,
        provider: remote.provider,
        repository: remote.repository,
        remoteUrl: remote.remoteUrl,
        cli: remote.cli,
        message: `${remote.cli} doit être installé pour connecter ${remote.provider}.`
      };
    }
    const userResult = await this.api(remote, project, 'user').catch((error) => error);
    if (userResult instanceof Error) {
      return {
        configured: true,
        authenticated: false,
        provider: remote.provider,
        repository: remote.repository,
        remoteUrl: remote.remoteUrl,
        cli: remote.cli,
        message: `${remote.cli} est installé mais non authentifié.`
      };
    }
    const user = userResult as Record<string, unknown>;
    const account = safeText(user.login || user.username || user.name, 200);
    return {
      configured: true,
      authenticated: true,
      provider: remote.provider,
      repository: remote.repository,
      remoteUrl: remote.remoteUrl,
      cli: remote.cli,
      account: account || undefined,
      message: `${remote.provider === 'github' ? 'GitHub' : 'GitLab'} connecté${
        account ? ` avec ${account}` : ''
      }.`
    };
  }

  async inbox(project: NeuraCoProject): Promise<NeuraCoForgeInbox> {
    const connection = await this.connection(project);
    if (!connection.authenticated || !connection.provider || !connection.repository) {
      return {
        connection,
        items: [],
        warnings: [],
        fetchedAt: new Date().toISOString()
      };
    }
    const remote = await this.remote(project);
    if (!remote) throw new Error('Remote GitHub/GitLab introuvable.');
    const warnings: string[] = [];
    const read = async (endpoint: string): Promise<unknown> => {
      try {
        return await this.api(remote, project, endpoint);
      } catch (error) {
        warnings.push(
          safeText(error instanceof Error ? error.message : `Lecture de ${endpoint} impossible.`, 500)
        );
        return [];
      }
    };
    let items: NeuraCoForgeInboxItem[] = [];
    if (remote.provider === 'github') {
      const [issues, comments, workflows, dependabot, codeScanning] = await Promise.all([
        read(`repos/${remote.repository}/issues?state=open&per_page=50`),
        read(`repos/${remote.repository}/issues/comments?per_page=30`),
        read(`repos/${remote.repository}/actions/runs?per_page=30`),
        read(`repos/${remote.repository}/dependabot/alerts?state=open&per_page=30`),
        read(`repos/${remote.repository}/code-scanning/alerts?state=open&per_page=30`)
      ]);
      items = [
        ...githubIssueItems(toArray(issues)),
        ...githubCommentItems(toArray(comments)),
        ...githubCiItems(toArray(
          (workflows as Record<string, unknown> | undefined)?.workflow_runs
        )),
        ...githubAlertItems(toArray(dependabot), 'dependency'),
        ...githubAlertItems(toArray(codeScanning), 'security')
      ];
    } else {
      const encoded = encodeURIComponent(remote.repository);
      const [issues, mergeRequests, pipelines, vulnerabilities] = await Promise.all([
        read(`projects/${encoded}/issues?state=opened&per_page=50`),
        read(`projects/${encoded}/merge_requests?state=opened&per_page=50`),
        read(`projects/${encoded}/pipelines?per_page=30`),
        read(`projects/${encoded}/vulnerability_findings?state=detected&per_page=30`)
      ]);
      items = [
        ...gitlabBasicItems(toArray(issues), 'issue'),
        ...gitlabBasicItems(toArray(mergeRequests), 'pull_request'),
        ...gitlabCiItems(toArray(pipelines)),
        ...toArray(vulnerabilities).map((record): NeuraCoForgeInboxItem => ({
          id: `gitlab:security:${safeText(record.uuid || record.id, 120)}`,
          kind: 'security',
          title: safeText(record.name || record.title, 500) || 'Vulnérabilité GitLab',
          summary: safeText(record.description || record.message, 1_000),
          state: normalizeState(record.state, 'detected'),
          url: safeText(record.web_url, 2_000) || undefined,
          updatedAt: safeDate(record.updated_at || record.created_at),
          requiresReview: true
        }))
      ];
    }
    const unique = new Map(items.map((item) => [item.id, item]));
    return {
      connection,
      items: [...unique.values()]
        .sort((left, right) => (
          String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
        ))
        .slice(0, MAX_ITEMS),
      warnings: [...new Set(warnings)].slice(0, 8),
      fetchedAt: new Date().toISOString()
    };
  }

  async issue(project: NeuraCoProject, issueNumber: number): Promise<NeuraCoForgeIssue> {
    if (!Number.isInteger(issueNumber) || issueNumber < 1 || issueNumber > 99_999_999) {
      throw new Error('Numéro d’issue invalide.');
    }
    const remote = await this.remote(project);
    if (!remote) throw new Error('Remote GitHub/GitLab introuvable.');
    const connection = await this.connection(project);
    if (!connection.authenticated) throw new Error(connection.message);
    if (remote.provider === 'github') {
      const [rawIssue, rawComments] = await Promise.all([
        this.api(remote, project, `repos/${remote.repository}/issues/${issueNumber}`),
        this.api(
          remote,
          project,
          `repos/${remote.repository}/issues/${issueNumber}/comments?per_page=50`
        )
      ]);
      const record = rawIssue as Record<string, unknown>;
      if (record.pull_request) throw new Error('Cet élément est une pull request, pas une issue.');
      return {
        provider: remote.provider,
        repository: remote.repository,
        number: issueNumber,
        title: safeText(record.title, 500) || `Issue #${issueNumber}`,
        body: safeText(record.body, 30_000),
        state: normalizeState(record.state),
        url: safeText(record.html_url, 2_000),
        author: safeText(
          (record.user as Record<string, unknown> | undefined)?.login,
          200
        ) || undefined,
        labels: toArray(record.labels).map((label) => safeText(label.name, 100)).filter(Boolean),
        comments: toArray(rawComments).map((comment) => ({
          id: safeText(comment.id, 120),
          author: safeText(
            (comment.user as Record<string, unknown> | undefined)?.login,
            200
          ) || undefined,
          body: safeText(comment.body, 8_000),
          createdAt: safeDate(comment.created_at)
        }))
      };
    }
    const encoded = encodeURIComponent(remote.repository);
    const [rawIssue, rawNotes] = await Promise.all([
      this.api(remote, project, `projects/${encoded}/issues/${issueNumber}`),
      this.api(remote, project, `projects/${encoded}/issues/${issueNumber}/notes?per_page=50`)
    ]);
    const record = rawIssue as Record<string, unknown>;
    return {
      provider: remote.provider,
      repository: remote.repository,
      number: issueNumber,
      title: safeText(record.title, 500) || `Issue #${issueNumber}`,
      body: safeText(record.description, 30_000),
      state: normalizeState(record.state),
      url: safeText(record.web_url, 2_000),
      author: safeText(
        (record.author as Record<string, unknown> | undefined)?.username,
        200
      ) || undefined,
      labels: Array.isArray(record.labels)
        ? record.labels.map((label) => safeText(label, 100)).filter(Boolean)
        : [],
      comments: toArray(rawNotes)
        .filter((note) => !note.system)
        .map((note) => ({
          id: safeText(note.id, 120),
          author: safeText(
            (note.author as Record<string, unknown> | undefined)?.username,
            200
          ) || undefined,
          body: safeText(note.body, 8_000),
          createdAt: safeDate(note.created_at)
        }))
    };
  }

  async createPullRequest(
    project: NeuraCoProject,
    request: NeuraCoForgePullRequestCreate
  ): Promise<NeuraCoForgePullRequestResult> {
    const branch = String(request?.branch || '').trim();
    const baseBranch = String(request?.baseBranch || '').trim();
    const title = safeText(request?.title, 240);
    const body = safeText(request?.body, 30_000);
    if (
      !SAFE_BRANCH.test(branch)
      || !SAFE_BRANCH.test(baseBranch)
      || !title
      || branch === baseBranch
    ) {
      throw new Error('Paramètres de pull request invalides.');
    }
    const remote = await this.remote(project);
    if (!remote) throw new Error('Remote GitHub/GitLab introuvable.');
    const connection = await this.connection(project);
    if (!connection.authenticated) throw new Error(connection.message);
    const args = remote.provider === 'github'
      ? [
        'pr',
        'create',
        '--repo',
        remote.repository,
        '--head',
        branch,
        '--base',
        baseBranch,
        '--title',
        title,
        '--body',
        body || 'Modification préparée et validée dans NeuraCo.',
        ...(request.draft ? ['--draft'] : [])
      ]
      : [
        'mr',
        'create',
        '--repo',
        remote.repository,
        '--source-branch',
        branch,
        '--target-branch',
        baseBranch,
        '--title',
        title,
        '--description',
        body || 'Modification préparée et validée dans NeuraCo.',
        '--yes',
        ...(request.draft ? ['--draft'] : [])
      ];
    const result = await this.execute(remote, project, args, 60_000);
    if (result.exitCode !== 0) {
      throw new Error(commandFailure(result, 'La création de la pull request a échoué.'));
    }
    const url = result.stdout.match(/https:\/\/[^\s]+/)?.[0]?.replace(/[),.;]+$/, '');
    if (!url) throw new Error('La forge n’a pas renvoyé l’URL de la pull request.');
    const number = Number(url.match(/\/(?:pull|merge_requests)\/(\d+)/)?.[1]);
    return {
      provider: remote.provider,
      repository: remote.repository,
      number: Number.isInteger(number) ? number : undefined,
      title,
      url,
      branch,
      baseBranch,
      draft: Boolean(request.draft),
      createdAt: new Date().toISOString()
    };
  }
}
