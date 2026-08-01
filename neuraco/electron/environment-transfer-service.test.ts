import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentTransferService } from './environment-transfer-service';

describe('EnvironmentTransferService', () => {
  let directory: string;
  let sourcePath: string;
  let targetPath: string;
  let storePath: string;
  let manifestsDirectory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-transfer-'));
    sourcePath = path.join(directory, 'source');
    targetPath = path.join(directory, 'target');
    storePath = path.join(directory, 'transfers.json');
    manifestsDirectory = path.join(directory, 'manifests');
    await mkdir(sourcePath);
    await mkdir(targetPath);
    await writeFile(path.join(targetPath, 'src.ts'), 'export const ready = true;\n');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const snapshot = () => ({
    projectId: 'project-12345678',
    projectName: 'Sample',
    sourcePath,
    conversation: {
      messages: [{ role: 'user', content: 'Continue le projet.' }]
    },
    goals: [{ id: 'goal-1' }],
    agents: [{ id: 'agent-1' }],
    permissions: {
      mode: 'full',
      projectRoot: sourcePath,
      allowedFolders: [sourcePath],
      allowedApplications: ['Code.exe'],
      alwaysAllowedSignatures: ['trusted-command']
    },
    budget: { remaining: 20 },
    tasks: [{ id: 'task-1' }],
    changes: { filesChanged: 1 },
    results: [{ summary: 'Tests passés' }],
    requiredTools: ['node'],
    relevantFiles: ['src.ts']
  });

  it('previews and persists a complete local transfer without copying secrets', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'node.exe\n',
      stderr: ''
    });
    const service = new EnvironmentTransferService({
      storePath,
      manifestsDirectory,
      runCommand
    });
    const withSecret = snapshot();
    withSecret.conversation.messages[0].content =
      'TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const target = { kind: 'local' as const, projectPath: targetPath };
    const preview = await service.preview(target, withSecret);
    const transferred = await service.transfer(target, withSecret);
    const manifest = await readFile(transferred.manifestLocation, 'utf8');
    const targetManifest = await readFile(transferred.remoteLocation!, 'utf8');
    const parsed = JSON.parse(targetManifest);

    expect(preview.compatible).toBe(true);
    expect(preview.preserved).toMatchObject({
      conversationMessages: 1,
      goals: 1,
      agents: 1,
      tasks: 1,
      results: 1
    });
    expect(manifest).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    expect(targetManifest).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    expect(transferred.remoteLocation).toContain(
      path.join('.neuraco', 'transfers')
    );
    expect(parsed.state.permissions.projectRoot).toBe(targetPath);
    expect(parsed.state.permissions.allowedFolders).toEqual([targetPath]);
    expect((await service.list('project-12345678'))[0].id).toBe(transferred.id);
  });

  it('blocks transfer before execution when files or tools are unavailable', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'tool absent'
    });
    const service = new EnvironmentTransferService({
      storePath,
      manifestsDirectory,
      runCommand
    });
    const missing = snapshot();
    missing.relevantFiles = ['missing.ts'];
    const target = { kind: 'worktree' as const, worktreePath: targetPath };
    const preview = await service.preview(target, missing);

    expect(preview.compatible).toBe(false);
    expect(preview.unavailableFiles).toEqual(['missing.ts']);
    expect(preview.unavailableTools).toEqual(['node']);
    await expect(service.transfer(target, missing)).rejects.toThrow('Transfert bloqué');
  });

  it('copies the sanitized manifest into Docker and uploads it to cloud', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: ''
    });
    const uploadCloud = vi.fn().mockResolvedValue(
      'neuraco-cloud://environment-transfers/transfer-1'
    );
    const service = new EnvironmentTransferService({
      storePath,
      manifestsDirectory,
      runCommand,
      uploadCloud
    });
    const docker = await service.transfer({
      kind: 'docker',
      container: 'neuraco-dev',
      projectPath: '/workspace/app'
    }, snapshot());
    const cloud = await service.transfer({
      kind: 'cloud',
      cloudWorkspaceId: 'default'
    }, snapshot());

    expect(docker.remoteLocation).toContain('neuraco-dev:/tmp/neuraco-transfers/');
    expect(runCommand).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['exec', '-i', 'neuraco-dev']),
      expect.objectContaining({ input: expect.any(String) })
    );
    expect(uploadCloud).toHaveBeenCalledTimes(1);
    expect(cloud.remoteLocation).toBe(
      'neuraco-cloud://environment-transfers/transfer-1'
    );
    const uploadedManifest = uploadCloud.mock.calls[0][2] as {
      state: { permissions: Record<string, unknown> };
    };
    expect(uploadedManifest.state.permissions).toMatchObject({
      mode: 'manual',
      projectRoot: '',
      allowedFolders: [],
      allowedApplications: [],
      alwaysAllowedSignatures: []
    });
  });
});
