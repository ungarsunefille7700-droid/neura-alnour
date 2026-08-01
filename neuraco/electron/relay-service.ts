import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authenticatedApiRequest } from './auth-service';
import type {
  NeuraCoProject,
  NeuraCoRelayCommand,
  NeuraCoRelayEvent,
  NeuraCoRelayState
} from './ipc-contract';

interface RelayCommandApi {
  id: string;
  device_id: string;
  action: NeuraCoRelayCommand['action'];
  payload: { instruction?: string };
  status: NeuraCoRelayCommand['status'];
  created_at: string;
  expires_at: string;
}

interface RelayHeartbeatApi {
  commands: RelayCommandApi[];
  server_time: string;
}

export type RelayApiRequest = <T>(
  pathname: string,
  options?: RequestInit
) => Promise<T>;

interface RelayServiceOptions {
  storePath: string;
  appVersion: string;
  getProject: () => NeuraCoProject | null;
  onEvent: (event: NeuraCoRelayEvent) => void;
  heartbeatMs?: number;
  request?: RelayApiRequest;
}

const toCommand = (command: RelayCommandApi): NeuraCoRelayCommand => ({
  id: command.id,
  deviceId: command.device_id,
  action: command.action,
  payload: command.payload || {},
  status: command.status,
  createdAt: command.created_at,
  expiresAt: command.expires_at
});

export class RelayService {
  private enabled = false;
  private connected = false;
  private deviceId?: string;
  private lastHeartbeatAt?: string;
  private error?: string;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;
  private pendingCommands: NeuraCoRelayCommand[] = [];

  constructor(private readonly options: RelayServiceOptions) {}

  state(): NeuraCoRelayState {
    return {
      enabled: this.enabled,
      connected: this.connected,
      deviceId: this.deviceId,
      lastHeartbeatAt: this.lastHeartbeatAt,
      error: this.error,
      pendingCommands: [...this.pendingCommands],
      transport: 'outbound-https',
      publicPortOpen: false
    };
  }

  async enable(): Promise<NeuraCoRelayState> {
    if (this.enabled) return this.state();
    this.deviceId = await this.loadOrCreateDeviceId();
    this.enabled = true;
    await this.heartbeat();
    this.timer = setInterval(
      () => void this.heartbeat(),
      Math.max(5_000, this.options.heartbeatMs || 15_000)
    );
    return this.state();
  }

  disable(): NeuraCoRelayState {
    this.enabled = false;
    this.connected = false;
    this.error = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.emit('state');
    return this.state();
  }

  async heartbeat(): Promise<void> {
    if (!this.enabled) return;
    if (this.inFlight) return this.inFlight;
    const request = this.performHeartbeat();
    this.inFlight = request;
    try {
      await request;
    } catch (error) {
      this.connected = false;
      this.error = error instanceof Error
        ? error.message
        : 'Relais NeuraCo indisponible.';
      this.emit('state');
    } finally {
      if (this.inFlight === request) {
        this.inFlight = undefined;
      }
    }
  }

  async resolve(commandId: string, accepted: boolean): Promise<NeuraCoRelayState> {
    const command = this.pendingCommands.find((item) => item.id === commandId);
    if (!command || !this.deviceId) throw new Error('Commande distante introuvable.');
    const status = accepted ? 'completed' : 'refused';
    const request = this.options.request || authenticatedApiRequest;
    await request(
      `/neuraco/relay/commands/${encodeURIComponent(command.id)}/result`,
      {
        method: 'POST',
        body: JSON.stringify({
          device_id: this.deviceId,
          status,
          result: accepted
            ? 'Instruction transmise à l’interface locale pour validation.'
            : 'Instruction refusée sur le PC.'
        })
      }
    );
    this.pendingCommands = this.pendingCommands.filter((item) => item.id !== command.id);
    if (accepted && command.action === 'instruction') {
      this.emit('instruction', command);
    } else {
      this.emit('state');
    }
    return this.state();
  }

  private async performHeartbeat(): Promise<void> {
    const project = this.options.getProject();
    const request = this.options.request || authenticatedApiRequest;
    const response = await request<RelayHeartbeatApi>(
      '/neuraco/relay/heartbeat',
      {
        method: 'POST',
        body: JSON.stringify({
          device_id: this.deviceId,
          device_name: hostname().slice(0, 120) || 'PC Windows',
          app_version: this.options.appVersion,
          project_id: project?.id,
          project_name: project?.name,
          capabilities: [
            'progress',
            'terminal_output',
            'diffs',
            'instructions',
            'pause',
            'stop'
          ]
        })
      }
    );
    this.connected = true;
    this.error = undefined;
    this.lastHeartbeatAt = response.server_time;
    for (const rawCommand of response.commands || []) {
      const command = toCommand(rawCommand);
      if (!this.pendingCommands.some((item) => item.id === command.id)) {
        this.pendingCommands.push(command);
        this.emit('command', command);
      }
    }
    this.emit('state');
  }

  private emit(type: NeuraCoRelayEvent['type'], command?: NeuraCoRelayCommand): void {
    this.options.onEvent({ type, command, state: this.state() });
  }

  private async loadOrCreateDeviceId(): Promise<string> {
    try {
      const stored = (await readFile(this.options.storePath, 'utf8')).trim();
      if (/^[A-Za-z0-9_-]{8,120}$/.test(stored)) return stored;
    } catch {
      // First launch.
    }
    const id = randomUUID();
    await mkdir(path.dirname(this.options.storePath), { recursive: true });
    const temporary = `${this.options.storePath}.${process.pid}.tmp`;
    await writeFile(temporary, id, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.options.storePath);
    return id;
  }
}
