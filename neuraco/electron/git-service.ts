import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { authenticatedApiRequest } from './auth-service';
import type {
  NeuraCoGitCommitResult,
  NeuraCoGitDiff,
  NeuraCoGitMergeResult,
  NeuraCoGitReview,
  NeuraCoGitStatus,
  NeuraCoGitTestCommand,
  NeuraCoGitTestResult,
  NeuraCoGitWorktree,
  NeuraCoGitWorktreeCreate,
  NeuraCoProject
} from './ipc-contract';
import { createSandboxedEnvironment } from './sandbox-environment';

const MAX_OUTPUT = 500_000;
const MAX_DIFF = 200_000;
const SAFE_NAME = /^[a-z0-9_-]{2,80}$/i;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SENSITIVE_TRACKED_FILE = /(^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[^/]+)?|credentials\.json|id_(?:rsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx))$/i;

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

interface SpecialistApiResponse {
  message: string;
  provider: string;
  model: string;
  model_display: string;
  entitlement_plan: string;
  usage?: {
    credits_consumed?: number;
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
}

interface GitServiceOptions {
  worktreeRoot: string;
  reviewChanges?: (
    body: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<SpecialistApiResponse>;
}

interface BranchValidation {
  tests?: NeuraCoGitTestResult[];
  review?: NeuraCoGitReview;
}

const appendBounded = (current: string, chunk: string): string => (
  `${current}${chunk}`.slice(-MAX_OUTPUT)
);

export const runProcess = (
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<ProcessResult> => new Promise((resolve, reject) => {
  const startedAt = Date.now();
  const child = spawn(executable, args, {
    cwd,
    windowsHide: true,
    shell: false,
    env: createSandboxedEnvironment(process.env, extraEnv),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, Math.min(Math.max(timeoutMs, 1_000), 15 * 60_000));
  child.stdout.on('data', (chunk) => {
    stdout = appendBounded(stdout, String(chunk));
  });
  child.stderr.on('data', (chunk) => {
    stderr = appendBounded(stderr, String(chunk));
  });
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('close', (exitCode) => {
    clearTimeout(timer);
    resolve({
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
      timedOut
    });
  });
});

const git = async (
  cwd: string,
  args: string[],
  timeoutMs = 30_000,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<ProcessResult> => runProcess('git', [
  '-c',
  `safe.directory=${path.resolve(cwd).replace(/\\/g, '/')}`,
  ...args
], cwd, timeoutMs, {
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  ...extraEnv
});

const requireSuccess = (result: ProcessResult, action: string): string => {
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 1500);
    throw new Error(`${action} a échoué${detail ? `: ${detail}` : '.'}`);
  }
  return result.stdout.trim();
};

const exists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const parseWorktrees = (value: string): NeuraCoGitWorktree[] => {
  const blocks = value.split(/\r?\n\r?\n/).filter(Boolean);
  return blocks.flatMap((block): NeuraCoGitWorktree[] => {
    const lines = block.split(/\r?\n/);
    const worktreePath = lines.find((line) => line.startsWith('worktree '))?.slice(9);
    if (!worktreePath) return [];
    const branchRef = lines.find((line) => line.startsWith('branch '))?.slice(7) || '';
    return [{
      path: worktreePath,
      branch: branchRef.replace(/^refs\/heads\//, '') || '(détachée)',
      head: lines.find((line) => line.startsWith('HEAD '))?.slice(5) || '',
      isMain: false,
      dirty: false
    }];
  });
};

const statusCounts = (porcelain: string) => {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const line of porcelain.split(/\r?\n/).filter(Boolean)) {
    if (line.startsWith('??')) {
      untracked += 1;
      continue;
    }
    if (line[0] && line[0] !== ' ') staged += 1;
    if (line[1] && line[1] !== ' ') unstaged += 1;
  }
  return { staged, unstaged, untracked };
};

const parseDiffStat = (statLine: string) => {
  const filesChanged = Number(statLine.match(/(\d+) files? changed/)?.[1] || 0);
  const insertions = Number(statLine.match(/(\d+) insertions?\(\+\)/)?.[1] || 0);
  const deletions = Number(statLine.match(/(\d+) deletions?\(-\)/)?.[1] || 0);
  return { filesChanged, insertions, deletions };
};

const safeBranchPart = (value: string): string => (
  value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
);

const ensureInside = (parent: string, candidate: string): string => {
  const base = path.resolve(parent);
  const target = path.resolve(candidate);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Chemin de worktree non autorisé.');
  }
  return target;
};

const testCommandKey = (cwd: string, command: string): string => (
  Buffer.from(`${cwd}\0${command}`).toString('base64url')
);

const npmExecution = async (
  cwd: string,
  npmArgs: string[]
): Promise<{ executable: string; args: string[] }> => {
  const environmentCli = process.env.npm_execpath;
  if (environmentCli && await exists(environmentCli)) {
    return {
      executable: process.env.npm_node_execpath || 'node',
      args: [environmentCli, ...npmArgs]
    };
  }
  if (process.platform !== 'win32') {
    return { executable: 'npm', args: npmArgs };
  }
  const located = await runProcess('where.exe', ['npm.cmd'], cwd, 10_000);
  const commandPath = located.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  if (!commandPath) throw new Error('npm est introuvable dans le PATH Windows.');
  const installation = path.dirname(commandPath);
  const cli = path.join(installation, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!await exists(cli)) throw new Error('npm-cli.js est introuvable dans l’installation Node.js.');
  const node = path.join(installation, 'node.exe');
  return {
    executable: await exists(node) ? node : 'node',
    args: [cli, ...npmArgs]
  };
};

export class GitService {
  private readonly worktreeRoot: string;
  private readonly reviewChanges: NonNullable<GitServiceOptions['reviewChanges']>;
  private readonly validations = new Map<string, BranchValidation>();

