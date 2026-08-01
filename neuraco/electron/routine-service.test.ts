import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NeuraCoRoutineInput } from './ipc-contract';
import { nextScheduledRun, RoutineService } from './routine-service';

const roots: string[] = [];

const createService = async (
  execute = vi.fn().mockResolvedValue({
    summary: 'Rapport terminé.',
    provider: 'Google',
    model: 'gemini-2.5-flash',
    creditsConsumed: 3
  }),
  available = true
) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-routines-'));
  roots.push(root);
  return {
    execute,
    service: new RoutineService(path.join(root, 'routines.json'), {
      execute,
      isLocalExecutionAvailable: () => available
    })
  };
};

const input = (
  overrides: Partial<NeuraCoRoutineInput> = {}
): NeuraCoRoutineInput => ({
  name: 'Vérifier les dépendances',
  instruction: 'Analyse les dépendances et prépare un rapport.',
  projectIds: ['project-1'],
  agentIds: ['reviewer'],
  model: 'gemini-2.5-flash',
  schedule: { trigger: 'time', time: '09:00' },
  tools: ['files', 'terminal'],
  budgetCredits: 20,
  autonomy: 'balanced',
  notificationConditions: ['on_success', 'on_failure'],
  executionMode: 'local',
  cloudConsent: false,
  ...overrides
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
});

describe('RoutineService', () => {
  it('stores complete routines disabled by default and computes the next run', async () => {
    const { service } = await createService();
    const state = await service.save(input());
    expect(state.routines).toHaveLength(1);
    expect(state.routines[0]).toMatchObject({
      enabled: false,
      projectIds: ['project-1'],
      agentIds: ['reviewer'],
      tools: ['files', 'terminal'],
      budgetCredits: 20,
      autonomy: 'balanced',
      executionMode: 'local'
    });
    expect(state.routines[0].nextRunAt).toBeTruthy();
    expect(state.localOnlyNotice).toContain('PC');
  });

  it('requires explicit consent for cloud routines', async () => {
    const { service } = await createService();
    await expect(service.save(input({
      executionMode: 'cloud',
      cloudConsent: false
    }))).rejects.toThrow(/consentement explicite/i);
    const state = await service.save(input({
      executionMode: 'cloud',
      cloudConsent: true
    }));
    expect(state.routines[0].cloudConsent).toBe(true);
  });

  it('runs matching event and file routines while preserving project scope', async () => {
    const { service, execute } = await createService();
    let state = await service.save(input({
      schedule: { trigger: 'file_change', filePattern: 'src/**' }
    }));
    state = await service.setEnabled(state.routines[0].id, true);
    expect(await service.trigger('file_change', {
      projectId: 'another-project',
      filePath: 'src/app.ts'
    })).toHaveLength(0);
    expect(await service.trigger('file_change', {
      projectId: 'project-1',
      filePath: 'README.md'
    })).toHaveLength(0);
    const runs = await service.trigger('file_change', {
      projectId: 'project-1',
      filePath: 'src/app.ts'
    });
    expect(runs[0].status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
    expect((await service.state()).recentRuns[0].creditsConsumed).toBe(3);
  });

  it('does not run local routines when the application is unavailable', async () => {
    const { service, execute } = await createService(undefined, false);
    const state = await service.save(input());
    const run = await service.runManual(state.routines[0].id);
    expect(run.status).toBe('skipped');
    expect(execute).not.toHaveBeenCalled();
  });

  it('calculates daily and weekly schedules deterministically', () => {
    const after = new Date(2026, 6, 29, 10, 15, 0, 0);
    const daily = new Date(nextScheduledRun(
      { trigger: 'time', time: '11:00' },
      after
    )!);
    expect([
      daily.getFullYear(),
      daily.getMonth(),
      daily.getDate(),
      daily.getHours(),
      daily.getMinutes()
    ]).toEqual([2026, 6, 29, 11, 0]);
    const weekly = new Date(nextScheduledRun(
      { trigger: 'day', time: '09:00', weekdays: [4] },
      after
    )!);
    expect([
      weekly.getDay(),
      weekly.getHours(),
      weekly.getMinutes()
    ]).toEqual([4, 9, 0]);
  });
});
