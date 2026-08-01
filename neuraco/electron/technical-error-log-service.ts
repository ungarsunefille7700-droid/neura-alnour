import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const MAX_ENTRIES = 500;
const SAFE_AREA = /^[a-z0-9_.-]{1,80}$/i;

export interface TechnicalErrorEntry {
  occurredAt: string;
  area: string;
  errorType: string;
  errorCode?: string;
  fingerprint: string;
}

const safeToken = (value: unknown, fallback: string, max = 80): string => {
  const normalized = String(value || '').replace(/[^a-z0-9_.-]/gi, '').slice(0, max);
  return normalized || fallback;
};

export class TechnicalErrorLogService {
  private readonly filePath: string;

  constructor(storageDirectory: string) {
    this.filePath = path.join(storageDirectory, 'technical-errors.jsonl');
  }

  async record(area: string, error: unknown): Promise<TechnicalErrorEntry> {
    const errorType = safeToken(
      error instanceof Error ? error.name : typeof error,
      'UnknownError'
    );
    const rawCode = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
    const errorCode = rawCode === undefined
      ? undefined
      : safeToken(rawCode, 'unknown', 48);
    const safeArea = SAFE_AREA.test(area) ? area : 'application';
    const fingerprint = createHash('sha256')
      .update(`${safeArea}:${errorType}:${errorCode || ''}`)
      .digest('hex')
      .slice(0, 20);
    const entry: TechnicalErrorEntry = {
      occurredAt: new Date().toISOString(),
      area: safeArea,
      errorType,
      errorCode,
      fingerprint
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await this.trim();
    return entry;
  }

  async list(): Promise<TechnicalErrorEntry[]> {
    try {
      return (await readFile(this.filePath, 'utf8'))
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-MAX_ENTRIES)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as TechnicalErrorEntry];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  clear(): Promise<void> {
    return rm(this.filePath, { force: true });
  }

  private async trim(): Promise<void> {
    const entries = await this.list();
    if (entries.length < MAX_ENTRIES) return;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      this.filePath,
      `${entries.slice(-Math.floor(MAX_ENTRIES / 2)).map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
  }
}