  constructor(options: GitServiceOptions) {
    this.worktreeRoot = options.worktreeRoot;
    this.reviewChanges = options.reviewChanges || (async (body, signal) => (
      authenticatedApiRequest<SpecialistApiResponse>('/neuraco/agents/execute', {
        method: 'POST',
        signal,
        body: JSON.stringify(body)
      })
    ));
  }

  private async repositoryRoot(project: NeuraCoProject): Promise<string> {
    const result = await git(project.rootPath, ['rev-parse', '--show-toplevel']);
    return path.resolve(requireSuccess(result, 'La détection du dépôt Git'));
  }

  private async ensureNoTrackedSecrets(root: string): Promise<void> {
    const tracked = requireSuccess(
      await git(root, ['ls-files', '-z']),
      'La vérification des fichiers suivis'
    ).split('\0').filter(Boolean);
    const sensitive = tracked.find((file) => SENSITIVE_TRACKED_FILE.test(file.replace(/\\/g, '/')));
    if (sensitive) {
      throw new Error(
        `Worktree refusé: le fichier sensible suivi par Git « ${sensitive} » doit être retiré de l’historique.`
      );
    }
  }

  async status(project: NeuraCoProject): Promise<NeuraCoGitStatus> {
    const version = await git(project.rootPath, ['--version']).catch(() => null);
    if (!version || version.exitCode !== 0) {
      return {
        installed: false,
        repository: false,
        root: project.rootPath,
        branch: '',
        head: '',
        dirty: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        ahead: 0,
        behind: 0,
        branches: [],
        worktrees: [],
        error: 'Git n’est pas installé ou inaccessible.'
      };
    }
    const inside = await git(project.rootPath, ['rev-parse', '--is-inside-work-tree']);
    if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
      return {
        installed: true,
        repository: false,
        root: project.rootPath,
        branch: '',
        head: '',
        dirty: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        ahead: 0,
        behind: 0,
        branches: [],
        worktrees: [],
        error: 'Le projet ouvert n’est pas un dépôt Git.'
      };
    }
    const root = await this.repositoryRoot(project);
    const [
      branchResult,
      headResult,
      porcelainResult,
      branchesResult,
      worktreesResult,
      lastCommitResult,
      upstreamResult
    ] = await Promise.all([
      git(root, ['branch', '--show-current']),
      git(root, ['rev-parse', 'HEAD']),
      git(root, ['status', '--porcelain']),
      git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
      git(root, ['worktree', 'list', '--porcelain']),
      git(root, ['log', '-1', '--format=%H%x00%s%x00%an%x00%aI']),
      git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
    ]);
    const branch = branchResult.stdout.trim() || '(détachée)';
    const counts = statusCounts(porcelainResult.stdout);
    const upstreamParts = upstreamResult.exitCode === 0
      ? upstreamResult.stdout.trim().split(/\s+/).map(Number)
      : [0, 0];
    const worktrees = parseWorktrees(worktreesResult.stdout);
    await Promise.all(worktrees.map(async (worktree, index) => {
      worktree.isMain = index === 0 || path.resolve(worktree.path) === root;
      const worktreeStatus = await git(worktree.path, ['status', '--porcelain']);
      worktree.dirty = Boolean(worktreeStatus.stdout.trim());
    }));
    const commitParts = lastCommitResult.stdout.trim().split('\0');
    return {
      installed: true,
      repository: true,
      root,
      branch,
      head: headResult.stdout.trim(),
      dirty: counts.staged + counts.unstaged + counts.untracked > 0,
      ...counts,
      ahead: Number(upstreamParts[1] || 0),
      behind: Number(upstreamParts[0] || 0),
      branches: branchesResult.stdout.split(/\r?\n/).filter(Boolean),
      worktrees,
      lastCommit: commitParts.length >= 4 ? {
        hash: commitParts[0],
        subject: commitParts[1],
        author: commitParts[2],
        date: commitParts[3]
      } : undefined
    };
  }

