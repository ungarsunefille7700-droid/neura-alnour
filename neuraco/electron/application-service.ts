import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoApplication,
  NeuraCoApplicationProcess,
  NeuraCoProject
} from './ipc-contract';
import { createSandboxedEnvironment } from './sandbox-environment';

interface ApplicationDefinition {
  id: string;
  name: string;
  candidates: (environment: NodeJS.ProcessEnv) => string[];
  capabilities: string[];
  supportsTarget: boolean;
  extraArgs?: (storageDirectory: string) => string[];
}

interface ApplicationServiceOptions {
  storageDirectory: string;
  spawnProcess?: typeof spawn;
}

const DEFINITIONS: readonly ApplicationDefinition[] = [
  {
    id: 'explorer',
    name: 'Explorateur Windows',
    candidates: (env) => [path.join(env.WINDIR || 'C:\\Windows', 'explorer.exe')],
    capabilities: ['Ouvrir le projet ou un dossier autorisé'],
    supportsTarget: true
  },
  {
    id: 'notepad',
    name: 'Bloc-notes',
    candidates: (env) => [path.join(env.WINDIR || 'C:\\Windows', 'System32', 'notepad.exe')],
    capabilities: ['Ouvrir un fichier texte autorisé'],
    supportsTarget: true
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    candidates: (env) => [
      path.join(env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(env.ProgramFiles || '', 'Microsoft VS Code', 'Code.exe'),
      path.join(env['ProgramFiles(x86)'] || '', 'Microsoft VS Code', 'Code.exe')
    ],
    capabilities: ['Ouvrir un projet ou fichier autorisé', 'Extensions et terminal intégrés'],
    supportsTarget: true
  },
  {
    id: 'edge-isolated',
    name: 'Microsoft Edge isolé',
    candidates: (env) => [
      path.join(env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ],
    capabilities: ['Profil NeuraCo séparé', 'Navigation manuelle'],
    supportsTarget: false,
    extraArgs: (storage) => [
      `--user-data-dir=${path.join(storage, 'edge-profile')}`,
      '--no-first-run',
      'about:blank'
    ]
  },
  {
    id: 'chrome-isolated',
    name: 'Google Chrome isolé',
    candidates: (env) => [
      path.join(env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ],
    capabilities: ['Profil NeuraCo séparé', 'Navigation manuelle'],
    supportsTarget: false,
    extraArgs: (storage) => [
      `--user-data-dir=${path.join(storage, 'chrome-profile')}`,
      '--no-first-run',
      'about:blank'
    ]
  },
  {
    id: 'fivem',
    name: 'FiveM',
    candidates: (env) => [
      path.join(env.LOCALAPPDATA || '', 'FiveM', 'FiveM.app', 'FiveM.exe'),
      path.join(env.LOCALAPPDATA || '', 'FiveM', 'FiveM.exe')
    ],
    capabilities: ['Lancer FiveM dans son profil local'],
    supportsTarget: false
  },
  {
    id: 'blender',
    name: 'Blender',
    candidates: (env) => (
      ['5.1', '5.0', '4.5', '4.4', '4.3', '4.2', '4.1', '4.0', '3.6'].map(
        (version) => path.join(
          env.ProgramFiles || 'C:\\Program Files',
          'Blender Foundation',
          `Blender ${version}`,
          'blender.exe'
        )
      )
    ),
    capabilities: ['Ouvrir un fichier .blend autorisé', 'API Python structurée'],
    supportsTarget: true
  },
  {
    id: '3dsmax',
    name: '3ds Max',
    candidates: (env) => (
      ['2027', '2026', '2025', '2024', '2023', '2022', '2021', '2020'].map(
        (version) => path.join(
          env.ProgramFiles || 'C:\\Program Files',
          'Autodesk',
          `3ds Max ${version}`,
          '3dsmax.exe'
        )
      )
    ),
    capabilities: ['Ouvrir un fichier .max autorisé', 'MAXScript structuré'],
    supportsTarget: true
  }
];

const fileExists = async (target: string): Promise<boolean> => {
  if (!target) return false;
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

export const validateApplicationTarget = (
  project: NeuraCoProject,
  target?: string
): string | undefined => {
  if (!target) return undefined;
  const root = path.resolve(project.rootPath);
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('La cible de l’application est hors du projet autorisé.');
  }
  return resolved;
};

export class ApplicationService {
  private readonly storageDirectory: string;
  private readonly spawnProcess: typeof spawn;
  private readonly executables = new Map<string, string>();
  private readonly processes = new Map<string, {
    process: ChildProcess;
    state: NeuraCoApplicationProcess;
  }>();

  constructor(options: ApplicationServiceOptions) {
    this.storageDirectory = options.storageDirectory;
    this.spawnProcess = options.spawnProcess || spawn;
  }

  async list(): Promise<NeuraCoApplication[]> {
    const applications: NeuraCoApplication[] = [];
    for (const definition of DEFINITIONS) {
      const candidates = definition.candidates(process.env).filter(Boolean);
      const executable = candidates.find((candidate) => this.executables.get(definition.id) === candidate)
        || (await Promise.all(candidates.map(async (candidate) => ({
          candidate,
          exists: await fileExists(candidate)
        })))).find((candidate) => candidate.exists)?.candidate
        || '';
      if (executable) this.executables.set(definition.id, executable);
      applications.push({
        id: definition.id,
        name: definition.name,
        executable,
        installed: Boolean(executable),
        capabilities: definition.capabilities
      });
    }
    return applications;
  }

  async launch(
    project: NeuraCoProject,
    applicationId: string,
    target?: string
  ): Promise<NeuraCoApplicationProcess> {
    const definition = DEFINITIONS.find((item) => item.id === applicationId);
    if (!definition) throw new Error('Application non autorisée.');
    const applications = await this.list();
    const application = applications.find((item) => item.id === applicationId);
    if (!application?.installed || !application.executable) {
      throw new Error(`${definition.name} n’est pas installé ou détectable.`);
    }
    if (target && !definition.supportsTarget) {
      throw new Error('Cette application n’accepte pas de cible depuis NeuraCo.');
    }
    const safeTarget = validateApplicationTarget(project, target);
    const args = [
      ...(definition.extraArgs?.(this.storageDirectory) || []),
      ...(safeTarget ? [safeTarget] : definition.supportsTarget ? [project.rootPath] : [])
    ];
    const child = this.spawnProcess(application.executable, args, {
      cwd: project.rootPath,
      env: createSandboxedEnvironment(),
      windowsHide: false,
      shell: false,
      detached: false,
      stdio: 'ignore'
    });
    if (!child.pid) throw new Error(`${definition.name} n’a pas démarré.`);
    const state: NeuraCoApplicationProcess = {
      id: randomUUID(),
      applicationId,
      name: definition.name,
      pid: child.pid,
      startedAt: new Date().toISOString(),
      target: safeTarget
    };
    this.processes.set(state.id, { process: child, state });
    child.once('exit', () => this.processes.delete(state.id));
    child.once('error', () => this.processes.delete(state.id));
    return state;
  }

  stop(processId: string): boolean {
    const tracked = this.processes.get(processId);
    if (!tracked) return false;
    const stopped = tracked.process.kill();
    if (stopped) this.processes.delete(processId);
    return stopped;
  }

  stopAll(): number {
    let stopped = 0;
    for (const id of [...this.processes.keys()]) {
      if (this.stop(id)) stopped += 1;
    }
    return stopped;
  }
}
