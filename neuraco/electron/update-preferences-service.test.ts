import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UpdatePreferencesService } from './update-preferences-service';

describe('UpdatePreferencesService', () => {
  it('persists a validated stable or beta channel atomically', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-update-'));
    const storePath = path.join(directory, 'preferences.json');
    const service = new UpdatePreferencesService(storePath);
    expect(await service.get()).toMatchObject({
      channel: 'stable',
      autoCheck: true,
      autoDownload: false
    });

    const updated = await service.update({
      channel: 'beta',
      autoDownload: true,
      checkIntervalHours: 6
    });
    expect(updated).toMatchObject({
      channel: 'beta',
      autoDownload: true,
      checkIntervalHours: 6
    });
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toMatchObject({
      version: 1,
      channel: 'beta'
    });
  });

  it('checks only after the configured interval and records the check time', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-update-'));
    const service = new UpdatePreferencesService(path.join(directory, 'preferences.json'));
    const first = new Date('2026-08-01T08:00:00Z');
    expect(await service.shouldCheck(first)).toBe(true);
    await service.markChecked(first);
    expect(await service.shouldCheck(new Date('2026-08-01T12:00:00Z'))).toBe(false);
    expect(await service.shouldCheck(new Date('2026-08-01T20:00:00Z'))).toBe(true);
  });

  it('falls back safely when stored preferences are malformed', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-update-'));
    const storePath = path.join(directory, 'preferences.json');
    const service = new UpdatePreferencesService(storePath);
    await service.update({ channel: 'stable' });
    const recovered = await service.update({
      channel: 'nightly' as 'stable',
      checkIntervalHours: 7
    });
    expect(recovered.channel).toBe('stable');
    expect(recovered.checkIntervalHours).toBe(12);
  });
});
