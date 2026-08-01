import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authenticatedApiRequest } from './auth-service';
import type { NeuraCoConnectedDevice } from './ipc-contract';

interface DeviceSecurityServiceOptions {
  storePath: string;
  appVersion: string;
  heartbeatMs?: number;
  request?: DeviceSecurityApiRequest;
  onRevoked: () => void | Promise<void>;
}

export type DeviceSecurityApiRequest = <T>(
  pathname: string,
  options?: RequestInit
) => Promise<T>;

interface DeviceApi {
  device_id: string;
  device_name: string;
  app_version: string;
  last_seen_at: string;
  online?: boolean;
  created_at?: string;
  revoked_at?: string;
}

interface HeartbeatApi {
  revoked?: boolean;
  server_time: string;
}

const toDevice = (device: DeviceApi, currentId?: string): NeuraCoConnectedDevice => ({
  deviceId: device.device_id,
  deviceName: device.device_name,
  appVersion: device.app_version,
  lastSeenAt: device.last_seen_at,
  createdAt: device.created_at,
  revokedAt: device.revoked_at,
  online: device.online === true,
  current: device.device_id === currentId
});

export class DeviceSecurityService {
  private deviceId?: string;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;
  private revoked = false;

  constructor(private readonly options: DeviceSecurityServiceOptions) {}

  async start(): Promise<void> {
    if (this.timer) return;
    this.revoked = false;
    this.deviceId = await this.loadOrCreateDeviceId();
    await this.heartbeat();
    if (this.revoked) return;
    this.timer = setInterval(
      () => void this.heartbeat(),
      Math.max(10_000, this.options.heartbeatMs || 30_000)
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.inFlight = undefined;
  }

  async list(): Promise<NeuraCoConnectedDevice[]> {
    this.deviceId = this.deviceId || await this.loadOrCreateDeviceId();
    const request = this.options.request || authenticatedApiRequest;
    const devices = await request<DeviceApi[]>('/neuraco/relay/devices');
    return devices.map((device) => toDevice(device, this.deviceId));
  }

  async revoke(deviceId: string): Promise<NeuraCoConnectedDevice[]> {
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(deviceId)) {
      throw new Error('Identifiant d’appareil invalide.');
    }
    this.deviceId = this.deviceId || await this.loadOrCreateDeviceId();
    const request = this.options.request || authenticatedApiRequest;
    await request(`/neuraco/relay/devices/${encodeURIComponent(deviceId)}/revoke`, {
      method: 'POST'
    });
    if (deviceId === this.deviceId) await this.handleRevoked();
    return deviceId === this.deviceId ? [] : this.list();
  }

  async heartbeat(): Promise<void> {
    if (this.inFlight || this.revoked) return this.inFlight;
    const operation = this.performHeartbeat();
    this.inFlight = operation;
    try {
      await operation;
    } finally {
      if (this.inFlight === operation) this.inFlight = undefined;
    }
  }

  private async performHeartbeat(): Promise<void> {
    this.deviceId = this.deviceId || await this.loadOrCreateDeviceId();
    const request = this.options.request || authenticatedApiRequest;
    const response = await request<HeartbeatApi>('/neuraco/relay/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        device_id: this.deviceId,
        device_name: hostname().slice(0, 120) || 'PC Windows',
        app_version: this.options.appVersion,
        capabilities: ['security', 'remote_logout']
      })
    });
    if (response.revoked) await this.handleRevoked();
  }

  private async handleRevoked(): Promise<void> {
    if (this.revoked) return;
    this.revoked = true;
    this.stop();
    await this.options.onRevoked();
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
