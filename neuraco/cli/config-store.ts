import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openProjectRoot } from '../electron/workspace-core';
import type { NeuraCoProject } from '../electron/ipc-contract';
import type { CliModel } from './argument-parser';

interface CliConfig {
  version: 1;
  project?: NeuraCoProject;
  sessions: Record<string, string>;
  preferredModel: CliModel;
  preferredAgent: string;
  defaultBudget?: number;
}

const storageDirectory = (): string => path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'NeuraCo'
);

const configPath = (): string => path.join(storageDirectory(), 'cli-config.json');

const emptyConfig = (): CliConfig => ({
  version: 1,
  sessions: {},
  preferredModel: 'auto',
  preferredAgent: 'assistant'
});

const sanitizeConfig = (raw: Partial<CliConfig>): CliConfig => {
  const models: CliModel[] = [
    'auto',
    'claude-sonnet-4-5',
    'gpt-4o',
    'gemini-2.5-flash'
  ];
  return {
    version: 1,
    project: raw.project
      && typeof raw.project.id === 'string'
      && typeof raw.project.name === 'string'
      && typeof raw.project.rootPath === 'string'
      ? raw.project
      : undefined,
    sessions: raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
    preferredModel: models.includes(raw.preferredModel as CliModel)
      ? raw.preferredModel as CliModel
      : 'auto',
    preferredAgent: typeof raw.preferredAgent === 'string'
      && /^[A-Za-z0-9_-]{2,80}$/.test(raw.preferredAgent)
      ? raw.preferredAgent
      : 'assistant',
    defaultBudget: Number.isInteger(raw.defaultBudget)
      && Number(raw.defaultBudget) >= 1
      && Number(raw.defaultBudget) <= 100
      ? Number(raw.defaultBudget)
      : undefined
  };
};

export const loadCliConfig = async (): Promise<CliConfig> => {
  try {
    const content = await readFile(configPath(), 'utf8');
    if (content.length > 256 * 1024) throw new Error('Configuration NeuraCo trop volumineuse.');
    return sanitizeConfig(JSON.parse(content) as Partial<CliConfig>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return emptyConfig();
  }
};

export const saveCliConfig = async (config: CliConfig): Promise<void> => {
  const target = configPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, JSON.stringify(sanitizeConfig(config), null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  await rename(temporary, target);
};

export const setCurrentProject = async (requestedPath: string): Promise<NeuraCoProject> => {
  const resolved = await realpath(path.resolve(requestedPath));
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error('Le projet NeuraCo doit être un dossier.');
  }
  const project = await openProjectRoot(resolved);
  const config = await loadCliConfig();
  await saveCliConfig({ ...config, project });
  return project;
};

export const clearCliConfig = async (): Promise<void> => {
  await rm(configPath(), { force: true });
};

