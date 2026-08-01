import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('./auth-service', () => ({
  authenticatedApiRequest: requestMock
}));

import { RelayService, type RelayApiRequest } from './relay-service';

const temporaryDirectories: string[] = [];
const services: RelayService[] = [];

beforeEach(() => requestMock.mockReset());

afterEach(async () => {
  services.forEach((service) => service.disable());
  services.length = 0;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

const createService = async (request?: RelayApiRequest) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-relay-'));
  temporaryDirectories.push(directory);
  const events: unknown[] = [];
  const storePath = path.join(directory, 'device-id');
  const service = new RelayService({
    storePath,
    appVersion: '0.1.0',
    getProject: () => ({
      id: 'project_12345678',
      name: 'Projet test',
      rootPath: 'C:\\Projet'
    }),
    onEvent: (event) => events.push(event),
    heartbeatMs: 60_000,
    request
  });
  services.push(service);
  return { service, events, storePath };
};

describe('RelayService', () => {
  it('utilise seulement un heartbeat HTTPS sortant et n’ouvre aucun port public', async () => {
    requestMock.mockResolvedValue({
      commands: [],
      server_time: '2026-07-26T10:00:00.000Z'
    });
    const { service, storePath } = await createService();
    const state = await service.enable();

    expect(state).toMatchObject({
      enabled: true,
      connected: true,
      transport: 'outbound-https',
      publicPortOpen: false
    });
    expect(requestMock).toHaveBeenCalledWith(
      '/neuraco/relay/heartbeat',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(requestMock.mock.calls[0][1].body);
    expect(body.project_id).toBe('project_12345678');
    expect(await readFile(storePath, 'utf8')).toBe(state.deviceId);
  });

  it('met une instruction distante en attente de validation locale', async () => {
    requestMock.mockResolvedValueOnce({
      commands: [{
        id: 'command_12345678',
        device_id: 'device_12345678',
        action: 'instruction',
        payload: { instruction: 'Lance les tests ciblés.' },
        status: 'delivered',
        created_at: '2026-07-26T10:00:00.000Z',
        expires_at: '2026-07-26T10:05:00.000Z'
      }],
      server_time: '2026-07-26T10:00:01.000Z'
    });
    const { service, events } = await createService();
    const state = await service.enable();

    expect(state.pendingCommands).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'command',
        command: expect.objectContaining({ action: 'instruction' })
      })
    ]));

    requestMock.mockResolvedValueOnce({ status: 'completed' });
    const resolved = await service.resolve('command_12345678', true);
    expect(resolved.pendingCommands).toHaveLength(0);
    expect(JSON.parse(requestMock.mock.calls[1][1].body)).toMatchObject({
      status: 'completed',
      device_id: state.deviceId
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'instruction' })
    ]));
  });

  it('reste désactivé et contrôlé quand le serveur est indisponible', async () => {
    const failingRequest: RelayApiRequest = async () => {
      throw new Error('Réseau indisponible');
    };
    const { service } = await createService(failingRequest);
    const connected = await service.enable();
    expect(connected.connected).toBe(false);
    expect(connected.error).toBe('Réseau indisponible');

    const disabled = service.disable();
    expect(disabled.enabled).toBe(false);
    expect(disabled.publicPortOpen).toBe(false);
  });
});
