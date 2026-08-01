import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoTerminalEvent,
  NeuraCoTerminalProfile,
  NeuraCoTerminalProfileId
} from './ipc-contract';
import { createSandboxedEnvironment } from './sandbox-environment';
import { wrapWithWindowsJobObject } from './windows-job-object';

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface TerminalTask {
  id: string;
  completion: Promise<NeuraCoTerminalEvent>;
  cancel: () => void;
}

interface TerminalTaskOptions {
  terminalId?: string;
  profileId?: NeuraCoTerminalProfileId;
  target?: string;
}

interface ExecutableProbe {
  available: boolean;
  executable?: string;
  detail: string;
}

const runProbe = (
  executable: string,
  args: string[],
  timeoutMs = 2500
): Promise<{ code: number | null; output: string }> => new Promise((resolve) => {
  let output = '';
  let settled = false;
  const child = spawn(executable, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const finish = (code: number | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve({ code, output: output.trim() });
  };
  child.stdout.on('data', (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(0, 16_000);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(0, 16_000);
  });
  child.once('error', () => finish(null));
  child.once('close', (code) => finish(code));
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    finish(null);
  }, timeoutMs);
});

const firstExisting = async (candidates: string[]): Promise<string | undefined> => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue probing known executable locations.
    }
  }
  return undefined;
};

const locateCommand = async (name: string): Promise<string | undefined> => {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await runProbe(locator, [name]);
  if (result.code !== 0) return undefined;
  return result.output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
};

const probeProfiles = async (): Promise<Record<NeuraCoTerminalProfileId, ExecutableProbe>> => {
  if (process.platform !== 'win32') {
    const shell = await firstExisting([process.env.SHELL || '', '/bin/bash', '/bin/sh']);
    const ssh = await locateCommand('ssh');
    const docker = await locateCommand('docker');
    return {
      powershell: {
        available: Boolean(shell),
        executable: shell,
        detail: shell || 'Shell système indisponible'
      },
      cmd: { available: false, detail: 'Disponible uniquement sous Windows' },
      'git-bash': {
        available: Boolean(shell?.endsWith('bash')),
        executable: shell?.endsWith('bash') ? shell : undefined,
        detail: shell?.endsWith('bash') ? shell : 'Bash indisponible'
      },
      wsl: { available: false, detail: 'Disponible uniquement sous Windows' },
      ssh: {
        available: Boolean(ssh),
        executable: ssh,
        detail: ssh || 'Client SSH introuvable'
      },
      docker: {
        available: Boolean(docker),
        executable: docker,
        detail: docker || 'Client Docker introuvable'
      }
    };
  }

  const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
  const cmd = await firstExisting([
    process.env.ComSpec || '',
    path.join(windowsRoot, 'System32', 'cmd.exe')
  ]);
  const pwsh = await locateCommand('pwsh.exe');
  const powershell = pwsh || await firstExisting([
    path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  ]);
  const gitBash = await firstExisting([
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')
  ]);
  const wsl = await firstExisting([path.join(windowsRoot, 'System32', 'wsl.exe')]);
  const wslStatus = wsl ? await runProbe(wsl, ['--list', '--quiet'], 4000) : undefined;
  const ssh = await locateCommand('ssh.exe');
  const docker = await locateCommand('docker.exe');
  return {
    powershell: {
      available: Boolean(powershell),
      executable: powershell,
      detail: powershell || 'PowerShell introuvable'
    },
    cmd: {
      available: Boolean(cmd),
      executable: cmd,
      detail: cmd || 'Invite de commandes introuvable'
    },
    'git-bash': {
      available: Boolean(gitBash),
      executable: gitBash,
      detail: gitBash || 'Git Bash introuvable'
    },
    wsl: {
      available: Boolean(wsl && wslStatus?.code === 0 && wslStatus.output),
      executable: wsl,
      detail: wsl && wslStatus?.code === 0 && wslStatus.output
        ? `Distribution(s) : ${wslStatus.output.split(/\r?\n/).join(', ')}`
        : 'Aucune distribution WSL2 disponible'
    },
    ssh: {
      available: Boolean(ssh),
      executable: ssh,
      detail: ssh || 'Client OpenSSH introuvable'
    },
    docker: {
      available: Boolean(docker),
      executable: docker,
      detail: docker || 'Client Docker introuvable'
    }
  };
};

