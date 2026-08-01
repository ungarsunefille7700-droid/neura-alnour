import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeviceSecurityService,
  type DeviceSecurityApiRequest
} from './device-security-service';

const directories: string[] = [];
const services: DeviceSecurityService[] = [];

const createService = async (request: ReturnType<typeof vi.fn>) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-device-'));
  directories.push(directory);
  const onRevoked = vi.fn();
  const service = new DeviceSecurityService({
    storePath: path.join(directory, 'device-id'),
    appVersion: '0.1.0',
    heartbeatMs: 60_000,
    request: request as unknown as DeviceSecurityApiRequest,
    onRevoked
  });
  services.push(service);
  return { service, onRevoked };
};

afterEach(async () => {
  services.forEach((service) => service.stop());
  services.length = 0;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe('DeviceSecurityService', () => {
  it('registers the current device and marks it in the server list', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ revoked: false, server_time: '2026-07-28T10:00:00Z' })
      .mockResolvedValueOnce([{
        device_id: 'device_12345678',
        device_name: 'PC Test',
        app_version: '0.1.0',
        last_seen_at: '2026-07-28T10:00:00Z',
        online: true
      }]);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-device-fixed-'));
    directories.push(directory);
    const storePath = path.join(directory, 'device-id');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(storePath, 'device_12345678', 'utf8');
    const service = new DeviceSecurityService({
      storePath,
      appVersion: '0.1.0',
      heartbeatMs: 60_000,
      request: request as unknown as DeviceSecurityApiRequest,
      onRevoked: vi.fn()
    });
    services.push(service);

    await service.start();
    const devices = await service.list();
    expect(devices[0]).toMatchObject({
      deviceId: 'device_12345678',
      current: true,
      online: true
    });
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
      capabilities: ['security', 'remote_logout']
    });
  });

  it('logs out exactly once when the server reports revocation', async () => {
    const request = vi.fn().mockResolvedValue({
      revoked: true,
      server_time: '2026-07-28T10:00:00Z'
    });
    const { service, onRevoked } = await createService(request);
    await service.start();
    await service.heartbeat();
    expect(onRevoked).toHaveBeenCalledOnce();
  });

  it('revokes another user-owned device through the authenticated endpoint', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce([]);
    const { service, onRevoked } = await createService(request);
    const devices = await service.revoke('other_device_123');
    expect(devices).toEqual([]);
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/neuraco/relay/devices/other_device_123/revoke',
      { method: 'POST' }
    );
    expect(onRevoked).not.toHaveBeenCalled();
  });
});
