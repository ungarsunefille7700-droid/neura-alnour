import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatabaseMigrationService } from './database-migration-service';

describe('DatabaseMigrationService', () => {
  it('applies a built-in migration and commits its schema version', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-migration-'));
    const service = new DatabaseMigrationService(directory);
    const version = await service.run([{
      id: 'preferences-v1',
      from: 0,
      to: 1,
      targets: ['updates/preferences.json'],
      apply: (context) => context.writeJson('updates/preferences.json', {
        version: 1,
        channel: 'stable'
      })
    }]);
    expect(version).toBe(1);
    expect(JSON.parse(await readFile(
      path.join(directory, 'updates', 'preferences.json'),
      'utf8'
    ))).toMatchObject({ channel: 'stable' });
  });

  it('restores every target when a migration fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-migration-'));
    const target = path.join(directory, 'state.json');
    await writeFile(target, JSON.stringify({ value: 'before' }), 'utf8');
    const service = new DatabaseMigrationService(directory);
    await expect(service.run([{
      id: 'failing-v1',
      from: 0,
      to: 1,
      targets: ['state.json', 'created.json'],
      apply: async (context) => {
        await context.writeJson('state.json', { value: 'after' });
        await context.writeJson('created.json', { temporary: true });
        throw new Error('test failure');
      }
    }])).rejects.toThrow('annulée et restaurée');
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ value: 'before' });
    await expect(readFile(path.join(directory, 'created.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });
});
