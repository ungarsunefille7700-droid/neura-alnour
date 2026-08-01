import { randomUUID } from 'node:crypto';
import {
  closeSync,
  openSync
} from 'node:fs';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpus } from 'node:os';
import path from 'node:path';
import type {
  NeuraCoBackgroundProcess,
  NeuraCoBackgroundProcessAction,
  NeuraCoBackgroundProcessEvent,
  NeuraCoBackgroundProcessLog,
  NeuraCoBackgroundProcessRequest,
  NeuraCoProject
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';
import { validateTerminalCommand } from './terminal-service';
import { createSandboxedEnvironment } from './sandbox-environment';

const MAX_PROCESSES = 200;
const MAX_LOG_BYTES = 512 * 1024;
const LAST_OUTPUT_BYTES = 4 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{8,160}$/;
const ACTIVE_STATES = new Set(['starting', 'running', 'detached', 'stopping']);

interface StoredProcess extends NeuraCoBackgroundProcess {
  logPath: string;
  cpuTotalSeconds?: number;
  cpuSampledAt?: number;
}

interface ProcessStore {
  version: 1;
  processes: StoredProcess[];
}

interface BackgroundProcessServiceOptions {
  storePath: string;
  logsDirectory: string;
  onEvent?: (event: NeuraCoBackgroundProcessEvent) => void;
}

const cleanText = (value: unknown, max: number): string => (
  String(value || '').trim().slice(0, max)
);

const processExists = (pid?: number): boolean => {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const waitForProcessExit = async (
  pid: number,
  timeoutMs = 5000
): Promise<boolean> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processExists(pid);
};

const writeAtomically = async (target: string, store: ProcessStore): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  try {
    await rename(temporary, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EEXIST', 'EPERM'].includes(code || '')) throw error;
    await rm(target, { force: true });
    await rename(temporary, target);
  }
};

const readLogTail = async (
  logPath: string,
  maxBytes: number
): Promise<{ content: string; truncated: boolean }> => {
  try {
    const info = await stat(logPath);
    const length = Math.min(info.size, maxBytes);
    const offset = Math.max(0, info.size - length);
    const handle = await open(logPath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      return {
        content: buffer.toString('utf8').replace(/\0/g, ''),
        truncated: offset > 0
      };
    } finally {
      await handle.close();
    }
  } catch {
    return { content: '', truncated: false };
  }
};

const runCapture = (
  executable: string,
  args: string[],
  timeoutMs = 1800
): Promise<string> => new Promise((resolve) => {
  let output = '';
  const child = spawn(executable, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  child.stdout?.on('data', (chunk) => {
    output += String(chunk).slice(0, 16_000);
  });
  const finish = () => {
    clearTimeout(timer);
    resolve(output.trim());
  };
  child.once('error', finish);
  child.once('exit', finish);
});

const resourceUsage = async (
  pid?: number
): Promise<{
  cpuMetric: number;
  memoryBytes: number;
  cumulativeCpu: boolean;
}> => {
  if (!processExists(pid)) {
    return { cpuMetric: 0, memoryBytes: 0, cumulativeCpu: false };
  }
  try {
    if (process.platform === 'win32') {
      const output = await runCapture('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p=Get-Process -Id ${pid} -ErrorAction Stop; `
          + '[pscustomobject]@{cpu=[math]::Round($p.CPU,2);memory=$p.WorkingSet64}'
          + '|ConvertTo-Json -Compress'
      ]);
      const parsed = JSON.parse(output) as { cpu?: number; memory?: number };
      return {
        cpuMetric: Math.max(0, Number(parsed.cpu || 0)),
        memoryBytes: Math.max(0, Number(parsed.memory || 0)),
        cumulativeCpu: true
      };
    }
    const output = await runCapture('ps', [
      '-p',
      String(pid),
      '-o',
      '%cpu=,rss='
    ]);
    const [cpu, rss] = output.trim().split(/\s+/).map(Number);
    return {
      cpuMetric: Math.max(0, Number.isFinite(cpu) ? cpu : 0),
      memoryBytes: Math.max(0, Number.isFinite(rss) ? rss * 1024 : 0),
      cumulativeCpu: false
    };
  } catch {
    return { cpuMetric: 0, memoryBytes: 0, cumulativeCpu: false };
  }
};

const terminateTree = async (pid: number, force: boolean): Promise<boolean> => {
  if (!processExists(pid)) return true;
  if (process.platform === 'win32') {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runCapture('taskkill', [
        '/PID',
        String(pid),
        '/T',
        ...(force || attempt > 0 ? ['/F'] : [])
      ], 5000);
      if (await waitForProcessExit(pid, 5000)) return true;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process exited between the final checks.
    }
    return waitForProcessExit(pid, 3000);
  }
  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    try {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // The process already exited.
    }
  }
  return waitForProcessExit(pid);
};

