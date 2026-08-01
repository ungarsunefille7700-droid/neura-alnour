import { describe, expect, it, vi } from 'vitest';
import type { NeuraCoProject } from './ipc-contract';
import { parseForgeRemote, RemoteForgeService } from './remote-forge-service';

const project: NeuraCoProject = {
  id: '0123456789abcdef01234567',
  name: 'Forge fixture',
  rootPath: 'C:\\fixture'
};

const result = (
  stdout = '',
  exitCode = 0,
  stderr = ''
) => ({
  exitCode,
  stdout,
  stderr,
  timedOut: false
});

describe('RemoteForgeService', () => {
  it('parses GitHub and GitLab HTTPS/SSH remotes without accepting unknown hosts', () => {
    expect(parseForgeRemote('git@github.com:owner/repository.git')).toMatchObject({
      provider: 'github',
      repository: 'owner/repository',
      cli: 'gh'
    });
    expect(parseForgeRemote('https://gitlab.com/group/subgroup/project.git')).toMatchObject({
      provider: 'gitlab',
      repository: 'group/subgroup/project',
      cli: 'glab'
    });
    expect(parseForgeRemote('https://example.com/owner/repository.git')).toBeNull();
  });

  it('loads a real-shaped GitHub inbox and keeps unavailable alert APIs as warnings', async () => {
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('remote get-url origin')) {
        return result('https://github.com/neura/project.git\n');
      }
      if (args[0] === '--version') return result('gh version 2.80.0');
      if (joined.endsWith('GET user')) return result(JSON.stringify({ login: 'founder' }));
      if (joined.includes('/issues?state=open')) {
        return result(JSON.stringify([{
          number: 12,
          title: 'Corriger le login',
          body: 'Le callback est lent.',
          state: 'open',
          html_url: 'https://github.com/neura/project/issues/12',
          user: { login: 'reporter' },
          updated_at: '2026-07-28T08:00:00Z'
        }, {
          number: 13,
          title: 'Mise à jour',
          state: 'open',
          pull_request: {},
          html_url: 'https://github.com/neura/project/pull/13'
        }]));
      }
      if (joined.includes('/issues/comments?')) {
        return result(JSON.stringify([{
          id: 55,
          body: 'Je peux reproduire.',
          issue_url: 'https://api.github.com/repos/neura/project/issues/12',
          html_url: 'https://github.com/neura/project/issues/12#issuecomment-55',
          user: { login: 'reviewer' },
          updated_at: '2026-07-28T09:00:00Z'
        }]));
      }
      if (joined.includes('/actions/runs?')) {
        return result(JSON.stringify({
          workflow_runs: [{
            id: 88,
            name: 'Tests',
            display_title: 'Fix callback',
            conclusion: 'failure',
            head_branch: 'fix/callback',
            html_url: 'https://github.com/neura/project/actions/runs/88',
            updated_at: '2026-07-28T10:00:00Z'
          }]
        }));
      }
      if (joined.includes('/dependabot/alerts?')) {
        return result('', 1, 'HTTP 403: Resource not accessible');
      }
      if (joined.includes('/code-scanning/alerts?')) return result('[]');
      return result('', 1, 'unexpected command');
    });
    const service = new RemoteForgeService({ runCommand: runner });

    const inbox = await service.inbox(project);

    expect(inbox.connection).toMatchObject({
      authenticated: true,
      provider: 'github',
      repository: 'neura/project',
      account: 'founder'
    });
    expect(inbox.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['issue', 'pull_request', 'comment', 'ci'])
    );
    expect(inbox.warnings.join(' ')).toMatch(/403/);
    expect(inbox.items.every((item) => item.requiresReview)).toBe(true);
  });

  it('reads a GitHub issue with comments and redacts secrets from remote content', async () => {
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('remote get-url origin')) {
        return result('git@github.com:neura/project.git\n');
      }
      if (args[0] === '--version') return result('gh version 2.80.0');
      if (joined.endsWith('GET user')) return result(JSON.stringify({ login: 'founder' }));
      if (joined.endsWith('/issues/7')) {
        return result(JSON.stringify({
          number: 7,
          title: 'Ajouter le cache',
          body: 'Token: ghp_abcdefghijklmnopqrstuvwxyz1234567890',
          state: 'open',
          html_url: 'https://github.com/neura/project/issues/7',
          user: { login: 'reporter' },
          labels: [{ name: 'performance' }]
        }));
      }
      if (joined.includes('/issues/7/comments?')) {
        return result(JSON.stringify([{
          id: 1,
          body: 'Utiliser un cache borné.',
          user: { login: 'reviewer' },
          created_at: '2026-07-28T10:00:00Z'
        }]));
      }
      return result('', 1, 'unexpected command');
    });
    const service = new RemoteForgeService({ runCommand: runner });

    const issue = await service.issue(project, 7);

    expect(issue.title).toBe('Ajouter le cache');
    expect(issue.labels).toEqual(['performance']);
    expect(issue.comments[0].author).toBe('reviewer');
    expect(issue.body).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
  });

  it('creates a draft pull request through the official CLI without passing a token', async () => {
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('remote get-url origin')) {
        return result('https://github.com/neura/project.git\n');
      }
      if (args[0] === '--version') return result('gh version 2.80.0');
      if (joined.endsWith('GET user')) return result(JSON.stringify({ login: 'founder' }));
      if (args[0] === 'pr' && args[1] === 'create') {
        return result('https://github.com/neura/project/pull/42\n');
      }
      return result('', 1, 'unexpected command');
    });
    const service = new RemoteForgeService({ runCommand: runner });

    const created = await service.createPullRequest(project, {
      branch: 'neuraco/issue-7',
      baseBranch: 'main',
      title: 'Fix issue 7',
      body: 'Tests passés.',
      draft: true
    });

    expect(created).toMatchObject({
      provider: 'github',
      number: 42,
      draft: true,
      url: 'https://github.com/neura/project/pull/42'
    });
    const allArguments = runner.mock.calls.flatMap((call) => call[1] as string[]);
    expect(allArguments.some((argument) => /token|ghp_/i.test(argument))).toBe(false);
  });
});
