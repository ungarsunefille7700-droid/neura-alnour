import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EnvironmentPreparationService,
  inspectPreparationScript
} from './environment-preparation-service';

describe('EnvironmentPreparationService', () => {
  let directory: string;
  let targetPath: string;
  let storePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-preparation-'));
    targetPath = path.join(directory, 'target');
    storePath = path.join(directory, 'preparation.json');
    await mkdir(targetPath);
  });

  afterEach(async () => {
    delete process.env.NEURACO_TEST_API_KEY;
    await rm(directory, { recursive: true, force: true });
  });

  it('blocks secret files and destructive preparation scripts', () => {
    expect(inspectPreparationScript('Copy-Item .env .env.local').blockedReasons)
      .toContain('La lecture ou la copie de fichiers .env est interdite.');
    expect(inspectPreparationScript('git reset --hard HEAD').blockedReasons)
      .toContain('Les commandes Git destructrices sont interdites.');
    expect(inspectPreparationScript('npm install').blockedReasons).toEqual([]);
  });

  it('requires a preview, strips sensitive environment values and stores a redacted run', async () => {
    process.env.NEURACO_TEST_API_KEY = 'sk-test-secret-value';
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'ready ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      stderr: '',
      durationMs: 42
    });
    const service = new EnvironmentPreparationService({ storePath, runCommand });
    await service.update('project-1', {
      script: 'npm install\nnpm test',
      enabled: true,
      runOnWorktree: true,
      runOnTransfer: true,
      timeoutSeconds: 120
    });

    const target = { kind: 'local' as const, projectPath: targetPath };
    const preview = await service.preview('project-1', target);
    const execution = await service.run('project-1', target);
    const config = await service.get('project-1');

    expect(preview).toMatchObject({
      compatible: true,
      firstExecution: true,
      shell: expect.any(String)
    });
    expect(runCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: targetPath,
        timeoutMs: 120_000,
        env: expect.not.objectContaining({
          NEURACO_TEST_API_KEY: 'sk-test-secret-value'
        })
      })
    );
    expect(execution.status).toBe('completed');
    expect(execution.stdout).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz1234567890'
    );
    expect(config.firstRunAt).toBeTruthy();
    expect((await service.listExecutions('project-1'))[0].id).toBe(execution.id);
  });

  it('blocks cloud shells and executes a compatible Docker target through docker exec', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 10
    });
    const service = new EnvironmentPreparationService({ storePath, runCommand });
    await service.update('project-1', {
      script: 'npm ci',
      enabled: true,
      runOnWorktree: true,
      runOnTransfer: true,
      timeoutSeconds: 60
    });

    const cloud = await service.preview('project-1', {
      kind: 'cloud',
      cloudWorkspaceId: 'default'
    });
    expect(cloud.compatible).toBe(false);
    expect(cloud.blockedReasons[0]).toContain('shell arbitraire');

    const execution = await service.run('project-1', {
      kind: 'docker',
      container: 'neuraco-dev',
      projectPath: '/workspace/app'
    });
    expect(execution.status).toBe('completed');
    expect(runCommand).toHaveBeenLastCalledWith(
      'docker',
      expect.arrayContaining(['exec', 'neuraco-dev', 'sh', '-lc']),
      expect.objectContaining({ timeoutMs: 60_000 })
    );
  });
});
