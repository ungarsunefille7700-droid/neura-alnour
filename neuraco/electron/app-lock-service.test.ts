import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppLockService, type AppLockProtector } from './app-lock-service';

const directories: string[] = [];
const protector: AppLockProtector = {
  available: () => true,
  encrypt: (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decrypt: (value) => value.toString('utf8').replace(/^protected:/, '')
};

const createService = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-lock-'));
  directories.push(directory);
  const storePath = path.join(directory, 'app-lock.bin');
  const onState = vi.fn();
  const service = new AppLockService({ storePath, protector, onState });
  await service.initialize();
  return { service, storePath, onState };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe('AppLockService', () => {
  it('persists only a salted scrypt PIN record inside protected storage', async () => {
    const { service, storePath } = await createService();
    const state = await service.setPin('4286');
    const persisted = await readFile(storePath, 'utf8');

    expect(state.pinEnabled).toBe(true);
    expect(persisted).not.toContain('4286');
    expect(persisted).toContain('protected:');
    expect(persisted).toContain('"salt"');
    expect(persisted).toContain('"hash"');
  });

  it('locks manually and unlocks only with the correct PIN', async () => {
    const { service } = await createService();
    await service.setPin('4286');
    expect(service.lock('manual')).toMatchObject({
      locked: true,
      reason: 'manual'
    });

    await expect(service.unlockWithPin('1111')).rejects.toThrow('incorrect');
    expect(service.state().locked).toBe(true);
    expect(await service.unlockWithPin('4286')).toMatchObject({
      locked: false,
      failedAttempts: 0
    });
  });

  it('applies a cooldown after repeated invalid PIN attempts', async () => {
    const { service } = await createService();
    await service.setPin('4286');
    service.lock('manual');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.unlockWithPin('0000')).rejects.toThrow('incorrect');
    }
    expect(service.state().retryAt).toBeTruthy();
    await expect(service.unlockWithPin('4286')).rejects.toThrow('Trop de tentatives');
  });

  it('restores startup locking and detects the configured idle threshold', async () => {
    const { service, storePath } = await createService();
    await service.setPin('4286');
    await service.updateSettings({
      lockOnStartup: true,
      idleTimeoutMinutes: 5,
      maskSensitiveNotifications: true
    });

    const restarted = new AppLockService({ storePath, protector });
    const state = await restarted.initialize();
    expect(state).toMatchObject({ locked: true, reason: 'startup' });
    await restarted.unlockWithPin('4286');
    expect(restarted.shouldLockForIdle(299)).toBe(false);
    expect(restarted.shouldLockForIdle(300)).toBe(true);
  });

  it('does not allow automatic locking without an unlock factor', async () => {
    const { service } = await createService();
    await expect(service.updateSettings({
      lockOnStartup: true,
      idleTimeoutMinutes: 0,
      maskSensitiveNotifications: true
    })).rejects.toThrow('Configurez');
  });
});
