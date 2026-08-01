import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  NeuraCoMultiAgentRequest,
  NeuraCoMultiAgentResult,
  NeuraCoGitReview,
  NeuraCoProject,
  NeuraCoProjectPermissions
} from './ipc-contract';
import { ReviewQueueService } from './review-queue-service';

const temporaryDirectories: string[] = [];

const setup = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-reviews-'));
  temporaryDirectories.push(directory);
  const storePath = path.join(directory, 'review-queue.json');
  return { storePath, service: new ReviewQueueService(storePath) };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

const project: NeuraCoProject = {
  id: '0123456789abcdef01234567',
  name: 'Projet test',
  rootPath: 'C:\\projects\\test'
};

const permissions: NeuraCoProjectPermissions = {
  projectId: project.id,
  projectRoot: project.rootPath,
  configured: true,
  mode: 'safe_auto',
  allowedActions: ['read_file'],
  allowedFolders: [project.rootPath],
  allowedCommandPrefixes: [],
  allowedDomains: [],
  allowedApplications: [],
  alwaysAllowedSignatures: [],
  updatedAt: '2026-07-28T00:00:00.000Z'
};

const request: NeuraCoMultiAgentRequest = {
  taskId: 'task_12345678',
  objective: 'Verifier le composant API_KEY=secret-value',
  projectId: project.id,
  projectName: project.name,
  selectedAgentIds: ['developer', 'tests'],
  maxAgents: 2,
  budget: 8,
  files: [{ path: 'src/App.tsx', content: 'export const ready = true;' }]
};

const result: NeuraCoMultiAgentResult = {
  taskId: 'task_12345678',
  summary: 'Plan de verification',
  risks: [],
  tasks: [{
    id: 'analysis-task',
    agentId: 'developer',
    agentName: 'Developpeur',
    agentRole: 'Developpement',
    objective: 'Analyser',
    files: ['src/App.tsx'],
    dependencies: [],
    acceptanceCriteria: ['Le contrat est identifie'],
    budget: 3,
    status: 'completed',
    message: 'Contrat identifie',
    questions: [],
    blockers: [],
    testState: 'passed'
  }],
  review: 'Revue exploitable',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  durationMs: 1200,
  budgetUsed: 3,
  creditsConsumed: 0.5,
  entitlementPlan: 'neura_plus',
  coordinationMessages: [],
  fileReservations: [],
  coordinationLimits: {
    maxMessages: 16,
    maxMessagesPerPair: 6,
    maxDurationMs: 120000,
    messagesUsed: 0,
    escalations: 0,
    limitReached: false
  }
};

const gitReview = (patch: string): NeuraCoGitReview => ({
  branch: 'agent/feature',
  approved: true,
  message: 'DECISION: APPROUVE',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  creditsConsumed: 0.2,
  reviewedAt: '2026-07-28T00:00:00.000Z',
  diff: {
    branch: 'agent/feature',
    baseBranch: 'main',
    filesChanged: 1,
    insertions: 1,
    deletions: 1,
    stat: '1 file changed',
    patch,
    truncated: false
  }
});