const publicProcess = (record: StoredProcess): NeuraCoBackgroundProcess => {
  const {
    logPath: _logPath,
    cpuTotalSeconds: _cpuTotalSeconds,
    cpuSampledAt: _cpuSampledAt,
    ...result
  } = record;
  return result;
};

export class BackgroundProcessService {
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly children = new Map<string, ChildProcess>();
  private readonly keepAliveProcesses = new Set<string>();

  constructor(private readonly options: BackgroundProcessServiceOptions) {}

  activeCount(): number {
    return this.children.size;
  }

  private emit(type: NeuraCoBackgroundProcessEvent['type'], record: StoredProcess): void {
    this.options.onEvent?.({ type, process: publicProcess(record) });
  }

  private async readStore(): Promise<ProcessStore> {
    try {
      const raw = await readFile(this.options.storePath, 'utf8');
      if (raw.length > 2 * 1024 * 1024) throw new Error('Process store too large');
      const parsed = JSON.parse(raw) as Partial<ProcessStore>;
      return {
        version: 1,
        processes: Array.isArray(parsed.processes)
          ? parsed.processes
              .filter((item) => item && SAFE_ID.test(String(item.id)))
              .slice(-MAX_PROCESSES)
              .map((item) => ({
                ...item,
                logPath: path.join(
                  this.options.logsDirectory,
                  `${String(item.id)}.log`
                )
              })) as StoredProcess[]
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('NeuraCo background process store could not be read', error);
      }
      return { version: 1, processes: [] };
    }
  }

