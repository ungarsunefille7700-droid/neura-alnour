import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  projectInstructionsPrompt,
  readProjectInstructions
} from './project-instructions-service';

const directories: string[] = [];

const fixture = async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'neuraco-instructions-'));
  directories.push(rootPath);
  return {
    project: { id: 'project-1', name: 'project', rootPath },
    filePath: path.join(rootPath, 'NEURACO.md')
  };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('NEURACO.md project instructions', () => {
  it('loads root instructions and masks secrets before prompt injection', async () => {
    const { project, filePath } = await fixture();
    await writeFile(
      filePath,
      '# Projet\nToujours lancer npm test.\nAPI_KEY=super-secret-value',
      'utf8'
    );
    const state = await readProjectInstructions(project);
    const prompt = await projectInstructionsPrompt(project);
    expect(state.found).toBe(true);
    expect(state.contentPreview).toContain('npm test');
    expect(prompt).toContain('INSTRUCTIONS DU PROJET');
    expect(prompt).not.toContain('super-secret-value');
    expect(state.warnings).toContain(
      'Les secrets détectés ont été masqués avant utilisation.'
    );
  });

  it('treats a missing file as optional and refuses oversized instructions', async () => {
    const { project, filePath } = await fixture();
    expect((await readProjectInstructions(project)).found).toBe(false);
    await writeFile(filePath, 'x'.repeat(65 * 1024), 'utf8');
    const oversized = await readProjectInstructions(project);
    expect(oversized.found).toBe(true);
    expect(oversized.contentPreview).toBeUndefined();
    expect(oversized.warnings[0]).toContain('64 Ko');
  });
});
