// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { openProjectRoot } from './workspace-core';
import {
  exportProjectPackage,
  projectArchiveDefaultName,
  validateProjectPackage
} from './project-package-service';

const temporaryRoots: string[] = [];

const createFiveMProject = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-fivem-package-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, 'client'));
  await mkdir(path.join(root, 'server'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'fxmanifest.lua'), [
    "fx_version 'cerulean'",
    "game 'gta5'",
        "client_scripts { 'client/**/*.lua' }",
    "server_script 'server/main.lua'",
    ''
  ].join('\n'));
  await writeFile(path.join(root, 'client', 'main.lua'), 'print("client ready")\n');
  await writeFile(path.join(root, 'server', 'main.lua'), 'print("server ready")\n');
  await writeFile(path.join(root, 'README.md'), '# Ressource FiveM\n');
  await writeFile(path.join(root, '.env'), 'PRIVATE_TOKEN=never-export\n');
  await writeFile(path.join(root, 'node_modules', 'ignored.js'), 'ignored\n');
  return { root, project: await openProjectRoot(root) };
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('NeuraCo project package service', () => {
  it('validates a complete FiveM resource and exports only safe project files', async () => {
    const { root, project } = await createFiveMProject();
    const validation = await validateProjectPackage(project);

    expect(validation.kind).toBe('fivem');
    expect(validation.valid).toBe(true);
    expect(validation.resources).toHaveLength(1);
    expect(validation.errors).toEqual([]);
    expect(validation.excludedEntries).toBeGreaterThanOrEqual(2);

    const destination = path.join(root, '..', `${path.basename(root)}.zip`);
    temporaryRoots.push(destination);
    const exported = await exportProjectPackage(project, destination, validation);
    expect(exported.canceled).toBe(false);
    expect(exported.fileCount).toBe(4);
    expect(exported.sha256).toMatch(/^[A-F0-9]{64}$/);

    const archive = await JSZip.loadAsync(await readFile(destination));
    expect(Object.keys(archive.files)).toEqual(expect.arrayContaining([
      'fxmanifest.lua',
      'client/main.lua',
      'server/main.lua',
      'README.md'
    ]));
    expect(archive.file('.env')).toBeNull();
    expect(archive.file('node_modules/ignored.js')).toBeNull();
  });

  it('reports missing FiveM files before export', async () => {
    const { root, project } = await createFiveMProject();
    await writeFile(
      path.join(root, 'fxmanifest.lua'),
      "fx_version 'cerulean'\ngame 'gta5'\nserver_script 'server/missing.lua'\n"
    );
    const validation = await validateProjectPackage(project);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('server/missing.lua');
  });

  it('creates a Windows-safe default archive name', () => {
    expect(projectArchiveDefaultName('Pack FiveM: RP / v1')).toBe('Pack FiveM- RP - v1.zip');
  });
});