  private async mutate<T>(
    operation: (store: ProcessStore) => T | Promise<T>
  ): Promise<T> {
    const pending = this.writeQueue.catch(() => undefined).then(async () => {
      const store = await this.readStore();
      const result = await operation(store);
      store.processes = store.processes.slice(-MAX_PROCESSES);
      await writeAtomically(this.options.storePath, store);
      return result;
    });
    this.writeQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private update(
    processId: string,
    updater: (record: StoredProcess) => void
  ): Promise<StoredProcess> {
    if (!SAFE_ID.test(processId)) {
      return Promise.reject(new Error('Identifiant de processus invalide.'));
    }
    return this.mutate((store) => {
      const record = store.processes.find((item) => item.id === processId);
      if (!record) throw new Error('Processus introuvable.');
      updater(record);
      record.updatedAt = new Date().toISOString();
      record.durationMs = Math.max(0, Date.now() - Date.parse(record.startedAt));
      return record;
    });
  }

  private watchChild(record: StoredProcess, child: ChildProcess): void {
    this.children.set(record.id, child);
    child.once('exit', (exitCode) => {
      this.children.delete(record.id);
      this.keepAliveProcesses.delete(record.id);
      void this.update(record.id, (current) => {
        const intentionallyStopped = current.state === 'stopping';
        current.state = intentionallyStopped
          ? 'stopped'
          : exitCode === 0
            ? 'exited'
            : 'failed';
        current.exitCode = exitCode;
        current.cpuPercent = 0;
        current.memoryBytes = 0;
      }).then((updated) => this.emit('exited', updated)).catch(() => undefined);
    });
    child.once('error', (error) => {
      void appendFile(
        record.logPath,
        `\n[NeuraCo] Erreur de processus : ${redactSecrets(error.message)}\n`,
        'utf8'
      ).catch(() => undefined);
    });
  }

  private async launch(
    record: StoredProcess,
    executionCommand = record.command
  ): Promise<StoredProcess> {
    await mkdir(this.options.logsDirectory, { recursive: true });
    await appendFile(
      record.logPath,
      `\n[NeuraCo] Démarrage ${new Date().toISOString()}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    const outputFd = openSync(record.logPath, 'a', 0o600);
    const shell = process.platform === 'win32'
      ? {
          executable: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
          args: ['/d', '/s', '/c', executionCommand]
        }
      : {
          executable: '/bin/sh',
          args: ['-lc', executionCommand]
        };
    let child: ChildProcess;
    try {
      child = spawn(shell.executable, shell.args, {
        cwd: record.workingDirectory,
        env: createSandboxedEnvironment(process.env, {
          NO_COLOR: '1',
          FORCE_COLOR: '0'
        }),
        detached: true,
        windowsHide: true,
        stdio: ['ignore', outputFd, outputFd]
      });
    } finally {
      closeSync(outputFd);
    }
    if (!child.pid) throw new Error('Le processus n’a pas pu être lancé.');
    child.unref();
    const now = new Date().toISOString();
    record.pid = child.pid;
    record.startedAt = now;
    record.updatedAt = now;
    record.durationMs = 0;
    record.cpuPercent = 0;
    record.memoryBytes = 0;
    record.exitCode = undefined;
    record.state = record.attached ? 'running' : 'detached';
    record.cpuTotalSeconds = undefined;
    record.cpuSampledAt = undefined;
    if (record.keepAlive) this.keepAliveProcesses.add(record.id);
    else this.keepAliveProcesses.delete(record.id);
    this.watchChild(record, child);
    return record;
  }

  async start(
    project: NeuraCoProject,
    request: NeuraCoBackgroundProcessRequest,
    workingDirectory: string
  ): Promise<NeuraCoBackgroundProcess> {
    const command = validateTerminalCommand(request.command);
    await mkdir(this.options.logsDirectory, { recursive: true });
    const redactedCommand = redactSecrets(command);
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: StoredProcess = {
      id,
      projectId: project.id,
      projectName: project.name,
      name: cleanText(request.name, 120) || 'Processus en arrière-plan',
      command: redactedCommand,
      agent: cleanText(request.agent, 120) || 'Utilisateur',
      workingDirectory,
      startedAt: now,
      updatedAt: now,
      durationMs: 0,
      cpuPercent: 0,
      memoryBytes: 0,
      state: 'starting',
      port: Number.isInteger(request.port) && Number(request.port) > 0
        && Number(request.port) <= 65535
        ? Number(request.port)
        : undefined,
      lastOutput: '',
      attached: request.keepAlive !== true,
      keepAlive: request.keepAlive === true,
      restartable: redactedCommand === command,
      logPath: path.join(this.options.logsDirectory, `${id}.log`)
    };
    if (!record.restartable) {
      await appendFile(
        record.logPath,
        '[NeuraCo] La commande contient une donnée masquée et ne pourra pas être redémarrée.\n',
        { encoding: 'utf8', mode: 0o600 }
      );
    }
    await this.launch(record, command);
    await this.mutate((store) => {
      store.processes.push(record);
    });
    this.emit('started', record);
    return publicProcess(record);
  }

  private async refreshRecord(record: StoredProcess): Promise<void> {
    const alive = processExists(record.pid);
    if (ACTIVE_STATES.has(record.state) && !alive) {
      record.state = record.state === 'stopping' ? 'stopped' : 'orphaned';
      record.cpuPercent = 0;
      record.memoryBytes = 0;
    } else if (alive) {
      if (record.state !== 'stopping' && !this.children.has(record.id)) {
        record.state = record.attached ? 'running' : 'detached';
      }
      if (record.state === 'stopping') {
        record.cpuPercent = 0;
        record.memoryBytes = 0;
      } else {
        const usage = await resourceUsage(record.pid);
        const sampledAt = Date.now();
        if (
          usage.cumulativeCpu
          && record.cpuTotalSeconds !== undefined
          && record.cpuSampledAt !== undefined
        ) {
          const elapsedSeconds = Math.max(
            0.001,
            (sampledAt - record.cpuSampledAt) / 1000
          );
          record.cpuPercent = Math.max(
            0,
            Math.min(
              100,
              ((usage.cpuMetric - record.cpuTotalSeconds) / elapsedSeconds)
                * 100
                / Math.max(1, cpus().length)
            )
          );
        } else {
          record.cpuPercent = usage.cumulativeCpu ? 0 : usage.cpuMetric;
        }
        record.cpuTotalSeconds = usage.cumulativeCpu
          ? usage.cpuMetric
          : undefined;
        record.cpuSampledAt = usage.cumulativeCpu ? sampledAt : undefined;
        record.memoryBytes = usage.memoryBytes;
      }
    }
    const tail = await readLogTail(record.logPath, LAST_OUTPUT_BYTES);
    record.lastOutput = redactSecrets(tail.content).slice(-LAST_OUTPUT_BYTES);
    record.durationMs = Math.max(0, Date.now() - Date.parse(record.startedAt));
    record.updatedAt = new Date().toISOString();
  }

  async list(projectId: string): Promise<NeuraCoBackgroundProcess[]> {
    return this.mutate(async (store) => {
      const matches = store.processes.filter((item) => item.projectId === projectId);
      await Promise.all(matches.map((record) => this.refreshRecord(record)));
      return matches
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map(publicProcess);
    });
  }

  async recoverSurvivors(): Promise<NeuraCoBackgroundProcess[]> {
    return this.mutate(async (store) => {
      const survivors: StoredProcess[] = [];
      for (const record of store.processes) {
        if (processExists(record.pid) && ACTIVE_STATES.has(record.state)) {
          record.attached = false;
          record.state = 'detached';
          await this.refreshRecord(record);
          survivors.push(record);
          this.emit('recovered', record);
        } else if (ACTIVE_STATES.has(record.state)) {
          record.state = 'orphaned';
          record.cpuPercent = 0;
          record.memoryBytes = 0;
        }
      }
      return survivors.map(publicProcess);
    });
  }

  async log(processId: string): Promise<NeuraCoBackgroundProcessLog> {
    const store = await this.readStore();
    const record = store.processes.find((item) => item.id === processId);
    if (!record) throw new Error('Processus introuvable.');
    const result = await readLogTail(record.logPath, MAX_LOG_BYTES);
    return {
      processId,
      content: redactSecrets(result.content),
      truncated: result.truncated,
      updatedAt: new Date().toISOString()
    };
  }

  async control(
    processId: string,
    action: NeuraCoBackgroundProcessAction
  ): Promise<NeuraCoBackgroundProcess> {
    if (!['attach', 'detach', 'keep', 'stop', 'force_stop', 'restart'].includes(action)) {
      throw new Error('Action de processus invalide.');
    }
    const store = await this.readStore();
    const current = store.processes.find((item) => item.id === processId);
    if (!current) throw new Error('Processus introuvable.');

    if (action === 'attach' || action === 'detach' || action === 'keep') {
      const updated = await this.update(processId, (record) => {
        record.attached = action === 'attach';
        if (action === 'keep') {
          record.keepAlive = true;
          this.keepAliveProcesses.add(record.id);
        }
        if (processExists(record.pid)) {
          record.state = record.attached ? 'running' : 'detached';
        }
      });
      this.emit('updated', updated);
      return publicProcess(updated);
    }

    if (action === 'stop' || action === 'force_stop') {
      const trackedChild = this.children.get(processId);
      await this.update(processId, (record) => {
        record.state = 'stopping';
        this.keepAliveProcesses.delete(record.id);
      });
      const terminated = current.pid
        ? await terminateTree(current.pid, action === 'force_stop')
        : true;
      const updated = await this.update(processId, (record) => {
        const trackedChildExited = Boolean(
          trackedChild
          && (
            trackedChild.exitCode !== null
            || trackedChild.signalCode !== null
            || !this.children.has(processId)
          )
        );
        record.state = terminated || trackedChildExited
          ? 'stopped'
          : action === 'force_stop'
            ? 'orphaned'
            : 'stopping';
        record.exitCode = record.state === 'stopped' ? 0 : record.exitCode;
        record.cpuPercent = 0;
        record.memoryBytes = 0;
      });
      this.emit('updated', updated);
      return publicProcess(updated);
    }

    if (!current.restartable) {
      throw new Error('Ce processus contient une commande masquée et ne peut pas être redémarré.');
    }
    if (current.pid && processExists(current.pid)) {
      const terminated = await terminateTree(current.pid, true);
      if (!terminated) {
        throw new Error(
          'Le processus précédent résiste à l’arrêt forcé. '
          + 'Le redémarrage est bloqué pour éviter deux processus concurrents.'
        );
      }
    }
    const relaunched = await this.launch(current);
    const updated = await this.update(processId, (record) => {
      Object.assign(record, relaunched);
    });
    this.emit('started', updated);
    return publicProcess(updated);
  }

  async stopAll(force = true): Promise<number> {
    const store = await this.readStore();
    const active = store.processes.filter(
      (record) => ACTIVE_STATES.has(record.state) && processExists(record.pid)
    );
    const terminatedIds = new Set<string>();
    await Promise.all(active.map(async (record) => {
      const terminated = record.pid
        ? await terminateTree(record.pid, force)
        : true;
      if (terminated) terminatedIds.add(record.id);
    }));
    await this.mutate((next) => {
      for (const record of next.processes) {
        if (active.some((item) => item.id === record.id)) {
          record.state = terminatedIds.has(record.id) ? 'stopped' : 'orphaned';
          record.cpuPercent = 0;
          record.memoryBytes = 0;
          record.updatedAt = new Date().toISOString();
        }
      }
    });
    return active.length;
  }

  stopNonPersistentSync(): void {
    for (const [id, child] of this.children) {
      if (this.keepAliveProcesses.has(id)) continue;
      if (!child.pid) continue;
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        });
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // The process already exited.
        }
      }
    }
  }
}
