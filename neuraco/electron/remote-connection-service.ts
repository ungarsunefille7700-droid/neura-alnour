import { randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  NeuraCoRemoteActionRequest,
  NeuraCoRemoteActionResult,
  NeuraCoRemoteDiscovery,
  NeuraCoRemoteDockerContainer,
  NeuraCoRemoteSshHost
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type CommandRunner = (
  command: string,
  args: string[],
  timeoutMs?: number
) => Promise<CommandResult>;

const MAX_OUTPUT = 200_000;
const SAFE_TARGET = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

const clean = (value: unknown, max = MAX_OUTPUT): string => (
  redactSecrets(String(value || '')).slice(0, max)
);

const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const safePath = (value: unknown): string => {
  const text = String(value || '').trim();
  if (!text || text.length > 2_000 || text.includes('\0') || /[\r\n]/.test(text)) {
    throw new Error('Chemin distant invalide.');
  }
  return text;
};

const safeCommand = (value: unknown): string => {
  const text = String(value || '').trim();
  if (!text || text.length > 4_000 || text.includes('\0')) {
    throw new Error('Commande distante vide ou invalide.');
  }
  return text;
};

const defaultRunner: CommandRunner = (command, args, timeoutMs = 20_000) => (
  new Promise((resolve) => {
    const started = Date.now();
    execFile(command, args, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT
    }, (error, stdout, stderr) => {
      const withCode = error as NodeJS.ErrnoException & { code?: number | string };
      resolve({
        exitCode: error
          ? typeof withCode.code === 'number' ? withCode.code : 1
          : 0,
        stdout: clean(stdout),
        stderr: clean(stderr || (error instanceof Error ? error.message : '')),
        durationMs: Date.now() - started
      });
    });
  })
);

const parseSshConfig = (content: string): NeuraCoRemoteSshHost[] => {
  const hosts: NeuraCoRemoteSshHost[] = [];
  let current: NeuraCoRemoteSshHost | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [directive, ...parts] = line.split(/\s+/);
    const value = parts.join(' ').trim();
    if (directive.toLowerCase() === 'host') {
      const alias = value.split(/\s+/).find((item) => !/[*?!]/.test(item));
      current = alias
        ? { id: alias, alias, identityFiles: [] }
        : null;
      if (current) hosts.push(current);
      continue;
    }
    if (!current) continue;
    if (directive.toLowerCase() === 'hostname') current.hostname = value;
    if (directive.toLowerCase() === 'user') current.user = value;
    if (directive.toLowerCase() === 'port' && /^\d+$/.test(value)) {
      current.port = Number(value);
    }
    if (directive.toLowerCase() === 'identityfile') {
      current.identityFiles.push(value.replace(/^~/, os.homedir()));
    }
  }
  return hosts.slice(0, 100);
};

export class RemoteConnectionService {
  private readonly tunnels = new Map<string, {
    process: ChildProcess;
    host: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
  }>();

  constructor(private readonly runCommand: CommandRunner = defaultRunner) {}

