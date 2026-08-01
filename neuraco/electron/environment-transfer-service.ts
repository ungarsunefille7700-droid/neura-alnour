import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoEnvironmentCapability,
  NeuraCoEnvironmentDiscovery,
  NeuraCoEnvironmentTarget,
  NeuraCoEnvironmentTransferPreview,
  NeuraCoEnvironmentTransferRecord,
  NeuraCoGitWorktree
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';
import { createSandboxedEnvironment } from './sandbox-environment';

const MAX_RECORDS = 100;
const MAX_PROBE_OUTPUT = 120_000;
const SAFE_REMOTE_NAME = /^[A-Za-z0-9_.:@/-]{1,240}$/;
const UNSAFE_REMOTE_PATH = /[\0\r\n]/;
const SECRET_FIELD =
  /^(?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization)$/i;

export interface NeuraCoEnvironmentTransferSnapshot {
  projectId: string;
  projectName: string;
  sourcePath: string;
  conversation: unknown;
  goals: unknown[];
  agents: unknown[];
  permissions: unknown;
  budget: unknown;
  tasks: unknown[];
  changes: unknown;
  results: unknown[];
  requiredTools: string[];
  relevantFiles: string[];
}

interface TransferStore {
  version: 1;
  records: NeuraCoEnvironmentTransferRecord[];
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type CommandRunner = (
  command: string,
  args: string[],
  options?: { input?: string; timeoutMs?: number }
) => Promise<CommandResult>;

interface EnvironmentTransferServiceOptions {
  storePath: string;
  manifestsDirectory: string;
  runCommand?: CommandRunner;
  uploadCloud?: (
    transferId: string,
    target: NeuraCoEnvironmentTarget,
    manifest: Record<string, unknown>
  ) => Promise<string>;
}

const safeText = (value: unknown, max: number): string => (
  redactSecrets(String(value || '')).trim().slice(0, max)
);

const safeTarget = (target: NeuraCoEnvironmentTarget): NeuraCoEnvironmentTarget => ({
  kind: target.kind,
  label: safeText(target.label, 160) || undefined,
  projectPath: safeText(target.projectPath, 1000) || undefined,
  worktreePath: safeText(target.worktreePath, 1000) || undefined,
  container: safeText(target.container, 240) || undefined,
  distribution: safeText(target.distribution, 240) || undefined,
  sshHost: safeText(target.sshHost, 240) || undefined,
  cloudWorkspaceId: safeText(target.cloudWorkspaceId, 240) || undefined
});

const safeRemoteValue = (value: string | undefined, label: string): string => {
  if (!value || !SAFE_REMOTE_NAME.test(value)) {
    throw new Error(`${label} est manquant ou invalide.`);
  }
  return value;
};

const safeRemotePath = (value: string | undefined, label: string): string => {
  if (!value || value.length > 1000 || UNSAFE_REMOTE_PATH.test(value)) {
    throw new Error(`${label} est manquant ou invalide.`);
  }
  return value;
};

const shellQuote = (value: string): string => (
  `'${value.replace(/'/g, `'\\''`)}'`
);

const defaultRunCommand: CommandRunner = (
  command,
  args,
  options = {}
) => new Promise((resolve) => {
  const child = spawn(command, args, {
    windowsHide: true,
    env: createSandboxedEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const finish = (result: CommandResult) => {
    if (settled) return;
    settled = true;
    resolve(result);
  };
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${String(chunk)}`.slice(-MAX_PROBE_OUTPUT);
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-MAX_PROBE_OUTPUT);
  });
  child.on('error', (error) => {
    finish({ exitCode: -1, stdout, stderr: error.message });
  });
  child.on('close', (code) => {
    finish({ exitCode: code ?? -1, stdout, stderr });
  });
  if (options.input !== undefined) child.stdin.end(options.input);
  else child.stdin.end();
  const timer = setTimeout(() => {
    child.kill();
    finish({ exitCode: -1, stdout, stderr: `${stderr}\nDélai dépassé.`.trim() });
  }, Math.max(500, options.timeoutMs || 8_000));
  timer.unref?.();
  child.once('close', () => clearTimeout(timer));
  child.once('error', () => clearTimeout(timer));
});

