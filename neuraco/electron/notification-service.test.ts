import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NeuraCoProject } from './ipc-contract';
import { NotificationService } from './notification-service';

const directories: string[] = [];
const project: NeuraCoProject = {
  id: '0123456789abcdef01234567',
  name: 'Notifications fixture',
  rootPath: 'C:\\project'
};

const createService = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-notifications-'));
  directories.push(directory);
  const storePath = path.join(directory, 'notifications.json');
  const onCreated = vi.fn();
  return {
    service: new NotificationService(storePath, { onCreated }),
    storePath,
    onCreated
  };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  })));
});

describe('NotificationService', () => {
  it('persists, redacts and emits a new actionable notification', async () => {
    const { service, storePath, onCreated } = await createService();
    const notification = await service.create({
      project,
      kind: 'permission_request',
      severity: 'warning',
      title: 'Autorisation requise',
      body: 'Commande avec sk-test-12345678901234567890',
      taskId: 'task-1',
      target: 'chat',
      actions: ['authorize', 'refuse'],
      sensitive: true
    });

    expect(notification.actions).toEqual(['authorize', 'refuse']);
    expect(notification.body).toContain('[MASQUÉ]');
    expect(onCreated).toHaveBeenCalledOnce();
    expect(await readFile(storePath, 'utf8')).not.toContain('sk-test-');
  });

  it('deduplicates repeated low-credit warnings during the bounded window', async () => {
    const { service, onCreated } = await createService();
    const input = {
      project,
      kind: 'credits_low' as const,
      severity: 'warning' as const,
      title: 'Crédits faibles',
      body: 'Il reste 8 %.',
      target: 'usage' as const,
      dedupeKey: 'credits-low-monthly'
    };
    const first = await service.create(input);
    const second = await service.create(input);

    expect(second.id).toBe(first.id);
    expect(onCreated).toHaveBeenCalledOnce();
    expect(await service.list(project.id)).toHaveLength(1);
  });

  it('marks a notification as read and archives it without affecting others', async () => {
    const { service } = await createService();
    const first = await service.create({
      project,
      kind: 'task_completed',
      severity: 'success',
      title: 'Tâche terminée',
      body: 'La tâche est prête.',
      target: 'review'
    });
    const second = await service.create({
      project,
      kind: 'test_failed',
      severity: 'critical',
      title: 'Test échoué',
      body: 'npm test a échoué.',
      target: 'git'
    });

    const read = await service.markRead(project.id, first.id);
    expect(read.find((item) => item.id === first.id)?.readAt).toBeTruthy();
    const remaining = await service.archive(project.id, first.id);
    expect(remaining.map((item) => item.id)).toEqual([second.id]);
    expect(await service.list(project.id, true)).toHaveLength(2);
  });

  it('persists explicit quota and suspicious-plugin alerts', async () => {
    const { service } = await createService();
    await service.create({
      project,
      kind: 'usage_limit_reached',
      severity: 'critical',
      title: 'Plafond atteint',
      body: 'Le quota mensuel est épuisé.',
      target: 'usage'
    });
    await service.create({
      project,
      kind: 'plugin_suspicious',
      severity: 'warning',
      title: 'Plugin à vérifier',
      body: 'Le plugin local n’est pas signé.',
      target: 'protection',
      sensitive: true
    });

    expect((await service.list(project.id)).map((item) => item.kind)).toEqual([
      'plugin_suspicious',
      'usage_limit_reached'
    ]);
  });
});