  async pushBranch(
    project: NeuraCoProject,
    branch: string
  ): Promise<{ branch: string; remote: 'origin'; pushedAt: string }> {
    const safeBranch = String(branch || '').trim();
    if (!SAFE_BRANCH.test(safeBranch)) {
      throw new Error('Nom de branche invalide.');
    }
    const root = await this.repositoryRoot(project);
    await this.ensureNoTrackedSecrets(root);
    requireSuccess(
      await git(root, ['show-ref', '--verify', `refs/heads/${safeBranch}`]),
      `La vérification de la branche ${safeBranch}`
    );
    const remoteUrl = requireSuccess(
      await git(root, ['remote', 'get-url', 'origin']),
      'La vérification du remote origin'
    );
    const localRemoteSafety = path.isAbsolute(remoteUrl)
      ? ['-c', `safe.directory=${path.resolve(remoteUrl).replace(/\\/g, '/')}`]
      : [];
    const localRemoteEnvironment = path.isAbsolute(remoteUrl)
      ? {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'safe.directory',
          GIT_CONFIG_VALUE_0: path.resolve(remoteUrl).replace(/\\/g, '/')
        }
      : {};
    requireSuccess(
      await git(
        root,
        [
          ...localRemoteSafety,
          'push',
          '--set-upstream',
          'origin',
          `refs/heads/${safeBranch}`
        ],
        120_000,
        localRemoteEnvironment
      ),
      `Le push de ${safeBranch}`
    );
    return {
      branch: safeBranch,
      remote: 'origin',
      pushedAt: new Date().toISOString()
    };
  }

