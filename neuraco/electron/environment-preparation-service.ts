import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoEnvironmentPreparationConfig,
  NeuraCoEnvironmentPreparationExecution,
  NeuraCoEnvironmentPreparationPreview,
  NeuraCoEnvironmentPreparationUpdate,
  NeuraCoEnvironmentTarget
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';
import { createSandboxedEnvironment } from './sandbox-environment';

const MAX_SCRIPT_LENGTH = 12_000;
const MAX_OUTPUT_LENGTH = 160_000;
const MAX_EXECUTIONS = 100;
const SAFE_REMOTE_NAME = /^[A-Za-z0-9_.:@/-]{1,240}$/;
const UNSAFE_REMOTE_PATH = /[\0\r\n]/;
const SENSITIVE_ENVIRONMENT_NAME =
  /(api|auth|access|refresh|private|stripe|mongo|database).*(key|token|secret|url)|key|token|secret|password|passwd|credential/i;

interface PreparationStore {
  version: 1;
  configs: Record<string, NeuraCoEnvironmentPreparationConfig>;
  executions: NeuraCoEnvironmentPreparationExecution[];
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type CommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
  }
) => Promise<CommandResult>;

interface EnvironmentPreparationServiceOptions {
  storePath: string;
  runCommand?: CommandRunner;
}

const safeEnvironment = (): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(process.env).filter(([name, value]) => (
    typeof value === 'string' && !SENSITIVE_ENVIRONMENT_NAME.test(name)
  ))
);

const trimOutput = (value: string): string => (
  redactSecrets(value).slice(-MAX_OUTPUT_LENGTH)
);

const defaultRunCommand: CommandRunner = (
  command,
  args,
  options
) => new Promise((resolve) => {
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: createSandboxedEnvironment(options.env || process.env),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const finish = (exitCode: number, extraError = '') => {
    if (settled) return;
    settled = true;
    resolve({
      exitCode,
      stdout: trimOutput(stdout),
      stderr: trimOutput(`${stderr}${extraError}`),
      durationMs: Date.now() - startedAt
    });
  };
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${String(chunk)}`.slice(-MAX_OUTPUT_LENGTH);
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-MAX_OUTPUT_LENGTH);
  });
  child.once('error', (error) => finish(-1, `\n${error.message}`));
  child.once('close', (code) => finish(code ?? -1));
  const timer = setTimeout(() => {
    child.kill();
    finish(-1, '\nDélai maximal dépassé.');
  }, options.timeoutMs);
  timer.unref?.();
  child.once('error', () => clearTimeout(timer));
  child.once('close', () => clearTimeout(timer));
});

const defaultConfig = (projectId: string): NeuraCoEnvironmentPreparationConfig => ({
  projectId,
  script: '',
  enabled: false,
  runOnWorktree: true,
  runOnTransfer: true,
  timeoutSeconds: 300,
  updatedAt: new Date().toISOString()
});

const safeName = (value: string | undefined, label: string): string => {
  if (!value || !SAFE_REMOTE_NAME.test(value)) {
    throw new Error(`${label} est manquant ou invalide.`);
  }
  return value;
};

const safeRemotePath = (value: string | undefined): string => {
  if (!value || value.length > 1000 || UNSAFE_REMOTE_PATH.test(value)) {
    throw new Error('Chemin du projet distant manquant ou invalide.');
  }
  return value;
};

const shellQuote = (value: string): string => (
  `'${value.replace(/'/g, `'\\''`)}'`
);

