import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitService, runProcess } from './git-service';
import type { NeuraCoProject } from './ipc-contract';

const temporaryDirectories: string[] = [];

const createRepository = async (): Promise<{
  project: NeuraCoProject;
  worktreeRoot: string;
}> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-git-'));
  temporaryDirectories.push(directory);
  const repository = path.join(directory, 'repository');
  const worktreeRoot = path.join(directory, 'worktrees');
  await mkdir(repository, { recursive: true });
  const runGit = (args: string[]) => runProcess('git', [
    '-c',
    `safe.directory=${repository.replace(/\\/g, '/')}`,
    ...args
  ], repository);
  const initialized = await runProcess('git', ['init', '-b', 'main'], repository);
  if (initialized.exitCode !== 0) {
    await runProcess('git', ['init'], repository);
    await runGit(['checkout', '-b', 'main']);
  }
  await runGit(['config', 'user.email', 'neuraco-tests@example.invalid']);
  await runGit(['config', 'user.name', 'NeuraCo Tests']);
  await writeFile(
    path.join(repository, 'package.json'),
    JSON.stringify({
      name: 'neuraco-git-fixture',
      private: true,
      scripts: { test: 'node -e "process.exit(0)"' }
    }),
    'utf8'
  );
  await writeFile(path.join(repository, 'README.md'), '# Fixture\n', 'utf8');
  await runGit(['add', '--all']);
  await runGit(['commit', '-m', 'Initial fixture']);
  return {
    project: {
      id: '0123456789abcdef01234567',
      name: 'Git fixture',
      rootPath: repository
    },
    worktreeRoot
  };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true
    }))
  );
});

describe('GitService', () => {
  it('creates an isolated worktree, tests, reviews and merges validated changes', async () => {
    const { project, worktreeRoot } = await createRepository();
    const reviewChanges = vi.fn(async (body: Record<string, unknown>) => ({
      message: 'DECISION: APPROUVE\nAucun conflit, secret ou risque bloquant détecté.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      model_display: 'Claude Sonnet 4.5',
      entitlement_plan: 'neura_plus',
      usage: { credits_consumed: 0.75 },
      body
    }));
    const service = new GitService({ worktreeRoot, reviewChanges });

    const initial = await service.status(project);
    expect(initial).toMatchObject({
      installed: true,
      repository: true,
      branch: 'main',
      dirty: false
    });

    const worktree = await service.createWorktree(project, {
      taskId: 'task-1234',
      agentId: 'developer'
    });
    expect(worktree.branch).toBe('neuraco/task-1234/developer');
    await writeFile(path.join(worktree.path, 'feature.txt'), 'validated\n', 'utf8');
    const commit = await service.commitWorktree(
      project,
      worktree.path,
      'Add validated feature'
    );
    expect(commit.filesChanged).toBe(1);

    const diff = await service.diff(project, worktree.branch);
    expect(diff.filesChanged).toBe(1);
    expect(diff.patch).toContain('validated');

    const commands = await service.testCommands(project, worktree.path);
    const npmTests = commands.find((command) => command.command === 'npm test');
    expect(npmTests).toBeDefined();
    const tests = await service.runTests(project, npmTests!.id, worktree.path);
    expect(tests.passed).toBe(true);

    const review = await service.review(project, worktree.branch);
    expect(review.approved).toBe(true);
    expect(review.creditsConsumed).toBe(0.75);
    expect(review.model).toBe('claude-sonnet-4-5');

    const merge = await service.merge(project, worktree.branch);
    expect(merge.targetBranch).toBe('main');
    expect(
      (await readFile(path.join(project.rootPath, 'feature.txt'), 'utf8')).replace(/\r\n/g, '\n')
    ).toBe('validated\n');
  }, 30_000);

  it('refuses to copy a tracked secret into a worktree', async () => {
    const { project, worktreeRoot } = await createRepository();
    await writeFile(path.join(project.rootPath, '.env'), 'API_KEY=secret\n', 'utf8');
    const safeDirectory = project.rootPath.replace(/\\/g, '/');
    await runProcess('git', ['-c', `safe.directory=${safeDirectory}`, 'add', '.env'], project.rootPath);
    await runProcess(
      'git',
      ['-c', `safe.directory=${safeDirectory}`, 'commit', '-m', 'Tracked secret fixture'],
      project.rootPath
    );
    const service = new GitService({ worktreeRoot });

    await expect(service.createWorktree(project, {
      taskId: 'task-5678',
      agentId: 'security'
    })).rejects.toThrow(/fichier sensible suivi par Git/i);
  });

  it('refuses to remove a worktree with uncommitted changes', async () => {
    const { project, worktreeRoot } = await createRepository();
    const service = new GitService({ worktreeRoot });
    const worktree = await service.createWorktree(project, {
      taskId: 'task-9012',
      agentId: 'frontend'
    });
    await writeFile(path.join(worktree.path, 'draft.txt'), 'not committed\n', 'utf8');

    await expect(service.removeWorktree(project, worktree.path)).rejects.toThrow(
      /modifications non enregistrées/i
    );
  });
});
