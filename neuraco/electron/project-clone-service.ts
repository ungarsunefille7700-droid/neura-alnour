import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { NeuraCoProject } from './ipc-contract';
import { openProjectRoot } from './workspace-core';

const execFileAsync = promisify(execFile);

export const validateGitRepositoryUrl = (value: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('L\u2019URL du d\u00e9p\u00f4t Git n\u2019est pas valide.');
  }
  if (
    parsed.protocol !== 'https:'
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new Error('Utilisez une URL Git HTTPS sans identifiant, mot de passe ni fragment.');
  }
  const repositoryName = path.posix.basename(parsed.pathname).replace(/\.git$/i, '');
  if (!repositoryName || repositoryName === '.' || repositoryName === '..') {
    throw new Error('L\u2019URL ne contient pas de nom de d\u00e9p\u00f4t exploitable.');
  }
  return parsed;
};

export const repositoryNameFromUrl = (value: string): string => {
  const parsed = validateGitRepositoryUrl(value);
  return path.posix.basename(parsed.pathname).replace(/\.git$/i, '');
};

export const cloneGitRepository = async (
  parentPath: string,
  repositoryUrl: string
): Promise<NeuraCoProject> => {
  const parsed = validateGitRepositoryUrl(repositoryUrl);
  const resolvedParent = await realpath(parentPath);
  if (!(await stat(resolvedParent)).isDirectory()) {
    throw new Error('Le dossier parent s\u00e9lectionn\u00e9 n\u2019est pas valide.');
  }
  const repositoryName = repositoryNameFromUrl(parsed.toString());
  const finalPath = path.join(resolvedParent, repositoryName);
  try {
    await stat(finalPath);
    throw new Error('Un fichier ou un dossier porte d\u00e9j\u00e0 le nom du d\u00e9p\u00f4t.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporaryPath = path.join(
    resolvedParent,
    `.neuraco-clone-${randomUUID()}`
  );
  try {
    await execFileAsync('git', [
      'clone',
      '--progress',
      '--',
      parsed.toString(),
      temporaryPath
    ], {
      windowsHide: true,
      timeout: 5 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024
    });
    await rename(temporaryPath, finalPath);
    return openProjectRoot(finalPath);
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined);
    const detail = error instanceof Error ? error.message : 'erreur Git inconnue';
    throw new Error(`Le clonage Git a \u00e9chou\u00e9 : ${detail}`);
  }
};