export const inspectPreparationScript = (
  scriptInput: string
): { script: string; blockedReasons: string[]; warnings: string[] } => {
  const script = String(scriptInput || '').replace(/\r\n/g, '\n').trim();
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  if (!script) blockedReasons.push('Le script est vide.');
  if (script.length > MAX_SCRIPT_LENGTH) {
    blockedReasons.push(`Le script dépasse ${MAX_SCRIPT_LENGTH} caractères.`);
  }
  if (script.includes('\0')) blockedReasons.push('Le script contient un caractère interdit.');

  const blockedPatterns: Array<[RegExp, string]> = [
    [
      /(?:^|[\s"'\\/])\.env(?:\.|[\s"'\\/]|$)/i,
      'La lecture ou la copie de fichiers .env est interdite.'
    ],
    [
      /\b(?:credentials?|secrets?)\.(?:json|ya?ml|txt)|\.(?:pem|p12|pfx|key)\b/i,
      'Les fichiers de secrets, certificats et clés privées sont interdits.'
    ],
    [
      /\b(?:printenv|set\s*>\s*|get-childitem\s+env:|dir\s+env:)\b/i,
      'L’énumération des variables d’environnement est interdite.'
    ],
    [
      /(?:\$\{?|\$env:|%)(?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|DATABASE_URL|MONGO_URL))/i,
      'Le script tente de lire une variable sensible.'
    ],
    [
      /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)/i,
      'Les commandes Git destructrices sont interdites.'
    ],
    [
      /\b(?:rm\s+-[a-z]*rf\s+(?:\/|~)|remove-item\b[^\n]*-(?:recurse|force)[^\n]*(?:\\|\/)|format(?:-volume)?|diskpart|shutdown|restart-computer)\b/i,
      'Une commande destructive pour le système a été détectée.'
    ],
    [
      /\b(?:curl|wget|invoke-webrequest)\b[^\n|;]*(?:\||;)\s*(?:sh|bash|zsh|powershell|pwsh|invoke-expression)\b/i,
      'L’exécution directe d’un script téléchargé est interdite.'
    ],
    [
      /\bdocker\s+system\s+prune\b/i,
      'La suppression globale des ressources Docker est interdite.'
    ]
  ];
  for (const [pattern, message] of blockedPatterns) {
    if (pattern.test(script) && !blockedReasons.includes(message)) {
      blockedReasons.push(message);
    }
  }
  if (
    /\b(?:npm|pnpm|yarn|pip|poetry|composer|bundle|cargo|go)\s+(?:i|install|add|sync|download)\b/i
      .test(script)
  ) {
    warnings.push('Le script peut télécharger ou mettre à jour des dépendances.');
  }
  if (/\b(?:migrate|migration|alembic|prisma\s+db|sequelize\s+db)\b/i.test(script)) {
    warnings.push('Le script contient une opération de préparation de base de données.');
  }
  return { script, blockedReasons, warnings };
};

export class EnvironmentPreparationService {
  private readonly runCommand: CommandRunner;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: EnvironmentPreparationServiceOptions) {
    this.runCommand = options.runCommand || defaultRunCommand;
  }

  private async readStore(): Promise<PreparationStore> {
    try {
      const parsed = JSON.parse(await readFile(this.options.storePath, 'utf8')) as
        Partial<PreparationStore>;
      return {
        version: 1,
        configs: parsed.configs && typeof parsed.configs === 'object'
          ? parsed.configs
          : {},
        executions: Array.isArray(parsed.executions)
          ? parsed.executions.slice(-MAX_EXECUTIONS)
          : []
      };
    } catch {
      return { version: 1, configs: {}, executions: [] };
    }
  }

  private async writeStore(store: PreparationStore): Promise<void> {
    const pending = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(this.options.storePath), { recursive: true });
      const temporary = `${this.options.storePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(store, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });
      try {
        await rename(temporary, this.options.storePath);
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes((error as NodeJS.ErrnoException).code || '')) {
          throw error;
        }
        await rm(this.options.storePath, { force: true });
        await rename(temporary, this.options.storePath);
      }
    });
    this.writeQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async get(projectId: string): Promise<NeuraCoEnvironmentPreparationConfig> {
    const store = await this.readStore();
    return store.configs[projectId] || defaultConfig(projectId);
  }

  async update(
    projectId: string,
    update: NeuraCoEnvironmentPreparationUpdate
  ): Promise<NeuraCoEnvironmentPreparationConfig> {
    const inspected = inspectPreparationScript(update.script);
    if (inspected.blockedReasons.length > 0 && update.enabled) {
      throw new Error(inspected.blockedReasons.join(' '));
    }
    const current = await this.get(projectId);
    const scriptChanged = inspected.script !== current.script;
    const next: NeuraCoEnvironmentPreparationConfig = {
      ...current,
      projectId,
      script: inspected.script,
      enabled: Boolean(update.enabled && inspected.script),
      runOnWorktree: Boolean(update.runOnWorktree),
      runOnTransfer: Boolean(update.runOnTransfer),
      timeoutSeconds: Math.max(30, Math.min(600, Math.round(update.timeoutSeconds || 300))),
      firstRunAt: scriptChanged ? undefined : current.firstRunAt,
      lastRunAt: scriptChanged ? undefined : current.lastRunAt,
      lastStatus: scriptChanged ? undefined : current.lastStatus,
      updatedAt: new Date().toISOString()
    };
    const store = await this.readStore();
    store.configs[projectId] = next;
    await this.writeStore(store);
    return next;
  }

  async listExecutions(
    projectId: string,
    limit = 30
  ): Promise<NeuraCoEnvironmentPreparationExecution[]> {
    const store = await this.readStore();
    return store.executions
      .filter((execution) => execution.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(100, limit)));
  }

  private async targetAvailable(
    target: NeuraCoEnvironmentTarget
  ): Promise<{ available: boolean; shell: string; reason?: string }> {
    if (target.kind === 'cloud') {
      return {
        available: false,
        shell: 'Cloud NeuraCo',
        reason: 'Le Cloud NeuraCo ne fournit pas de shell arbitraire sécurisé.'
      };
    }
    if (target.kind === 'local' || target.kind === 'worktree') {
      const targetPath = target.kind === 'worktree'
        ? target.worktreePath
        : target.projectPath;
      if (!targetPath) return { available: false, shell: '', reason: 'Chemin cible absent.' };
      try {
        if (!(await stat(targetPath)).isDirectory()) throw new Error('not-directory');
      } catch {
        return {
          available: false,
          shell: '',
          reason: 'Le dossier cible est introuvable.'
        };
      }
      return {
        available: true,
        shell: process.platform === 'win32' ? 'Windows PowerShell' : '/bin/sh'
      };
    }
    const projectPath = safeRemotePath(target.projectPath);
    const check = `test -d ${shellQuote(projectPath)}`;
    let result: CommandResult;
    if (target.kind === 'docker') {
      const container = safeName(target.container, 'Conteneur Docker');
      result = await this.runCommand('docker', ['exec', container, 'sh', '-lc', check], {
        timeoutMs: 8_000,
        env: safeEnvironment()
      });
      return {
        available: result.exitCode === 0,
        shell: `Docker ${container}`,
        reason: result.exitCode === 0 ? undefined : trimOutput(result.stderr || result.stdout)
      };
    }
    if (target.kind === 'wsl2') {
      const distribution = safeName(target.distribution, 'Distribution WSL2');
      result = await this.runCommand(
        'wsl.exe',
        ['--distribution', distribution, '--', 'sh', '-lc', check],
        { timeoutMs: 8_000, env: safeEnvironment() }
      );
      return {
        available: result.exitCode === 0,
        shell: `WSL2 ${distribution}`,
        reason: result.exitCode === 0 ? undefined : trimOutput(result.stderr || result.stdout)
      };
    }
    const host = safeName(target.sshHost, 'Hôte SSH');
    result = await this.runCommand(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, check],
      { timeoutMs: 8_000, env: safeEnvironment() }
    );
    return {
      available: result.exitCode === 0,
      shell: `SSH ${host}`,
      reason: result.exitCode === 0 ? undefined : trimOutput(result.stderr || result.stdout)
    };
  }

  async preview(
    projectId: string,
    target: NeuraCoEnvironmentTarget
  ): Promise<NeuraCoEnvironmentPreparationPreview> {
    const config = await this.get(projectId);
    const inspected = inspectPreparationScript(config.script);
    const availability = await this.targetAvailable(target);
    const blockedReasons = [
      ...inspected.blockedReasons,
      availability.available ? undefined : availability.reason || 'Cible indisponible.'
    ].filter((reason): reason is string => Boolean(reason));
    return {
      target,
      script: inspected.script,
      shell: availability.shell,
      firstExecution: !config.firstRunAt,
      compatible: config.enabled
        && availability.available
        && blockedReasons.length === 0,
      blockedReasons,
      warnings: [
        ...inspected.warnings,
        'Les variables sensibles du processus parent sont retirées avant exécution.',
        config.firstRunAt
          ? 'Ce script a déjà été exécuté avec succès.'
          : 'Première exécution : le script doit être examiné avant autorisation.'
      ],
      checkedAt: new Date().toISOString()
    };
  }

  private commandFor(
    target: NeuraCoEnvironmentTarget,
    script: string
  ): { command: string; args: string[]; cwd?: string; shell: string } {
    if (target.kind === 'local' || target.kind === 'worktree') {
      const cwd = target.kind === 'worktree' ? target.worktreePath : target.projectPath;
      if (!cwd) throw new Error('Chemin cible absent.');
      if (process.platform === 'win32') {
        return {
          command: 'powershell.exe',
          args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
          cwd,
          shell: 'Windows PowerShell'
        };
      }
      return { command: '/bin/sh', args: ['-lc', script], cwd, shell: '/bin/sh' };
    }
    const projectPath = safeRemotePath(target.projectPath);
    const remoteScript = `cd ${shellQuote(projectPath)} && ${script}`;
    if (target.kind === 'docker') {
      const container = safeName(target.container, 'Conteneur Docker');
      return {
        command: 'docker',
        args: ['exec', container, 'sh', '-lc', remoteScript],
        shell: `Docker ${container}`
      };
    }
    if (target.kind === 'wsl2') {
      const distribution = safeName(target.distribution, 'Distribution WSL2');
      return {
        command: 'wsl.exe',
        args: ['--distribution', distribution, '--', 'sh', '-lc', remoteScript],
        shell: `WSL2 ${distribution}`
      };
    }
    if (target.kind === 'ssh') {
      const host = safeName(target.sshHost, 'Hôte SSH');
      return {
        command: 'ssh',
        args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, remoteScript],
        shell: `SSH ${host}`
      };
    }
    throw new Error('L’exécution arbitraire dans le Cloud NeuraCo est interdite.');
  }

  async run(
    projectId: string,
    target: NeuraCoEnvironmentTarget
  ): Promise<NeuraCoEnvironmentPreparationExecution> {
    const preview = await this.preview(projectId, target);
    if (!preview.compatible) {
      throw new Error(
        `Préparation bloquée : ${preview.blockedReasons.join(' ') || 'configuration inactive.'}`
      );
    }
    const config = await this.get(projectId);
    const command = this.commandFor(target, preview.script);
    const createdAt = new Date().toISOString();
    const result = await this.runCommand(command.command, command.args, {
      cwd: command.cwd,
      timeoutMs: config.timeoutSeconds * 1000,
      env: safeEnvironment()
    });
    const execution: NeuraCoEnvironmentPreparationExecution = {
      id: randomUUID(),
      projectId,
      target,
      status: result.exitCode === 0 ? 'completed' : 'failed',
      shell: command.shell,
      exitCode: result.exitCode,
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
      durationMs: result.durationMs,
      createdAt
    };
    const store = await this.readStore();
    store.executions = [...store.executions, execution].slice(-MAX_EXECUTIONS);
    const latestConfig = store.configs[projectId] || config;
    store.configs[projectId] = {
      ...latestConfig,
      firstRunAt: execution.status === 'completed'
        ? latestConfig.firstRunAt || createdAt
        : latestConfig.firstRunAt,
      lastRunAt: createdAt,
      lastStatus: execution.status,
      updatedAt: new Date().toISOString()
    };
    await this.writeStore(store);
    return execution;
  }
}
