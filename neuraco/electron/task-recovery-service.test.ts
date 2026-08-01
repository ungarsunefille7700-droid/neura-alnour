import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  NeuraCoGitStatus,
  NeuraCoProject,
  NeuraCoProjectSnapshot
} from './ipc-contract';
import {
  captureRecoverableProjectState,
  compareRecoverableProjectState,
  TaskRecoveryService
} from './task-recovery-service';

const directories: string[] = [];
const project: NeuraCoProject = {
  id: '0123456789abcdef01234567',
  name: 'Recovery fixture',
  rootPath: 'C:\\project'
};
const snapshot: NeuraCoProjectSnapshot = {
  project,
  files: [{
    name: 'src',
    relativePath: 'src',
    kind: 'directory',
    children: [{
      name: 'main.ts',
      relativePath: 'src/main.ts',
      kind: 'file',
      size: 42
    }]
  }],
  indexedFiles: 1,
  excludedEntries: 0,
  truncated: false
};
const gitStatus: NeuraCoGitStatus = {
  installed: true,
  repository: true,
  root: project.rootPath,
  branch: 'main',
  head: 'abc123',
  dirty: false,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  ahead: 0,
  behind: 0,
  branches: ['main'],
  worktrees: []
};

const createService = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-recovery-task-'));
  directories.push(directory);
  const storePath = path.join(directory, 'tasks.json');
  return {
    service: new TaskRecoveryService(storePath),
    storePath
  };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('TaskRecoveryService', () => {
  it('captures project state and reports incompatible branch/file changes', () => {
    const previous = captureRecoverableProjectState(snapshot, gitStatus);
    const current = captureRecoverableProjectState({
      ...snapshot,
      files: [{
        name: 'src',
        relativePath: 'src',
        kind: 'directory',
        children: [{
          name: 'main.ts',
          relativePath: 'src/main.ts',
          kind: 'file',
          size: 84
        }, {
          name: 'new.ts',
          relativePath: 'src/new.ts',
          kind: 'file',
          size: 10
        }]
      }]
    }, { ...gitStatus, branch: 'feature', head: 'def456' });

    const differences = compareRecoverableProjectState(previous, current, [], []);

    expect(differences.map((difference) => difference.kind)).toEqual(
      expect.arrayContaining(['branch', 'head', 'file_changed', 'file_added'])
    );
  });

  it('persists progress without secrets and builds a bounded resume prompt', async () => {
    const { service, storePath } = await createService();
    const state = captureRecoverableProjectState(snapshot, gitStatus);
    await service.start({
      id: 'task-1',
      project,
      kind: 'multi_agent',
      objective: 'Corriger le cache avec token ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      agents: ['Architecte', 'Développeur'],
      budgetAllocated: 20,
      permissionMode: 'safe_auto',
      allowedActions: ['read_file', 'write_file'],
      checkpointIds: ['checkpoint-1'],
      projectState: state,
      worktrees: []
    });
    await service.progress('task-1', {
      taskId: 'task-1',
      phase: 'specialists',
      message: 'Développement en cours.',
      completed: 1,
      total: 2,
      task: {
        id: 'step-1',
        agentId: 'developer',
        agentName: 'Développeur',
        agentRole: 'Code',
        objective: 'Modifier le cache',
        files: ['src/main.ts'],
        dependencies: [],
        acceptanceCriteria: [],
        budget: 5,
        status: 'completed',
        questions: [],
        blockers: [],
        testState: 'passed',
        message: 'Cache corrigé.'
      }
    });
    const stored = await readFile(storePath, 'utf8');
    expect(stored).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');

    await service.interrupt('task-1', 'Crédits épuisés.');
    const resumed = await service.resume(
      project.id,
      'task-1',
      'continue_with_changes',
      state,
      []
    );

    expect(resumed.task.status).toBe('resuming');
    expect(resumed.resumePrompt).toContain('Étapes terminées');
    expect(resumed.resumePrompt).toContain('Modifier le cache');
    expect(resumed.differences).toEqual([]);
  });

  it('marks a task left running by a crash as interrupted on the next load', async () => {
    const { service, storePath } = await createService();
    await service.start({
      id: 'task-crash',
      project,
      kind: 'agent',
      objective: 'Analyser le projet',
      agents: ['Assistant principal'],
      budgetAllocated: 4,
      permissionMode: 'manual',
      allowedActions: ['read_file'],
      checkpointIds: [],
      projectState: captureRecoverableProjectState(snapshot, gitStatus),
      worktrees: []
    });
    const activeTasks = await service.list(
      project.id,
      false,
      new Set(['task-crash'])
    );
    expect(activeTasks[0].status).toBe('running');

    const document = JSON.parse(await readFile(storePath, 'utf8'));
    document.tasks['task-crash'].updatedAt = '2020-01-01T00:00:00.000Z';
    await writeFile(storePath, JSON.stringify(document), 'utf8');

    const restarted = new TaskRecoveryService(storePath);
    const tasks = await restarted.list(project.id);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('interrupted');
    expect(tasks[0].interruptionReason).toMatch(/Windows|interrompu/i);
  });

  it('requires an explicit strategy and preserves completed steps when restarting', async () => {
    const { service } = await createService();
    const state = captureRecoverableProjectState(snapshot, gitStatus);
    await service.start({
      id: 'task-2',
      project,
      kind: 'multi_agent',
      objective: 'Construire la fonctionnalité',
      agents: ['Développeur'],
      budgetAllocated: 10,
      permissionMode: 'manual',
      allowedActions: ['read_file'],
      checkpointIds: [],
      projectState: state,
      worktrees: []
    });
    await service.progress('task-2', {
      taskId: 'task-2',
      phase: 'specialists',
      message: 'Étape terminée.',
      completed: 1,
      total: 2,
      task: {
        id: 'done',
        agentId: 'developer',
        agentName: 'Développeur',
        agentRole: 'Code',
        objective: 'Analyser',
        files: [],
        dependencies: [],
        acceptanceCriteria: [],
        budget: 2,
        status: 'completed',
        questions: [],
        blockers: [],
        testState: 'passed',
        message: 'Analyse prête.'
      }
    });
    await service.interrupt('task-2', 'Connexion perdue.');
    const changed = captureRecoverableProjectState(
      snapshot,
      { ...gitStatus, head: 'new-head' }
    );
    const inspection = await service.inspect(project.id, 'task-2', changed, []);
    expect(inspection.compatible).toBe(false);

    const resumed = await service.resume(
      project.id,
      'task-2',
      'restart_from_current',
      changed,
      []
    );
    expect(resumed.task.steps.find((step) => step.id === 'done')?.status).toBe('completed');
    expect(resumed.differences.some((difference) => difference.kind === 'head')).toBe(true);
  });
});