describe('ReviewQueueService', () => {
  it('persists completed tasks once and never stores clear secrets', async () => {
    const { service, storePath } = await setup();
    const first = await service.enqueueMultiAgent(project, request, result, permissions);
    const duplicate = await service.enqueueMultiAgent(project, request, result, permissions);

    expect(first.id).toBe(duplicate.id);
    expect(await service.list(project.id)).toHaveLength(1);
    expect(first.files).toEqual([{
      path: 'src/App.tsx',
      changeKind: 'proposed',
      decision: 'pending'
    }]);
    expect(first.tests[0].status).toBe('passed');
    expect(first.permissions).toContain('mode:safe_auto');
    expect(await readFile(storePath, 'utf8')).not.toContain('secret-value');
  });

  it('refreshes a repeated review while preserving reviewer decisions', async () => {
    const { service } = await setup();
    const first = await service.enqueueMultiAgent(project, request, result, permissions);
    await service.decideFile({
      itemId: first.id,
      filePath: 'src/App.tsx',
      decision: 'accepted'
    });
    await service.addComment({
      itemId: first.id,
      filePath: 'src/App.tsx',
      line: 3,
      body: 'Decision a conserver.'
    });

    const refreshedResult: NeuraCoMultiAgentResult = {
      ...result,
      summary: 'Plan de verification actualise',
      tasks: [{
        ...result.tasks[0],
        files: ['src/App.tsx', 'src/server.ts'],
        message: 'Contrat actualise'
      }]
    };
    const refreshed = await service.enqueueMultiAgent(
      project,
      request,
      refreshedResult,
      permissions
    );

    expect(refreshed.id).toBe(first.id);
    expect(refreshed.summary).toBe('Plan de verification actualise');
    expect(refreshed.comments).toHaveLength(1);
    expect(refreshed.files).toEqual([
      {
        path: 'src/App.tsx',
        changeKind: 'proposed',
        decision: 'accepted'
      },
      {
        path: 'src/server.ts',
        changeKind: 'proposed',
        decision: 'pending'
      }
    ]);
  });

  it('records line comments, per-file decisions, tests and controlled statuses', async () => {
    const { service } = await setup();
    let item = await service.enqueueMultiAgent(project, request, result, permissions);
    item = await service.addComment({
      itemId: item.id,
      filePath: 'src/App.tsx',
      line: 12,
      body: 'Verifier ce contrat.'
    });
    expect(item.status).toBe('reviewing');
    expect(item.comments[0]).toMatchObject({
      filePath: 'src/App.tsx',
      line: 12
    });

    item = await service.decideFile({
      itemId: item.id,
      filePath: 'src/App.tsx',
      decision: 'refused'
    });
    expect(item.status).toBe('changes_requested');
    await expect(service.updateStatus(item.id, 'approved')).rejects.toThrow(
      'fichier refuse'
    );

    item = await service.decideFile({
      itemId: item.id,
      filePath: 'src/App.tsx',
      decision: 'accepted'
    });
    item = await service.recordTests(item.id, [{
      id: 'test_12345678',
      branch: 'agent/test',
      command: 'npm test',
      passed: true,
      exitCode: 0,
      output: 'ok',
      durationMs: 45,
      completedAt: '2026-07-28T00:00:00.000Z'
    }]);
    expect(item.tests[0]).toMatchObject({ status: 'passed', durationMs: 45 });
    expect((await service.updateStatus(item.id, 'approved')).status).toBe('approved');
  });

  it('keeps archived reviews out of the active queue', async () => {
    const { service } = await setup();
    const item = await service.enqueueMultiAgent(project, request, result, permissions);
    await service.updateStatus(item.id, 'archived');
    expect(await service.list(project.id)).toEqual([]);
    expect(await service.list(project.id, true)).toHaveLength(1);
  });

  it('queues Git diffs and completed Cloud results without claiming local changes', async () => {
    const { service } = await setup();
    const gitItem = await service.enqueueGit(
      project,
      gitReview('diff --git a/src/App.tsx b/src/App.tsx\n+validated'),
      permissions
    );
    expect(gitItem.files).toEqual([{
      path: 'src/App.tsx',
      changeKind: 'modified',
      decision: 'pending'
    }]);
    expect(gitItem.branch).toBe('agent/feature');

    const cloudItem = await service.enqueueCloud(project, {
      id: 'cloud_12345678',
      sessionId: 'session_12345678',
      projectId: project.id,
      projectName: project.name,
      executionMode: 'cloud',
      localAccess: false,
      status: 'completed',
      result: 'Proposition distante',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:01.000Z',
      completedAt: '2026-07-28T00:00:01.000Z'
    }, permissions);
    expect(cloudItem).toMatchObject({
      source: 'cloud',
      files: [],
      risk: 'medium'
    });
    expect(await service.list(project.id)).toHaveLength(2);
  });

  it('persists decisions per diff block and applies whole-review decisions', async () => {
    const { service } = await setup();
    const patch = [
      'diff --git a/src/App.tsx b/src/App.tsx',
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '@@ -8 +8 @@',
      '-other',
      '+updated'
    ].join('\n');
    let item = await service.enqueueGit(project, gitReview(patch), permissions);
    expect(item.diffFiles?.[0].hunks).toHaveLength(2);

    item = await service.decideHunk({
      itemId: item.id,
      filePath: 'src/App.tsx',
      hunkId: item.diffFiles![0].hunks[0].id,
      decision: 'accepted'
    });
    expect(item.files[0].decision).toBe('pending');

    item = await service.decideHunk({
      itemId: item.id,
      filePath: 'src/App.tsx',
      hunkId: item.diffFiles![0].hunks[1].id,
      decision: 'refused'
    });
    expect(item.files[0].decision).toBe('refused');
    await expect(service.updateStatus(item.id, 'approved')).rejects.toThrow('fichier refuse');

    item = await service.decideAll({ itemId: item.id, decision: 'accepted' });
    expect(item.files[0].decision).toBe('accepted');
    expect(item.diffFiles?.[0].hunks.every((hunk) => hunk.decision === 'accepted')).toBe(true);
    expect((await service.updateStatus(item.id, 'approved')).status).toBe('approved');
  });
});