  async discover(): Promise<NeuraCoRemoteDiscovery> {
    const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
    const [sshProbe, wsl, docker, sshConfig] = await Promise.all([
      this.runCommand('ssh', ['-V'], 5_000),
      process.platform === 'win32'
        ? this.runCommand('wsl.exe', ['--list', '--quiet'], 8_000)
        : Promise.resolve({ exitCode: 1, stdout: '', stderr: '', durationMs: 0 }),
      this.runCommand('docker', [
        'ps',
        '-a',
        '--format',
        '{{json .}}'
      ], 8_000),
      readFile(sshConfigPath, 'utf8').catch(() => '')
    ]);
    const dockerContainers = docker.exitCode === 0
      ? docker.stdout.split(/\r?\n/).flatMap((line): NeuraCoRemoteDockerContainer[] => {
          try {
            const item = JSON.parse(line) as Record<string, string>;
            return [{
              id: item.ID || item.Id || item.Names,
              name: item.Names || item.Name || item.ID,
              image: item.Image || '',
              state: item.State || '',
              status: item.Status || ''
            }];
          } catch {
            return [];
          }
        })
      : [];
    return {
      checkedAt: new Date().toISOString(),
      sshAvailable: sshProbe.exitCode === 0,
      sshHosts: parseSshConfig(sshConfig),
      wslAvailable: wsl.exitCode === 0,
      wslDistributions: wsl.stdout
        .replace(/\0/g, '')
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 50),
      dockerAvailable: docker.exitCode === 0,
      dockerContainers,
      activeTunnels: [...this.tunnels.entries()].map(([id, tunnel]) => ({
        id,
        host: tunnel.host,
        localPort: tunnel.localPort,
        remoteHost: tunnel.remoteHost,
        remotePort: tunnel.remotePort
      }))
    };
  }

  private sshArgs(request: NeuraCoRemoteActionRequest): string[] {
    if (!SAFE_TARGET.test(request.target)) throw new Error('Hôte SSH invalide.');
    const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
    if (request.identityFile) {
      args.push('-i', path.resolve(request.identityFile));
    }
    args.push(request.target);
    return args;
  }

  private targetCommand(
    request: NeuraCoRemoteActionRequest,
    command: string
  ): { executable: string; args: string[] } {
    if (request.kind === 'ssh') {
      return { executable: 'ssh', args: [...this.sshArgs(request), command] };
    }
    if (request.kind === 'wsl2') {
      if (!SAFE_NAME.test(request.target)) throw new Error('Distribution WSL2 invalide.');
      return {
        executable: 'wsl.exe',
        args: ['--distribution', request.target, '--', 'sh', '-lc', command]
      };
    }
    if (!SAFE_NAME.test(request.target)) throw new Error('Conteneur Docker invalide.');
    return {
      executable: 'docker',
      args: ['exec', request.target, 'sh', '-lc', command]
    };
  }

  async run(request: NeuraCoRemoteActionRequest): Promise<NeuraCoRemoteActionResult> {
    const started = Date.now();
    if (request.action === 'tunnel') return this.startTunnel(request);
    let executable = '';
    let args: string[] = [];
    if (request.kind === 'docker' && ['logs', 'inspect', 'start', 'stop'].includes(request.action)) {
      if (!SAFE_NAME.test(request.target)) throw new Error('Conteneur Docker invalide.');
      executable = 'docker';
      args = request.action === 'logs'
        ? ['logs', '--tail', '300', request.target]
        : [request.action, request.target];
    } else if (request.kind === 'docker' && request.action === 'rebuild') {
      const projectPath = safePath(request.path);
      executable = 'docker';
      args = ['compose', '--project-directory', projectPath, 'up', '-d', '--build'];
    } else {
      let command = 'printf NEURACO_CONNECTED';
      if (request.action === 'list_files') {
        const targetPath = safePath(request.path || '.');
        command = `find ${quote(targetPath)} -maxdepth 2 -mindepth 1 -printf '%y\\t%p\\n' | head -200`;
      } else if (request.action === 'read_file') {
        command = `sed -n '1,400p' ${quote(safePath(request.path))}`;
      } else if (request.action === 'run_command') {
        command = safeCommand(request.command);
      }
      ({ executable, args } = this.targetCommand(request, command));
    }
    const result = await this.runCommand(executable, args, 120_000);
    return {
      action: request.action,
      target: request.target,
      ok: result.exitCode === 0,
      ...result,
      durationMs: Date.now() - started
    };
  }

  private async startTunnel(
    request: NeuraCoRemoteActionRequest
  ): Promise<NeuraCoRemoteActionResult> {
    if (request.kind !== 'ssh') throw new Error('Un tunnel nécessite une cible SSH.');
    const localPort = Number(request.localPort);
    const remotePort = Number(request.remotePort);
    const remoteHost = String(request.remoteHost || '127.0.0.1').trim();
    if (
      !Number.isInteger(localPort) || localPort < 1 || localPort > 65535
      || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535
      || !/^[A-Za-z0-9.-]+$/.test(remoteHost)
    ) {
      throw new Error('Configuration du tunnel SSH invalide.');
    }
    const id = randomUUID();
    const child = spawn('ssh', [
      ...this.sshArgs(request).slice(0, -1),
      '-N',
      '-L',
      `${localPort}:${remoteHost}:${remotePort}`,
      request.target
    ], {
      windowsHide: true,
      stdio: 'ignore'
    });
    this.tunnels.set(id, {
      process: child,
      host: request.target,
      localPort,
      remoteHost,
      remotePort
    });
    child.once('exit', () => this.tunnels.delete(id));
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (child.exitCode !== null) {
      this.tunnels.delete(id);
      throw new Error('Le tunnel SSH n’a pas pu démarrer.');
    }
    return {
      action: 'tunnel',
      target: request.target,
      ok: true,
      exitCode: null,
      stdout: `Tunnel local 127.0.0.1:${localPort} vers ${remoteHost}:${remotePort}`,
      stderr: '',
      durationMs: 350,
      connectionId: id
    };
  }

  disconnect(connectionId: string): boolean {
    const tunnel = this.tunnels.get(connectionId);
    if (!tunnel) return false;
    tunnel.process.kill();
    this.tunnels.delete(connectionId);
    return true;
  }

  disconnectAll(): void {
    for (const id of [...this.tunnels.keys()]) this.disconnect(id);
  }
}

export { parseSshConfig };