const PROFILE_LABELS: Record<NeuraCoTerminalProfileId, string> = {
  powershell: 'PowerShell',
  cmd: 'Invite de commandes',
  'git-bash': 'Git Bash',
  wsl: 'WSL2',
  ssh: 'SSH distant',
  docker: 'Terminal Docker'
};

export const listTerminalProfiles = async (): Promise<NeuraCoTerminalProfile[]> => {
  const probes = await probeProfiles();
  return (Object.keys(PROFILE_LABELS) as NeuraCoTerminalProfileId[]).map((id) => ({
    id,
    label: PROFILE_LABELS[id],
    available: probes[id].available,
    detail: `${
      process.platform === 'win32' && ['powershell', 'cmd', 'git-bash'].includes(id)
        ? 'Job Object Windows · environnement sans secrets'
        : id === 'docker'
          ? 'Conteneur Docker'
          : id === 'wsl'
            ? 'Sous-système WSL2'
            : id === 'ssh'
              ? 'Hôte distant'
              : 'Processus contrôlé'
    } · ${probes[id].detail}`,
    requiresTarget: id === 'ssh' || id === 'docker',
    targetPlaceholder: id === 'ssh'
      ? 'utilisateur@serveur'
      : id === 'docker'
        ? 'nom-du-conteneur'
        : undefined
  }));
};

const validateTarget = (
  profileId: NeuraCoTerminalProfileId,
  rawTarget: string | undefined
): string | undefined => {
  if (profileId !== 'ssh' && profileId !== 'docker') return undefined;
  const target = String(rawTarget || '').trim();
  const valid = profileId === 'ssh'
    ? /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$/.test(target)
    : /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(target);
  if (!valid) {
    throw new Error(
      profileId === 'ssh'
        ? 'La cible SSH doit utiliser le format utilisateur@serveur.'
        : 'Le nom du conteneur Docker est invalide.'
    );
  }
  return target;
};

const shellCommand = async (
  command: string,
  options: TerminalTaskOptions
): Promise<{
  executable: string;
  args: string[];
  profileId: NeuraCoTerminalProfileId;
}> => {
  const profileId = options.profileId || (process.platform === 'win32' ? 'cmd' : 'git-bash');
  const target = validateTarget(profileId, options.target);
  const probes = await probeProfiles();
  const probe = probes[profileId];
  if (!probe.available || !probe.executable) {
    throw new Error(`${PROFILE_LABELS[profileId]} n’est pas disponible sur cet ordinateur.`);
  }
  if (profileId === 'powershell') {
    return {
      executable: probe.executable,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      profileId
    };
  }
  if (profileId === 'cmd') {
    return { executable: probe.executable, args: ['/d', '/s', '/c', command], profileId };
  }
  if (profileId === 'git-bash') {
    return {
      executable: probe.executable,
      args: ['--noprofile', '--norc', '-lc', command],
      profileId
    };
  }
  if (profileId === 'wsl') {
    return { executable: probe.executable, args: ['--exec', 'bash', '-lc', command], profileId };
  }
  if (profileId === 'ssh') {
    return {
      executable: probe.executable,
      args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', target!, command],
      profileId
    };
  }
  return {
    executable: probe.executable,
    args: ['exec', target!, 'sh', '-lc', command],
    profileId
  };
};

const stopProcessTree = (child: ChildProcessWithoutNullStreams): void => {
  if (!child.pid || child.killed) return;
  if (process.platform === 'win32') {
    const killer = spawn(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/pid', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' }
    );
    killer.unref();
    return;
  }
  child.kill('SIGTERM');
};

