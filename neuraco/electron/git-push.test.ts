import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitService, runProcess } from './git-service';
import type { NeuraCoProject } from './ipc-contract';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200
    })
  )));
});

describe('GitService remote publication', () => {
  it('pushes an existing isolated branch to origin without force', async () => {
    const directory = await mkdtemp(path.join(process.cwd(), '.neuraco-push-'));
    temporaryDirectories.push(directory);
    const repository = path.join(directory, 'repository');
    const remote = path.join(directory, 'remote.git');
    const worktreeRoot = path.join(directory, 'worktrees');
    await mkdir(repository, { recursive: true });
    await mkdir(remote, { recursive: true });
    expect((await runProcess('git', ['init', '-b', 'main'], repository)).exitCode).toBe(0);
    expect((await runProcess('git', ['init', '--bare'], remote)).exitCode).toBe(0);
    const runGit = (args: string[]) => runProcess('git', [
      '-c',
      `safe.directory=${repository.replace(/\\/g, '/')}`,
      ...args
    ], repository);
    expect((await runGit(['config', 'user.email', 'tests@example.invalid'])).exitCode).toBe(0);
    expect((await runGit(['config', 'user.name', 'NeuraCo Tests'])).exitCode).toBe(0);
    await writeFile(path.join(repository, 'README.md'), '# Fixture\n', 'utf8');
    expect((await runGit(['add', '--all'])).exitCode).toBe(0);
    expect((await runGit(['commit', '-m', 'Initial fixture'])).exitCode).toBe(0);
    expect((await runGit(['remote', 'add', 'origin', remote])).exitCode).toBe(0);
    const project: NeuraCoProject = {
      id: '0123456789abcdef01234567',
      name: 'Push fixture',
      rootPath: repository
    };
    const service = new GitService({ worktreeRoot });
    const worktree = await service.createWorktree(project, {
      taskId: 'task-push',
      agentId: 'developer'
    });
    await writeFile(path.join(worktree.path, 'remote.txt'), 'published\n', 'utf8');
    await service.commitWorktree(project, worktree.path, 'Prepare remote branch');

    const pushed = await service.pushBranch(project, worktree.branch);

    expect(pushed).toMatchObject({ branch: worktree.branch, remote: 'origin' });
    const remoteBranch = await runProcess(
      'git',
      ['show-ref', '--verify', `refs/heads/${worktree.branch}`],
      remote
    );
    expect(remoteBranch.exitCode).toBe(0);
  }, 30_000);
});
