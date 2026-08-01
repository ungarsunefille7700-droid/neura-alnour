import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RecoveryService } from './recovery-service';

const temporaryDirectories: string[] = [];

const fixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-recovery-'));
  temporaryDirectories.push(directory);
  const projectRoot = path.join(directory, 'project');
  await mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await writeFile(path.join(projectRoot, 'src', 'app.ts'), 'before\n');
  return {
    project: { id: 'project-1', name: 'project', rootPath: projectRoot },
    service: new RecoveryService(path.join(directory, 'recovery')),
    projectRoot
  };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('NeuraCo local recovery', () => {
  it('restores a file checkpoint after an overwrite', async () => {
    const { project, projectRoot, service } = await fixture();
    const checkpoint = await service.createFileCheckpoint(
      project,
      'src/app.ts',
      'before write'
    );
    await writeFile(path.join(projectRoot, 'src', 'app.ts'), 'after\n');
    await service.restoreCheckpoint(project, checkpoint.id);
    expect(await readFile(path.join(projectRoot, 'src', 'app.ts'), 'utf8')).toBe('before\n');
  });

  it('moves a file to recoverable trash and restores it', async () => {
    const { project, projectRoot, service } = await fixture();
    const entry = await service.moveToTrash(project, 'src/app.ts');
    expect((await service.listTrash(project))[0].relativePath).toBe('src/app.ts');
    await service.restoreTrash(project, entry.id);
    expect(await readFile(path.join(projectRoot, 'src', 'app.ts'), 'utf8')).toBe('before\n');
    expect(await service.listTrash(project)).toEqual([]);
  });

  it('creates and restores a project checkpoint without copying secrets', async () => {
    const { project, projectRoot, service } = await fixture();
    await writeFile(path.join(projectRoot, '.env'), 'SECRET=value');
    const checkpoint = await service.createProjectCheckpoint(project, 'manual');
    await writeFile(path.join(projectRoot, 'src', 'app.ts'), 'broken\n');
    await writeFile(path.join(projectRoot, '.env'), 'SECRET=changed');
    await service.restoreCheckpoint(project, checkpoint.id);
    expect(await readFile(path.join(projectRoot, 'src', 'app.ts'), 'utf8')).toBe('before\n');
    expect(await readFile(path.join(projectRoot, '.env'), 'utf8')).toBe('SECRET=changed');
    expect(checkpoint.size).toBeGreaterThan(0);
  });

  it('captures the active conversation and task settings without exposing them in lists', async () => {
    const { project, service } = await fixture();
    const taskSettings = {
      taskMode: 'code' as const,
      effort: 'deep' as const,
      communicationStyle: 'detailed' as const,
      executionMode: 'local' as const,
      includeActiveFile: true
    };
    const conversation = {
      projectId: project.id,
      projectName: project.name,
      threadId: 'thread-1',
      title: 'Correction',
      archived: false,
      executionMode: 'local' as const,
      taskSettings,
      messages: [{
        id: 'message-1',
        role: 'user' as const,
        content: 'Corriger le projet'
      }],
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z'
    };
    const checkpoint = await service.createProjectCheckpoint(project, 'before change', {
      trigger: 'important_change',
      conversation,
      taskSettings
    });

    expect(checkpoint).toMatchObject({
      trigger: 'important_change',
      hasConversation: true,
      hasTaskSettings: true
    });
    expect(checkpoint).not.toHaveProperty('conversation');
    const snapshot = await service.getCheckpointSnapshot(project, checkpoint.id);
    expect(snapshot.conversation?.messages[0].content).toBe('Corriger le projet');
    expect(snapshot.taskSettings?.effort).toBe('deep');
    expect((await service.listCheckpoints(project))[0]).not.toHaveProperty('conversation');
  });

  it('applies the configurable checkpoint retention immediately', async () => {
    const { project, service } = await fixture();
    expect((await service.getRetention()).maxPerProject).toBe(30);
    await service.updateRetention(5);
    const preserved = await service.createProjectCheckpoint(project, 'checkpoint-0');
    for (let index = 1; index < 5; index += 1) {
      await service.createProjectCheckpoint(project, `checkpoint-${index}`);
    }
    await service.createProjectCheckpoint(project, 'checkpoint-5', {
      preserveCheckpointIds: [preserved.id]
    });
    expect(await service.listCheckpoints(project)).toHaveLength(5);
    await expect(
      service.getCheckpointSnapshot(project, preserved.id)
    ).resolves.toMatchObject({ checkpoint: { id: preserved.id } });
    expect((await service.getRetention()).maxPerProject).toBe(5);
  });
});
