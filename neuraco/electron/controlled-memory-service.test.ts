import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NeuraCoProject } from './ipc-contract';
import {
  ControlledMemoryService,
  extractControlledMemoryCandidates
} from './controlled-memory-service';

const directories: string[] = [];

const project: NeuraCoProject = {
  id: '0123456789abcdef01234567',
  name: 'Projet mémoire',
  rootPath: process.cwd()
};

const otherProject: NeuraCoProject = {
  id: 'fedcba987654321001234567',
  name: 'Autre projet',
  rootPath: process.cwd()
};

const setup = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-memory-'));
  directories.push(directory);
  const storePath = path.join(directory, 'controlled-memories.json');
  return {
    directory,
    storePath,
    service: new ControlledMemoryService(storePath)
  };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe('ControlledMemoryService', () => {
  it('extracts durable preferences locally without turning ordinary requests into memory', () => {
    expect(extractControlledMemoryCandidates(
      'Utilise toujours FastAPI pour les nouvelles API de ce projet.'
    )).toEqual([{
      content: 'Utilise toujours FastAPI pour les nouvelles API de ce projet.',
      category: 'framework'
    }]);
    expect(extractControlledMemoryCandidates(
      'Corrige le bouton sur la page de connexion.'
    )).toEqual([]);
  });

  it('keeps a suggestion inactive until the user approves it', async () => {
    const { service } = await setup();
    const observed = await service.observe(
      project,
      'La commande de test doit toujours être npm run test:unit.',
      'thread-12345678'
    );

    expect(observed.pendingCount).toBe(1);
    expect(observed.activeCount).toBe(0);
    expect(await service.promptContext(project.id)).toBe('');

    const suggestion = observed.entries[0];
    const approved = await service.update(project, suggestion.id, {
      content: 'La commande de test du projet est npm run test:unit.',
      scope: 'project',
      category: 'test_command',
      status: 'active'
    });

    expect(approved.pendingCount).toBe(0);
    expect(approved.activeCount).toBe(1);
    expect(await service.promptContext(project.id)).toContain(
      'npm run test:unit'
    );
  });

  it('supports project/global scope, editing, disabling and global shutdown', async () => {
    const { service } = await setup();
    const observed = await service.observe(
      project,
      'Je préfère des rapports directs et courts.'
    );
    const memoryId = observed.entries[0].id;
    await service.update(project, memoryId, {
      content: 'Les rapports doivent être directs et courts.',
      scope: 'global',
      category: 'report_style',
      status: 'active'
    });

    expect(await service.promptContext(otherProject.id)).toContain(
      'directs et courts'
    );
    const disabled = await service.update(otherProject, memoryId, {
      status: 'disabled'
    });
    expect(disabled.entries[0].status).toBe('disabled');
    expect(await service.promptContext(project.id)).toBe('');

    await service.update(project, memoryId, { status: 'active' });
    await service.setEnabled(project.id, false);
    expect(await service.promptContext(project.id)).toBe('');
    expect((await service.list(project.id)).enabled).toBe(false);
  });

  it('does not observe or persist new preferences while memory is disabled', async () => {
    const { service, storePath } = await setup();
    await service.setEnabled(project.id, false);
    const state = await service.observe(
      project,
      'Je préfère toujours travailler en français.'
    );

    expect(state.enabled).toBe(false);
    expect(state.entries).toEqual([]);
    const stored = await readFile(storePath, 'utf8');
    expect(stored).not.toContain('travailler en français');
  });

  it('classifies user and project context into explicit memory categories', () => {
    expect(extractControlledMemoryCandidates(
      'Je préfère toujours travailler en français.'
    )[0]?.category).toBe('language');
    expect(extractControlledMemoryCandidates(
      'La décision du projet est de conserver cette architecture.'
    )[0]?.category).toBe('decision');
  });

  it('never stores secrets or private data and persists only sanitized memories', async () => {
    const { service, storePath } = await setup();
    const secret = 'sk-test-12345678901234567890';
    const ignored = await service.observe(
      project,
      `Utilise toujours cette clé API : ${secret}`
    );
    expect(ignored.entries).toEqual([]);

    const safe = await service.observe(
      project,
      'À partir de maintenant, ne modifie jamais les fichiers de récitation.'
    );
    expect(safe.pendingCount).toBe(1);
    const stored = await readFile(storePath, 'utf8');
    expect(stored).not.toContain(secret);
    expect(stored).toContain('fichiers de récitation');
  });

  it('counts repeated observations without creating duplicate suggestions', async () => {
    const { service } = await setup();
    const statement = 'Utilise toujours React pour cette interface.';
    await service.observe(project, statement);
    const repeated = await service.observe(project, statement);

    expect(repeated.entries).toHaveLength(1);
    expect(repeated.entries[0].observationCount).toBe(2);
  });
});