const preservedCounts = (
  snapshot: NeuraCoEnvironmentTransferSnapshot
): NeuraCoEnvironmentTransferPreview['preserved'] => ({
  conversationMessages: Array.isArray(
    (snapshot.conversation as { messages?: unknown[] } | null)?.messages
  )
    ? ((snapshot.conversation as { messages: unknown[] }).messages.length)
    : 0,
  goals: snapshot.goals.length,
  agents: snapshot.agents.length,
  permissions: snapshot.permissions ? 1 : 0,
  tasks: snapshot.tasks.length,
  changes: snapshot.changes ? 1 : 0,
  results: snapshot.results.length
});

const compatiblePermissions = (
  target: NeuraCoEnvironmentTarget,
  snapshot: NeuraCoEnvironmentTransferSnapshot
): unknown => {
  if (
    !snapshot.permissions
    || typeof snapshot.permissions !== 'object'
    || Array.isArray(snapshot.permissions)
  ) {
    return snapshot.permissions;
  }
  const permissions = snapshot.permissions as Record<string, unknown>;
  const localTargetRoot = target.kind === 'worktree'
    ? target.worktreePath
    : target.kind === 'local'
      ? target.projectPath
      : undefined;
  if (localTargetRoot) {
    const allowedFolders = Array.isArray(permissions.allowedFolders)
      ? permissions.allowedFolders.flatMap((folder) => {
        if (typeof folder !== 'string' || !folder.trim()) return [];
        if (!path.isAbsolute(folder)) return [path.resolve(localTargetRoot, folder)];
        const relative = path.relative(snapshot.sourcePath, folder);
        return relative.startsWith('..') || path.isAbsolute(relative)
          ? []
          : [path.resolve(localTargetRoot, relative)];
      })
      : [];
    return {
      ...permissions,
      projectRoot: localTargetRoot,
      allowedFolders
    };
  }
  return {
    ...permissions,
    projectRoot: target.projectPath || '',
    configured: false,
    mode: permissions.mode === 'plan' ? 'plan' : 'manual',
    allowedFolders: [],
    allowedApplications: [],
    alwaysAllowedSignatures: []
  };
};

const sanitizedManifest = (
  id: string,
  target: NeuraCoEnvironmentTarget,
  snapshot: NeuraCoEnvironmentTransferSnapshot
): Record<string, unknown> => JSON.parse(JSON.stringify({
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    target,
    source: {
      projectId: snapshot.projectId,
      projectName: snapshot.projectName,
      sourcePath: snapshot.sourcePath
    },
    state: {
      conversation: snapshot.conversation,
      goals: snapshot.goals,
      agents: snapshot.agents,
      permissions: compatiblePermissions(target, snapshot),
      budget: snapshot.budget,
      tasks: snapshot.tasks,
      changes: snapshot.changes,
      results: snapshot.results
    }
  }, (key, value) => {
    if (SECRET_FIELD.test(key)) return '[MASQUÉ]';
    return typeof value === 'string' ? redactSecrets(value) : value;
  }));