  async diff(project: NeuraCoProject, branch?: string): Promise<NeuraCoGitDiff> {
    const root = await this.repositoryRoot(project);
    const currentBranch = requireSuccess(
      await git(root, ['branch', '--show-current']),
      'La lecture de la branche'
    ) || 'HEAD';
    const selected = branch || currentBranch;
    if (branch && !SAFE_NAME.test(branch.replace(/^neuraco\//, '').replace(/\//g, '-'))) {
      throw new Error('Nom de branche invalide.');
    }
    const range = selected === currentBranch ? null : `${currentBranch}...${selected}`;
    const statArgs = range
      ? ['diff', '--shortstat', range]
      : ['diff', '--shortstat', 'HEAD'];
    const patchArgs = range
      ? ['diff', '--no-ext-diff', '--unified=3', range]
      : ['diff', '--no-ext-diff', '--unified=3', 'HEAD'];
    const [statResult, patchResult, namesResult] = await Promise.all([
      git(root, statArgs),
      git(root, patchArgs),
      git(root, range
        ? ['diff', '--name-only', range]
        : ['diff', '--name-only', 'HEAD'])
    ]);
    requireSuccess(statResult, 'La génération du résumé Git');
    requireSuccess(patchResult, 'La génération du diff Git');
    const parsed = parseDiffStat(statResult.stdout);
    const patch = patchResult.stdout;
    return {
      branch: selected,
      baseBranch: currentBranch,
      filesChanged: parsed.filesChanged
        || namesResult.stdout.split(/\r?\n/).filter(Boolean).length,
      insertions: parsed.insertions,
      deletions: parsed.deletions,
      stat: statResult.stdout.trim() || 'Aucune différence.',
      patch: patch.slice(0, MAX_DIFF),
      truncated: patch.length > MAX_DIFF
    };
  }

  async createWorktree(
    project: NeuraCoProject,
    request: NeuraCoGitWorktreeCreate
  ): Promise<NeuraCoGitWorktree> {
    if (!SAFE_NAME.test(request.taskId) || !SAFE_NAME.test(request.agentId)) {
      throw new Error('Identifiant de tâche ou d’agent invalide.');
    }
    const root = await this.repositoryRoot(project);
    await this.ensureNoTrackedSecrets(root);
    const base = request.baseBranch || requireSuccess(
      await git(root, ['branch', '--show-current']),
      'La lecture de la branche de base'
    );
    const branch = `neuraco/${safeBranchPart(request.taskId)}/${safeBranchPart(request.agentId)}`;
    const target = ensureInside(
      this.worktreeRoot,
      path.join(
        this.worktreeRoot,
        safeBranchPart(project.id),
        `${safeBranchPart(request.taskId)}-${safeBranchPart(request.agentId)}`
      )
    );
    await mkdir(path.dirname(target), { recursive: true });
    if (await exists(target)) throw new Error('Ce worktree existe déjà.');
    requireSuccess(
      await git(root, ['worktree', 'add', '-b', branch, target, base], 120_000),
      'La création du worktree'
    );
    this.validations.delete(branch);
    return {
      path: target,
      branch,
      head: requireSuccess(await git(target, ['rev-parse', 'HEAD']), 'La lecture du commit'),
      isMain: false,
      dirty: false
    };
  }

  async removeWorktree(project: NeuraCoProject, worktreePath: string): Promise<boolean> {
    const root = await this.repositoryRoot(project);
    const target = ensureInside(this.worktreeRoot, worktreePath);
    const statusResult = await git(target, ['status', '--porcelain']);
    if (statusResult.exitCode !== 0) throw new Error('Worktree introuvable ou invalide.');
    if (statusResult.stdout.trim()) {
      throw new Error('Le worktree contient des modifications non enregistrées.');
    }
    requireSuccess(
      await git(root, ['worktree', 'remove', target], 120_000),
      'La suppression du worktree'
    );
    return true;
  }

  async commitWorktree(
    project: NeuraCoProject,
    worktreePath: string,
    message: string
  ): Promise<NeuraCoGitCommitResult> {
    await this.repositoryRoot(project);
    const target = ensureInside(this.worktreeRoot, worktreePath);
    const safeMessage = message.trim().slice(0, 240);
    if (safeMessage.length < 3) throw new Error('Le message de commit est trop court.');
    const rawStatus = requireSuccess(
      await git(target, ['status', '--porcelain', '-z']),
      'La lecture des modifications'
    );
    const changedPaths = rawStatus.split('\0').filter(Boolean).map((entry) => entry.slice(3));
    if (changedPaths.length === 0) throw new Error('Aucune modification à enregistrer.');
    const sensitive = changedPaths.find((file) => SENSITIVE_TRACKED_FILE.test(file.replace(/\\/g, '/')));
    if (sensitive) throw new Error(`Commit refusé: fichier sensible détecté « ${sensitive} ».`);
    requireSuccess(await git(target, ['add', '--all']), 'La préparation du commit');
    try {
      requireSuccess(
        await git(target, ['commit', '-m', safeMessage], 120_000),
        'La création du commit'
      );
    } catch (error) {
      await git(target, ['reset']);
      throw error;
    }
    const branch = requireSuccess(
      await git(target, ['branch', '--show-current']),
      'La lecture de la branche'
    );
    this.validations.delete(branch);
    return {
      branch,
      commit: requireSuccess(await git(target, ['rev-parse', 'HEAD']), 'La lecture du commit'),
      message: safeMessage,
      filesChanged: changedPaths.length
    };
  }

  async testCommands(project: NeuraCoProject, worktreePath?: string): Promise<NeuraCoGitTestCommand[]> {
    const root = worktreePath
      ? ensureInside(this.worktreeRoot, worktreePath)
      : await this.repositoryRoot(project);
    const candidates: NeuraCoGitTestCommand[] = [];
    const packageDirectories = [root, path.join(root, 'frontend'), path.join(root, 'neuraco')];
    for (const cwd of packageDirectories) {
      const packagePath = path.join(cwd, 'package.json');
      if (!await exists(packagePath)) continue;
      try {
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
          scripts?: Record<string, string>;
        };
        if (packageJson.scripts?.test) {
          const command = 'npm test';
          candidates.push({
            id: testCommandKey(cwd, command),
            label: `Tests npm · ${path.relative(root, cwd) || 'racine'}`,
            cwd,
            command
          });
        }
        if (packageJson.scripts?.build) {
          const command = 'npm run build';
          candidates.push({
            id: testCommandKey(cwd, command),
            label: `Build npm · ${path.relative(root, cwd) || 'racine'}`,
            cwd,
            command
          });
        }
      } catch {
        // Invalid package metadata is reported by the actual build command.
      }
    }
    const pythonDirectories = [root, path.join(root, 'backend')];
    for (const cwd of pythonDirectories) {
      if (
        await exists(path.join(cwd, 'tests'))
        || await exists(path.join(cwd, 'pytest.ini'))
        || await exists(path.join(cwd, 'pyproject.toml'))
      ) {
        const command = 'python -m pytest -q';
        candidates.push({
          id: testCommandKey(cwd, command),
          label: `Pytest · ${path.relative(root, cwd) || 'racine'}`,
          cwd,
          command
        });
      }
    }
    return candidates.filter((item, index, all) => (
      all.findIndex((candidate) => candidate.id === item.id) === index
    ));
  }

  async runTests(
    project: NeuraCoProject,
    commandId: string,
    worktreePath?: string
  ): Promise<NeuraCoGitTestResult> {
    const commands = await this.testCommands(project, worktreePath);
    const selected = commands.find((command) => command.id === commandId);
    if (!selected) throw new Error('Commande de test non autorisée.');
    const isNpm = selected.command.startsWith('npm ');
    const commandArgs = selected.command === 'npm test'
      ? ['test']
      : selected.command === 'npm run build'
        ? ['run', 'build']
        : ['-m', 'pytest', '-q'];
    const execution = isNpm
      ? await npmExecution(selected.cwd, commandArgs)
      : { executable: 'python', args: commandArgs };
    const result = await runProcess(
      execution.executable,
      execution.args,
      selected.cwd,
      12 * 60_000,
      { CI: 'true', FORCE_COLOR: '0' }
    );
    const branch = (await git(selected.cwd, ['branch', '--show-current'])).stdout.trim() || 'HEAD';
    const testResult: NeuraCoGitTestResult = {
      id: randomUUID(),
      branch,
      command: `${selected.command} (${selected.cwd})`,
      passed: result.exitCode === 0 && !result.timedOut,
      exitCode: result.exitCode,
      output: `${result.stdout}${result.stderr}`.slice(-MAX_OUTPUT),
      durationMs: result.durationMs,
      completedAt: new Date().toISOString()
    };
    const validation = this.validations.get(branch) || {};
    validation.tests = [
      ...(validation.tests || []).filter((item) => item.command !== testResult.command),
      testResult
    ];
    validation.review = undefined;
    this.validations.set(branch, validation);
    return testResult;
  }

  async runTestSuite(
    project: NeuraCoProject,
    worktreePath?: string
  ): Promise<NeuraCoGitTestResult[]> {
    const commands = await this.testCommands(project, worktreePath);
    if (commands.length === 0) {
      throw new Error('Aucune commande de test ou de build vérifiable n’a été détectée.');
    }
    const results: NeuraCoGitTestResult[] = [];
    for (const command of commands) {
      results.push(await this.runTests(project, command.id, worktreePath));
    }
    return results;
  }

  async review(
    project: NeuraCoProject,
    branch: string,
    signal?: AbortSignal
  ): Promise<NeuraCoGitReview> {
    const diff = await this.diff(project, branch);
    if (!diff.patch.trim()) throw new Error('Aucune différence à réviser.');
    const response = await this.reviewChanges({
      task_id: `review_${randomUUID()}`,
      agent_id: 'reviewer',
      agent_name: 'Réviseur Git',
      agent_role: 'Revue indépendante avant fusion',
      agent_instructions:
        'Commence obligatoirement par DECISION: APPROUVE ou DECISION: REFUSE. '
        + 'Refuse si le diff présente un conflit, une régression probable, un secret ou une validation non prouvée.',
      objective: (
        `Branche cible: ${diff.baseBranch}\nBranche proposée: ${branch}\n`
        + `Résumé: ${diff.stat}\n\nDiff à examiner:\n${diff.patch}`
      ).slice(0, 11_500),
      project_id: project.id,
      project_name: project.name,
      phase: 'reviewer',
      budget: 8,
      model: 'claude-sonnet-4-5',
      files: []
    }, signal);
    const approved = /^\s*DECISION\s*:\s*APPROUVE\b/i.test(response.message);
    const review: NeuraCoGitReview = {
      branch,
      approved,
      message: response.message,
      provider: response.provider,
      model: response.model,
      creditsConsumed: Number(response.usage?.credits_consumed || 0),
      diff,
      reviewedAt: new Date().toISOString()
    };
    const validation = this.validations.get(branch) || {};
    validation.review = review;
    this.validations.set(branch, validation);
    return review;
  }

  private async assertNoConflicts(root: string, target: string, branch: string): Promise<void> {
    const base = requireSuccess(
      await git(root, ['merge-base', target, branch]),
      'La recherche de la base de fusion'
    );
    const preview = await git(root, ['merge-tree', base, target, branch], 120_000);
    if (
      preview.exitCode !== 0
      || /^(?:<{7}|={7}|>{7})/m.test(preview.stdout)
      || /changed in both/i.test(preview.stdout)
    ) {
      throw new Error('La fusion présente un conflit Git et a été bloquée.');
    }
  }

  async merge(project: NeuraCoProject, branch: string): Promise<NeuraCoGitMergeResult> {
    const root = await this.repositoryRoot(project);
    const targetBranch = requireSuccess(
      await git(root, ['branch', '--show-current']),
      'La lecture de la branche cible'
    );
    const porcelain = requireSuccess(await git(root, ['status', '--porcelain']), 'Le statut Git');
    if (porcelain.trim()) throw new Error('Le dépôt principal doit être propre avant la fusion.');
    const validation = this.validations.get(branch);
    const status = await this.status(project);
    const worktree = status.worktrees.find((item) => item.branch === branch);
    const expectedTests = await this.testCommands(
      project,
      worktree && !worktree.isMain ? worktree.path : undefined
    );
    const passedCommands = new Set(
      (validation?.tests || []).filter((test) => test.passed).map((test) => test.command)
    );
    const allTestsPassed = expectedTests.length > 0 && expectedTests.every((command) => (
      [...passedCommands].some((executed) => executed.startsWith(`${command.command} (`))
    ));
    if (!allTestsPassed) {
      throw new Error('Toutes les commandes de test et de build détectées doivent réussir avant la fusion.');
    }
    const review = validation?.review;
    if (!review?.approved) {
      throw new Error('Une revue indépendante favorable est obligatoire avant la fusion.');
    }
    await this.assertNoConflicts(root, targetBranch, branch);
    const mergeResult = await git(
      root,
      ['merge', '--no-ff', branch, '-m', `Merge ${branch} via NeuraCo`],
      120_000
    );
    if (mergeResult.exitCode !== 0) {
      await git(root, ['merge', '--abort']);
      throw new Error(`La fusion a échoué et a été annulée: ${mergeResult.stderr.trim()}`);
    }
    const commit = requireSuccess(await git(root, ['rev-parse', 'HEAD']), 'La lecture du commit fusionné');
    const result: NeuraCoGitMergeResult = {
      branch,
      targetBranch,
      commit,
      mergedAt: new Date().toISOString(),
      tests: validation?.tests || [],
      review
    };
    this.validations.delete(branch);
    return result;
  }
}
