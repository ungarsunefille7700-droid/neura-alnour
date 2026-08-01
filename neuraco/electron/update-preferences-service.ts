import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoUpdateChannel,
  NeuraCoUpdatePreferences
} from './ipc-contract';

interface StoredUpdatePreferences extends NeuraCoUpdatePreferences {
  version: 1;
}

const MAX_FILE_BYTES = 32 * 1024;
const CHANNELS = new Set<NeuraCoUpdateChannel>(['stable', 'beta']);
const INTERVALS = new Set([1, 3, 6, 12, 24, 48]);

const defaults = (): StoredUpdatePreferences => ({
  version: 1,
  channel: 'stable',
  autoCheck: true,
  autoDownload: false,
  checkIntervalHours: 12
});

const normalize = (value: unknown): StoredUpdatePreferences => {
  const source = value as Partial<StoredUpdatePreferences> | null;
  const fallback = defaults();
  const lastCheckedAt = typeof source?.lastCheckedAt === 'string'
    && Number.isFinite(Date.parse(source.lastCheckedAt))
    ? new Date(source.lastCheckedAt).toISOString()
    : undefined;
  return {
    version: 1,
    channel: CHANNELS.has(source?.channel as NeuraCoUpdateChannel)
      ? source!.channel!
      : fallback.channel,
    autoCheck: source?.autoCheck !== false,
    autoDownload: source?.autoDownload === true,
    checkIntervalHours: INTERVALS.has(Number(source?.checkIntervalHours))
      ? Number(source!.checkIntervalHours)
      : fallback.checkIntervalHours,
    ...(lastCheckedAt ? { lastCheckedAt } : {})
  };
};

const publicPreferences = (
  value: StoredUpdatePreferences
): NeuraCoUpdatePreferences => ({
  channel: value.channel,
  autoCheck: value.autoCheck,
  autoDownload: value.autoDownload,
  checkIntervalHours: value.checkIntervalHours,
  ...(value.lastCheckedAt ? { lastCheckedAt: value.lastCheckedAt } : {})
});

export class UpdatePreferencesService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storePath: string) {}

  async get(): Promise<NeuraCoUpdatePreferences> {
    await this.writeQueue;
    return publicPreferences(await this.read());
  }

  update(
    update: Partial<NeuraCoUpdatePreferences>
  ): Promise<NeuraCoUpdatePreferences> {
    const operation = this.writeQueue.then(async () => {
      const current = await this.read();
      const next = normalize({ ...current, ...update });
      await this.write(next);
      return publicPreferences(next);
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async shouldCheck(now = new Date()): Promise<boolean> {
    const preferences = await this.get();
    if (!preferences.autoCheck) return false;
    if (!preferences.lastCheckedAt) return true;
    return now.getTime() - Date.parse(preferences.lastCheckedAt)
      >= preferences.checkIntervalHours * 60 * 60 * 1000;
  }

  markChecked(now = new Date()): Promise<NeuraCoUpdatePreferences> {
    return this.update({ lastCheckedAt: now.toISOString() });
  }

  private async read(): Promise<StoredUpdatePreferences> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      if (Buffer.byteLength(raw, 'utf8') > MAX_FILE_BYTES) return defaults();
      return normalize(JSON.parse(raw));
    } catch {
      return defaults();
    }
  }

  private async write(value: StoredUpdatePreferences): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporary, this.storePath);
  }
}