export class EnvironmentTransferService {
  private readonly runCommand: CommandRunner;
  private readonly uploadCloud?: EnvironmentTransferServiceOptions['uploadCloud'];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: EnvironmentTransferServiceOptions) {
    this.runCommand = options.runCommand || defaultRunCommand;
    this.uploadCloud = options.uploadCloud;
  }

  private async readStore(): Promise<TransferStore> {
    try {
      const parsed = JSON.parse(await readFile(this.options.storePath, 'utf8')) as
        Partial<TransferStore>;
      return {
        version: 1,
        records: Array.isArray(parsed.records)
          ? parsed.records.slice(-MAX_RECORDS)
          : []
      };
    } catch {
      return { version: 1, records: [] };
    }
  }

  private async saveRecord(record: NeuraCoEnvironmentTransferRecord): Promise<void> {
    const pending = this.writeQueue.catch(() => undefined).then(async () => {
      const store = await this.readStore();
      store.records = [...store.records, record].slice(-MAX_RECORDS);
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

  async list(projectId?: string): Promise<NeuraCoEnvironmentTransferRecord[]> {
    const store = await this.readStore();
    return store.records
      .filter((record) => !projectId || record.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async discover(
    sourcePath: string,
    worktrees: NeuraCoGitWorktree[],
    cloudAvailable: boolean
  ): Promise<NeuraCoEnvironmentDiscovery> {
    const [docker, wsl, ssh] = await Promise.all([
      this.runCommand('docker', ['ps', '--format', '{{.ID}}\t{{.Names}}']),
      this.runCommand('wsl.exe', ['--list', '--quiet']),
      this.runCommand('ssh', ['-V'])
    ]);
    const dockerTargets = docker.exitCode === 0
      ? docker.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
        const [id, name] = line.trim().split(/\t+/);
        return { id: name || id, label: name || id, detail: id };
      })
      : [];
    const wslTargets = wsl.exitCode === 0
      ? wsl.stdout.replace(/\0/g, '').split(/\r?\n/).map((line) => line.trim())
        .filter(Boolean).map((distribution) => ({
          id: distribution,
          label: distribution
        }))
      : [];
    const capabilities: NeuraCoEnvironmentCapability[] = [
      {
        kind: 'local',
        available: true,
        targets: [{ id: sourcePath, label: 'Projet local actuel', detail: sourcePath }]
      },
      {
        kind: 'worktree',
        available: worktrees.length > 0,
        reason: worktrees.length > 0 ? undefined : 'Aucun worktree Git disponible.',
        targets: worktrees.map((worktree) => ({
          id: worktree.path,
          label: worktree.branch,
          detail: worktree.path
        }))
      },
      {
        kind: 'docker',
        available: docker.exitCode === 0 && dockerTargets.length > 0,
        reason: docker.exitCode !== 0
          ? safeText(docker.stderr, 300)
          : dockerTargets.length === 0
            ? 'Aucun conteneur Docker actif.'
            : undefined,
        targets: dockerTargets
      },
      {
        kind: 'wsl2',
        available: wsl.exitCode === 0 && wslTargets.length > 0,
        reason: wsl.exitCode !== 0
          ? safeText(wsl.stderr, 300)
          : wslTargets.length === 0
            ? 'Aucune distribution WSL2 disponible.'
            : undefined,
        targets: wslTargets
      },
      {
        kind: 'ssh',
        available: ssh.exitCode === 0,
        reason: ssh.exitCode === 0 ? undefined : 'Client SSH indisponible.',
        targets: []
      },
      {
        kind: 'cloud',
        available: cloudAvailable,
        reason: cloudAvailable ? undefined : 'Session Cloud NeuraCo indisponible.',
        targets: cloudAvailable
          ? [{ id: 'default', label: 'Espace Cloud NeuraCo' }]
          : []
      }
    ];
    return { checkedAt: new Date().toISOString(), capabilities };
  }

  private async probeTarget(
    target: NeuraCoEnvironmentTarget,
    requiredTools: string[]
  ): Promise<{ available: boolean; unavailableTools: string[]; reason?: string }> {
    const tools = requiredTools
      .map((tool) => tool.replace(/[^A-Za-z0-9_.-]/g, ''))
      .filter(Boolean)
      .slice(0, 20);
    if (target.kind === 'local' || target.kind === 'worktree') {
      const targetPath = target.kind === 'worktree'
        ? target.worktreePath
        : target.projectPath;
      if (!targetPath) return { available: false, unavailableTools: [], reason: 'Chemin absent.' };
      try {
        if (!(await stat(targetPath)).isDirectory()) throw new Error('not-directory');
      } catch {
        return { available: false, unavailableTools: [], reason: 'Dossier cible introuvable.' };
      }
      const unavailableTools: string[] = [];
      for (const tool of tools) {
        const result = await this.runCommand(
          process.platform === 'win32' ? 'where.exe' : 'which',
          [tool],
          { timeoutMs: 3_000 }
        );
        if (result.exitCode !== 0) unavailableTools.push(tool);
      }
      return { available: true, unavailableTools };
    }
    if (target.kind === 'cloud') {
      return {
        available: Boolean(this.uploadCloud),
        unavailableTools: [],
        reason: this.uploadCloud ? undefined : 'Connecteur Cloud indisponible.'
      };
    }
    const projectPath = safeRemotePath(target.projectPath, 'Chemin du projet distant');
    const checks = [
      `test -d ${shellQuote(projectPath)}`,
      ...tools.map((tool) => `command -v ${shellQuote(tool)} >/dev/null`)
    ].join(' && ');
    let result: CommandResult;
    if (target.kind === 'docker') {
      const container = safeRemoteValue(target.container, 'Conteneur Docker');
      result = await this.runCommand(
        'docker',
        ['exec', container, 'sh', '-lc', checks]
      );
    } else if (target.kind === 'wsl2') {
      const distribution = safeRemoteValue(target.distribution, 'Distribution WSL2');
      result = await this.runCommand(
        'wsl.exe',
        ['--distribution', distribution, '--', 'sh', '-lc', checks]
      );
    } else if (target.kind === 'ssh') {
      const host = safeRemoteValue(target.sshHost, 'Hôte SSH');
      result = await this.runCommand(
        'ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, checks]
      );
    } else {
      return { available: false, unavailableTools: tools, reason: 'Cible inconnue.' };
    }
    return {
      available: result.exitCode === 0,
      unavailableTools: result.exitCode === 0 ? [] : tools,
      reason: result.exitCode === 0
        ? undefined
        : safeText(result.stderr || result.stdout, 500) || 'Cible inaccessible.'
    };
  }

  async preview(
    targetInput: NeuraCoEnvironmentTarget,
    snapshot: NeuraCoEnvironmentTransferSnapshot
  ): Promise<NeuraCoEnvironmentTransferPreview> {
    const target = safeTarget(targetInput);
    const probe = await this.probeTarget(target, snapshot.requiredTools);
    const unavailableFiles: string[] = [];
    const targetPath = target.kind === 'worktree'
      ? target.worktreePath
      : target.kind === 'local'
        ? target.projectPath
        : undefined;
    if (targetPath && probe.available) {
      for (const relativePath of snapshot.relevantFiles.slice(0, 80)) {
        try {
          await access(path.join(targetPath, relativePath));
        } catch {
          unavailableFiles.push(relativePath);
        }
      }
    }
    const warnings = [
      probe.reason,
      unavailableFiles.length > 0
        ? `${unavailableFiles.length} fichier(s) de contexte absent(s) dans la cible.`
        : undefined,
      probe.unavailableTools.length > 0
        ? `${probe.unavailableTools.length} outil(s) requis indisponible(s).`
        : undefined,
      target.kind !== 'local'
        ? 'Les autorisations incompatibles seront retirées dans la cible.'
        : undefined,
      'Les secrets réels ne sont jamais copiés dans le manifeste de transfert.'
    ].filter((warning): warning is string => Boolean(warning));
    return {
      target,
      compatible: probe.available
        && unavailableFiles.length === 0
        && probe.unavailableTools.length === 0,
      checkedAt: new Date().toISOString(),
      unavailableFiles,
      unavailableTools: probe.unavailableTools,
      warnings,
      preserved: preservedCounts(snapshot)
    };
  }

  async transfer(
    targetInput: NeuraCoEnvironmentTarget,
    snapshot: NeuraCoEnvironmentTransferSnapshot
  ): Promise<NeuraCoEnvironmentTransferRecord> {
    const preview = await this.preview(targetInput, snapshot);
    if (!preview.compatible) {
      throw new Error(
        `Transfert bloqué : ${preview.warnings.join(' ') || 'cible incompatible.'}`
      );
    }
    const id = randomUUID();
    const manifest = sanitizedManifest(id, preview.target, snapshot);
    await mkdir(this.options.manifestsDirectory, { recursive: true });
    const manifestLocation = path.join(this.options.manifestsDirectory, `${id}.json`);
    await writeFile(manifestLocation, JSON.stringify(manifest, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });

    let remoteLocation: string | undefined;
    const serialized = JSON.stringify(manifest);
    const remoteManifest = `/tmp/neuraco-transfers/${id}.json`;
    if (preview.target.kind === 'docker') {
      const container = safeRemoteValue(preview.target.container, 'Conteneur Docker');
      const result = await this.runCommand(
        'docker',
        [
          'exec',
          '-i',
          container,
          'sh',
          '-lc',
          `mkdir -p /tmp/neuraco-transfers && cat > ${shellQuote(remoteManifest)}`
        ],
        { input: serialized }
      );
      if (result.exitCode !== 0) throw new Error('Copie du manifeste Docker impossible.');
      remoteLocation = `${container}:${remoteManifest}`;
    } else if (preview.target.kind === 'wsl2') {
      const distribution = safeRemoteValue(
        preview.target.distribution,
        'Distribution WSL2'
      );
      const result = await this.runCommand(
        'wsl.exe',
        [
          '--distribution',
          distribution,
          '--',
          'sh',
          '-lc',
          `mkdir -p /tmp/neuraco-transfers && cat > ${shellQuote(remoteManifest)}`
        ],
        { input: serialized }
      );
      if (result.exitCode !== 0) throw new Error('Copie du manifeste WSL2 impossible.');
      remoteLocation = `${distribution}:${remoteManifest}`;
    } else if (preview.target.kind === 'ssh') {
      const host = safeRemoteValue(preview.target.sshHost, 'Hôte SSH');
      const result = await this.runCommand(
        'ssh',
        [
          '-o',
          'BatchMode=yes',
          '-o',
          'ConnectTimeout=5',
          host,
          `mkdir -p /tmp/neuraco-transfers && cat > ${shellQuote(remoteManifest)}`
        ],
        { input: serialized }
      );
      if (result.exitCode !== 0) throw new Error('Copie du manifeste SSH impossible.');
      remoteLocation = `${host}:${remoteManifest}`;
    } else if (preview.target.kind === 'cloud') {
      if (!this.uploadCloud) throw new Error('Connecteur Cloud indisponible.');
      remoteLocation = await this.uploadCloud(id, preview.target, manifest);
    } else {
      const targetRoot = preview.target.worktreePath || preview.target.projectPath;
      if (!targetRoot) throw new Error('Dossier cible indisponible.');
      const transferDirectory = path.join(targetRoot, '.neuraco', 'transfers');
      await mkdir(transferDirectory, { recursive: true });
      remoteLocation = path.join(transferDirectory, `${id}.json`);
      await writeFile(remoteLocation, JSON.stringify(manifest, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      });
    }

    const record: NeuraCoEnvironmentTransferRecord = {
      id,
      projectId: snapshot.projectId,
      sourcePath: snapshot.sourcePath,
      target: preview.target,
      status: 'completed',
      compatible: true,
      manifestLocation,
      remoteLocation,
      preserved: preview.preserved,
      warnings: preview.warnings,
      createdAt: new Date().toISOString()
    };
    await this.saveRecord(record);
    return record;
  }
}
