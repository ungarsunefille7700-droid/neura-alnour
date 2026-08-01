// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  invalidateProjectScanCache,
  normalizeProjectPath,
  openProjectRoot,
  readProjectTextFile,
  scanProject,
  scanProjectCached,
  writeProjectTextFile
} from './workspace-core';

const temporaryRoots: string[] = [];

const createProject = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-workspace-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'src', 'main.ts'), 'export const answer = 42;\n', 'utf8');
  await writeFile(path.join(root, '.env'), 'SECRET=hidden\n', 'utf8');
  await writeFile(path.join(root, 'node_modules', 'ignored.js'), 'ignored', 'utf8');
  return { root, project: await openProjectRoot(root) };
};

afterEach(async () => {
  invalidateProjectScanCache();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('NeuraCo workspace boundary', () => {
  it('indexes only project files that are safe to expose', async () => {
    const { project } = await createProject();
    const snapshot = await scanProject(project);

    expect(snapshot.indexedFiles).toBe(1);
    expect(snapshot.excludedEntries).toBe(2);
    expect(snapshot.files.map((entry) => entry.name)).toEqual(['src']);
    expect(snapshot.files[0].children?.[0].relativePath).toBe('src/main.ts');
  });

  it('reads and atomically updates a text file inside the selected root', async () => {
    const { root, project } = await createProject();
    const opened = await readProjectTextFile(project, 'src/main.ts');
    expect(opened.language).toBe('typescript');
    expect(opened.content).toContain('answer = 42');

    const saved = await writeProjectTextFile(project, 'src/main.ts', 'export const answer = 43;\n');
    expect(saved.relativePath).toBe('src/main.ts');
    expect(await readFile(path.join(root, 'src', 'main.ts'), 'utf8')).toContain('answer = 43');
  });

  it('rejects traversal and sensitive files', async () => {
    const { project } = await createProject();
    expect(() => normalizeProjectPath('../outside.txt')).toThrow(/exclu|autorisé/i);
    await expect(readProjectTextFile(project, '.env')).rejects.toThrow(/exclu/i);
  });

  it('deduplicates concurrent scans, caches briefly and refreshes on demand', async () => {
    const { root, project } = await createProject();
    const [first, concurrent] = await Promise.all([
      scanProjectCached(project, { force: true }),
      scanProjectCached(project, { force: true })
    ]);
    expect(concurrent).toBe(first);
    expect(first.indexedFiles).toBe(1);

    await writeFile(path.join(root, 'src', 'later.ts'), 'export const later = true;\n', 'utf8');
    const cached = await scanProjectCached(project);
    expect(cached).toBe(first);
    expect(cached.indexedFiles).toBe(1);

    const refreshed = await scanProjectCached(project, { force: true });
    expect(refreshed.indexedFiles).toBe(2);
  });

  it('yields to the event loop while indexing a larger project', async () => {
    const { root, project } = await createProject();
    await Promise.all(Array.from({ length: 300 }, (_, index) => (
      writeFile(
        path.join(root, 'src', `module-${String(index).padStart(3, '0')}.ts`),
        `export const value${index} = ${index};\n`,
        'utf8'
      )
    )));
    let eventLoopAdvanced = false;
    setImmediate(() => {
      eventLoopAdvanced = true;
    });
    const snapshot = await scanProject(project);
    expect(snapshot.indexedFiles).toBe(301);
    expect(eventLoopAdvanced).toBe(true);
  });
});
