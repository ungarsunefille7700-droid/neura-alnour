import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NeuraCoProject } from './ipc-contract';
import {
  ArtifactService,
  secureArtifactDocument
} from './artifact-service';

const directories: string[] = [];

const setup = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-artifacts-'));
  directories.push(directory);
  const service = new ArtifactService(
    path.join(directory, 'artifacts.json'),
    path.join(directory, 'versions')
  );
  return { directory, service };
};

const project: NeuraCoProject = {
  id: '0123456789abcdef01234567',
  name: 'Projet artefacts',
  rootPath: process.cwd()
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe('ArtifactService', () => {
  it('creates, lists and reads an isolated project artifact', async () => {
    const { service } = await setup();
    const created = await service.create(project, {
      title: 'Rapport interactif',
      description: 'Vue autonome',
      html: '<!doctype html><html><head></head><body><button>Tester</button></body></html>',
      summary: 'Version initiale',
      sources: [{
        label: 'Rapport de tests',
        kind: 'embedded',
        access: 'read_only',
        authorized: true
      }]
    });

    expect(created).toMatchObject({
      projectId: project.id,
      title: 'Rapport interactif',
      versionCount: 1
    });
    expect(created.versions).toHaveLength(1);
    expect(created.html).toContain('<button>Tester</button>');
    expect(await service.list(project.id)).toEqual([
      expect.objectContaining({
        id: created.id,
        versionCount: 1
      })
    ]);
  });

  it('redacts secrets from HTML, metadata and stored version files', async () => {
    const { directory, service } = await setup();
    const secret = 'sk-test-12345678901234567890';
    const created = await service.create(project, {
      title: `Secret ${secret}`,
      description: `Token ${secret}`,
      html: `<html><body data-token="${secret}">${secret}</body></html>`,
      summary: `Création ${secret}`,
      sources: [{
        label: `API ${secret}`,
        kind: 'connector',
        reference: `https://example.test/?api_key=${secret}`,
        access: 'mutating',
        authorized: false
      }]
    });

    expect(JSON.stringify(created)).not.toContain(secret);
    const stored = await readFile(path.join(directory, 'artifacts.json'), 'utf8');
    expect(stored).not.toContain(secret);
    const versionPath = path.join(
      directory,
      'versions',
      created.id,
      `${created.currentVersionId}.html`
    );
    expect(await readFile(versionPath, 'utf8')).not.toContain(secret);
  });

  it('compares versions and restores an earlier one without losing history', async () => {
    const { service } = await setup();
    const created = await service.create(project, {
      title: 'Chronologie',
      description: '',
      html: '<html>\n<body>\n<p>Avant</p>\n</body>\n</html>',
      summary: 'Avant'
    });
    const firstVersion = created.currentVersionId;
    const updated = await service.update(project.id, created.id, {
      html: '<html>\n<body>\n<p>Après</p>\n<button>Nouveau</button>\n</body>\n</html>',
      summary: 'Après'
    });
    const comparison = await service.compare(
      project.id,
      created.id,
      firstVersion,
      updated.currentVersionId
    );

    expect(comparison.addedLines).toBeGreaterThan(0);
    expect(comparison.removedLines).toBeGreaterThan(0);
    expect(comparison.diff).toContain('+ <button>Nouveau</button>');

    const restored = await service.restoreVersion(
      project.id,
      created.id,
      firstVersion
    );
    expect(restored.html).toContain('<p>Avant</p>');
    expect(restored.versionCount).toBe(3);
    expect(restored.versions[0].summary).toContain('version 1');
  });

  it('renames, soft-deletes and keeps deleted artifacts recoverable in storage', async () => {
    const { service } = await setup();
    const created = await service.create(project, {
      title: 'Ancien nom',
      description: '',
      html: '<html><body>Archive</body></html>'
    });
    const renamed = await service.rename(project.id, created.id, 'Nouveau nom');
    expect(renamed.title).toBe('Nouveau nom');

    expect(await service.delete(project.id, created.id)).toEqual([]);
    expect(await service.list(project.id)).toEqual([]);
    expect(await service.list(project.id, true)).toEqual([
      expect.objectContaining({
        id: created.id,
        title: 'Nouveau nom',
        deletedAt: expect.any(String)
      })
    ]);
  });

  it('exports HTML with a restrictive CSP and no network capability', async () => {
    const { directory, service } = await setup();
    const created = await service.create(project, {
      title: 'Export sécurisé',
      description: '',
      html: '<!doctype html><html><head><title>Test</title></head><body>OK</body></html>'
    });
    const target = path.join(directory, 'exports', 'rapport.html');
    await service.export(project.id, created.id, target);
    const exported = await readFile(target, 'utf8');

    expect(exported).toContain('Content-Security-Policy');
    expect(exported).toContain("connect-src 'none'");
    expect(exported).toContain("form-action 'none'");
    expect(exported).toContain('<title>Test</title>');
    expect(secureArtifactDocument('<p>Fragment</p>')).toContain(
      '<!doctype html>'
    );
  });
});
