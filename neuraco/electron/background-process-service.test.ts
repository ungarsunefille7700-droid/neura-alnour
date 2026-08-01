import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NeuraCoProject } from './ipc-contract';
import { BackgroundProcessService } from './background-process-service';

const directories: string[] = [];
const services: BackgroundProcessService[] = [];

const setup = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-processes-'));
  directories.push(directory);
  const service = new BackgroundProcessService({
    storePath: path.join(directory, 'processes.json'),
    logsDirectory: path.join(directory, 'logs')
  });
  services.push(service);
  return { directory, service };
};

const project: NeuraCoProject = {
  id: '0123456789abcdef01234567',
  name: 'Projet processus',
  rootPath: process.cwd()
};

const longCommand = (prefix = ''): string => (
  process.platform === 'win32'
    ? `${prefix ? `echo ${prefix} && ` : ''}ping -t 127.0.0.1`
    : `${prefix ? `echo ${prefix}; ` : ''}sleep 30`
);

const waitUntil = async (
  predicate: () => Promise<boolean>,
  timeoutMs = 25_000
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Condition de processus non atteinte.');
};

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll(true)));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200
  })));
});

describe('BackgroundProcessService', () => {
  it('starts, monitors, logs, detaches, restarts and stops a real process', async () => {
    const { service } = await setup();
    const started = await service.start(project, {
      name: 'Serveur test',
      command: longCommand('background-ready'),
      agent: 'Agent tests',
      port: 4312
    }, project.rootPath);

    expect(started.pid).toBeGreaterThan(0);
    expect(started.state).toBe('running');
    expect(started.port).toBe(4312);
    await waitUntil(async () => (
      (await service.log(started.id)).content.includes('background-ready')
    ));

    const listed = await service.list(project.id);
    expect(listed[0]).toMatchObject({
      id: started.id,
      name: 'Serveur test',
      state: 'running',
      attached: true,
      restartable: true
    });
    expect(listed[0].memoryBytes).toBeGreaterThanOrEqual(0);
    expect(listed[0].lastOutput).toContain('background-ready');

    expect((await service.control(started.id, 'detach')).state).toBe('detached');
    expect((await service.control(started.id, 'attach')).state).toBe('running');

    const stopped = await service.control(started.id, 'force_stop');
    expect(['stopped', 'stopping']).toContain(stopped.state);
    await waitUntil(async () => {
      const state = (await service.list(project.id))[0].state;
      return ['stopped', 'orphaned'].includes(state);
    });

    const restarted = await service.control(started.id, 'restart');
    expect(restarted.pid).toBeGreaterThan(0);
    expect(restarted.state).toBe('running');
    await service.control(started.id, 'force_stop');
  }, 60_000);

  it('recovers a surviving detached process from the persistent store', async () => {
    const { directory, service } = await setup();
    const started = await service.start(project, {
      name: 'Processus persistant',
      command: longCommand(),
      agent: 'Agent Cloud',
      keepAlive: true
    }, project.rootPath);
    expect(started.state).toBe('detached');

    const recoveredService = new BackgroundProcessService({
      storePath: path.join(directory, 'processes.json'),
      logsDirectory: path.join(directory, 'logs')
    });
    services.push(recoveredService);
    const recovered = await recoveredService.recoverSurvivors();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      id: started.id,
      state: 'detached',
      attached: false
    });
    await recoveredService.control(started.id, 'force_stop');
  }, 15_000);

  it('never persists clear inline secrets and disables their restart', async () => {
    const { directory, service } = await setup();
    const secret = 'sk-test-12345678901234567890';
    const started = await service.start(project, {
      name: 'Commande sensible',
      command: process.platform === 'win32'
        ? `ping -t 127.0.0.1 && rem --api-key=${secret}`
        : `sleep 30 # --api-key=${secret}`,
      agent: 'Agent sécurité'
    }, project.rootPath);

    expect(started.command).not.toContain(secret);
    expect(started.restartable).toBe(false);
    const stored = await readFile(path.join(directory, 'processes.json'), 'utf8');
    expect(stored).not.toContain(secret);
    await expect(service.control(started.id, 'restart')).rejects.toThrow(
      'ne peut pas être redémarré'
    );
    await service.control(started.id, 'force_stop');
  }, 15_000);
});
