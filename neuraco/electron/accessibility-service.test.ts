import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccessibilityService } from './accessibility-service';

describe('AccessibilityService', () => {
  it('returns safe defaults when no preferences exist', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-a11y-'));
    const service = new AccessibilityService(path.join(directory, 'settings.json'));

    await expect(service.get()).resolves.toEqual({
      theme: 'system',
      zoomPercent: 100,
      reducedMotion: false,
      highContrast: false
    });
  });

  it('persists validated accessibility preferences', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-a11y-'));
    const storePath = path.join(directory, 'settings.json');
    const service = new AccessibilityService(storePath);

    await expect(service.update({
      theme: 'dark',
      zoomPercent: 125,
      reducedMotion: true,
      highContrast: true
    })).resolves.toEqual({
      theme: 'dark',
      zoomPercent: 125,
      reducedMotion: true,
      highContrast: true
    });

    const persisted = JSON.parse(await readFile(storePath, 'utf8'));
    expect(persisted).toEqual({
      theme: 'dark',
      zoomPercent: 125,
      reducedMotion: true,
      highContrast: true
    });
    await expect(new AccessibilityService(storePath).get()).resolves.toEqual(persisted);
  });

  it('rejects unsupported themes and zoom levels', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-a11y-'));
    const service = new AccessibilityService(path.join(directory, 'settings.json'));

    const settings = await service.update({
      theme: 'sepia' as never,
      zoomPercent: 999
    });

    expect(settings.theme).toBe('system');
    expect(settings.zoomPercent).toBe(100);
  });
});