export const validateTerminalCommand = (command: string): string => {
  if (typeof command !== 'string') throw new Error('Commande invalide.');
  const normalized = command.trim();
  if (normalized.length === 0 || normalized.length > 4_000 || normalized.includes('\0')) {
    throw new Error('Commande vide ou trop longue.');
  }
  return normalized;
};

export const startTerminalTask = async (
  cwd: string,
  rawCommand: string,
  onEvent: (event: NeuraCoTerminalEvent) => void,
  requestedTimeoutMs = DEFAULT_TIMEOUT_MS,
  options: TerminalTaskOptions = {}
): Promise<TerminalTask> => {
  const command = validateTerminalCommand(rawCommand);
  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(1_000, Number.isFinite(requestedTimeoutMs) ? requestedTimeoutMs : DEFAULT_TIMEOUT_MS)
  );
  const id = randomUUID();
  const startedAt = Date.now();
  const shell = await shellCommand(command, options);
  let terminalEnvironment = createSandboxedEnvironment(process.env, {
    FORCE_COLOR: '1',
    TERM: process.env.TERM || 'xterm-256color'
  });
  delete terminalEnvironment.NO_COLOR;
  const guarded = (
    process.platform === 'win32'
    && ['powershell', 'cmd', 'git-bash'].includes(shell.profileId)
  )
    ? wrapWithWindowsJobObject(shell.executable, shell.args, terminalEnvironment)
    : {
        executable: shell.executable,
        args: shell.args,
        environment: terminalEnvironment
      };
  terminalEnvironment = guarded.environment;
  const child = spawn(guarded.executable, guarded.args, {
    cwd,
    windowsHide: true,
    env: terminalEnvironment
  });
  let finished = false;
  let cancelled = false;
  let cancellationMessage = 'Commande arrêtée.';
  let outputBytes = 0;
  let resolveCompletion: (event: NeuraCoTerminalEvent) => void;

  const completion = new Promise<NeuraCoTerminalEvent>((resolve) => {
    resolveCompletion = resolve;
  });

  const finish = (event: NeuraCoTerminalEvent): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    onEvent(event);
    resolveCompletion(event);
  };

  const emitChunk = (type: 'stdout' | 'stderr', chunk: Buffer): void => {
    if (finished) return;
    outputBytes += chunk.byteLength;
    if (outputBytes > MAX_OUTPUT_BYTES) {
      stopProcessTree(child);
      finish({
        commandId: id,
        type: 'error',
        message: 'La sortie a dépassé la limite de sécurité de 2 Mo.',
        durationMs: Date.now() - startedAt
      });
      return;
    }
    onEvent({
      commandId: id,
      terminalId: options.terminalId,
      profileId: shell.profileId,
      type,
      chunk: chunk.toString('utf8')
    });
  };

  child.stdout.on('data', (chunk: Buffer) => emitChunk('stdout', chunk));
  child.stderr.on('data', (chunk: Buffer) => emitChunk('stderr', chunk));
  child.once('error', (error) => {
    finish({
      commandId: id,
      terminalId: options.terminalId,
      profileId: shell.profileId,
      type: 'error',
      message: error.message,
      durationMs: Date.now() - startedAt
    });
  });
  child.once('close', (exitCode) => {
    finish({
      commandId: id,
      terminalId: options.terminalId,
      profileId: shell.profileId,
      type: cancelled ? 'cancelled' : 'completed',
      exitCode,
      message: cancelled ? cancellationMessage : undefined,
      durationMs: Date.now() - startedAt
    });
  });

  const timeout = setTimeout(() => {
    cancelled = true;
    cancellationMessage = 'Commande arrêtée après expiration du délai.';
    stopProcessTree(child);
  }, timeoutMs);

  onEvent({
    commandId: id,
    terminalId: options.terminalId,
    profileId: shell.profileId,
    type: 'started',
    command
  });

  return {
    id,
    completion,
    cancel: () => {
      if (finished) return;
      cancelled = true;
      cancellationMessage = 'Commande arrêtée par l’utilisateur.';
      stopProcessTree(child);
    }
  };
};
