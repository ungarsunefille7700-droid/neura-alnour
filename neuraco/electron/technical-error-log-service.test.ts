import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TechnicalErrorLogService } from './technical-error-log-service';

describe('technical error log', () => {
  it('stores no message, stack, local path, source or secret', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-errors-'));
    const service = new TechnicalErrorLogService(directory);
    const error = Object.assign(
      new Error('source code at C:\\private\\app.ts token=sk-secret-value'),
      { code: 'E_FAIL' }
    );
    await service.record('renderer.startup', error);
    const raw = await readFile(path.join(directory, 'technical-errors.jsonl'), 'utf8');
    expect(raw).not.toContain('source code');
    expect(raw).not.toContain('private');
    expect(raw).not.toContain('sk-secret');
    expect(raw).toContain('E_FAIL');
    expect((await service.list())[0].errorType).toBe('Error');
  });

  it('can be deleted locally', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-errors-'));
    const service = new TechnicalErrorLogService(directory);
    await service.record('application', new Error('private'));
    await service.clear();
    expect(await service.list()).toEqual([]);
  });
});
