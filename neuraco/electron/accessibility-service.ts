import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoAccessibilitySettings,
  NeuraCoAccessibilitySettingsUpdate
} from './ipc-contract';

const VALID_THEMES = new Set<NeuraCoAccessibilitySettings['theme']>([
  'system',
  'light',
  'dark'
]);
const VALID_ZOOM_LEVELS = new Set([90, 100, 110, 125, 150]);
const MAX_SETTINGS_SIZE = 64 * 1024;

const DEFAULT_SETTINGS: NeuraCoAccessibilitySettings = Object.freeze({
  theme: 'system',
  zoomPercent: 100,
  reducedMotion: false,
  highContrast: false
});

const normalizeSettings = (
  value: Partial<NeuraCoAccessibilitySettings> | null | undefined
): NeuraCoAccessibilitySettings => ({
  theme: VALID_THEMES.has(value?.theme as NeuraCoAccessibilitySettings['theme'])
    ? value!.theme!
    : DEFAULT_SETTINGS.theme,
  zoomPercent: VALID_ZOOM_LEVELS.has(Number(value?.zoomPercent))
    ? Number(value!.zoomPercent)
    : DEFAULT_SETTINGS.zoomPercent,
  reducedMotion: value?.reducedMotion === true,
  highContrast: value?.highContrast === true
});

export class AccessibilityService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storePath: string) {}

  async get(): Promise<NeuraCoAccessibilitySettings> {
    await this.writeQueue;
    try {
      const raw = await readFile(this.storePath, 'utf8');
      if (Buffer.byteLength(raw, 'utf8') > MAX_SETTINGS_SIZE) {
        return { ...DEFAULT_SETTINGS };
      }
      return normalizeSettings(JSON.parse(raw) as NeuraCoAccessibilitySettings);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  update(
    update: NeuraCoAccessibilitySettingsUpdate
  ): Promise<NeuraCoAccessibilitySettings> {
    const scheduled = this.writeQueue.then(async () => {
      const current = await this.getWithoutQueue();
      const next = normalizeSettings({ ...current, ...update });
      await mkdir(path.dirname(this.storePath), { recursive: true });
      const temporary = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporary, this.storePath);
      return next;
    });
    this.writeQueue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  private async getWithoutQueue(): Promise<NeuraCoAccessibilitySettings> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      if (Buffer.byteLength(raw, 'utf8') > MAX_SETTINGS_SIZE) {
        return { ...DEFAULT_SETTINGS };
      }
      return normalizeSettings(JSON.parse(raw) as NeuraCoAccessibilitySettings);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
}

