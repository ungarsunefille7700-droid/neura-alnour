import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IdeBridgeService,
  type NeuraCoIdeBridgeContext
} from './ide-bridge-service';

const services: IdeBridgeService[] = [];

const context: NeuraCoIdeBridgeContext = {
  project: {
    id: '0123456789abcdef01234567',
    name: 'Projet test',
    rootPath: 'C:\\projet'
  },
  threads: [],
  activeThread: null,
  agents: [{ id: 'main', name: 'Assistant principal' }],
  permissions: {
    projectId: '0123456789abcdef01234567',
    projectRoot: 'C:\\projet',
    configured: true,
    mode: 'manual',
    allowedActions: ['read_file'],
    allowedFolders: ['C:\\projet'],
    allowedCommandPrefixes: [],
    allowedDomains: [],
    allowedApplications: [],
    alwaysAllowedSignatures: [],
    updatedAt: new Date().toISOString()
  },
  models: [{
    id: 'auto',
    name: 'Automatique',
    provider: 'NeuraCo'
  }, {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic'
  }],
  usage: null
};

const createService = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-ide-'));
  const manifestPath = path.join(directory, 'ide-bridge.json');
  const callbacks = {
    getContext: vi.fn().mockResolvedValue(context),
    createThread: vi.fn().mockResolvedValue({ threadId: 'thread-new' }),
    selectThread: vi.fn().mockResolvedValue({ threadId: 'thread-selected' }),
    sendMessage: vi.fn().mockResolvedValue({
      response: { message: 'Réponse NeuraCo' },
      thread: { threadId: 'thread-current' }
    })
  };
  const service = new IdeBridgeService({ manifestPath, callbacks });
  services.push(service);
  await service.start();
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    port: number;
    token: string;
  };
  const request = (
    route: string,
    init: RequestInit = {},
    token = manifest.token
  ) => fetch(`http://127.0.0.1:${manifest.port}${route}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  return { service, callbacks, manifestPath, manifest, request };
};

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
});

describe('IdeBridgeService', () => {
  it('publie un manifeste secret et expose uniquement le contexte authentifié', async () => {
    const { service, manifest, request } = await createService();
    expect(manifest.token.length).toBeGreaterThan(30);
    expect(service.state()).not.toHaveProperty('token');

    const unauthorized = await request('/v1/context', {}, 'jeton-invalide');
    expect(unauthorized.status).toBe(401);

    const response = await request('/v1/context');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      project: { name: 'Projet test' },
      agents: [{ id: 'main' }]
    });
  });

  it('valide et transmet les demandes de chat avec le contexte éditeur', async () => {
    const { callbacks, request } = await createService();
    const response = await request('/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Explique ce fichier',
        agentId: 'developer',
        mode: 'question',
        model: 'claude-sonnet-4-5',
        files: [{
          path: 'src/App.tsx',
          content: 'export const App = () => null;',
          language: 'TypeScript'
        }]
      })
    });
    expect(response.status).toBe(200);
    expect(callbacks.sendMessage).toHaveBeenCalledWith({
      content: 'Explique ce fichier',
      agentId: 'developer',
      mode: 'question',
      model: 'claude-sonnet-4-5',
      files: [{
        path: 'src/App.tsx',
        content: 'export const App = () => null;',
        language: 'TypeScript'
      }]
    });
  });

  it('refuse les modèles et charges invalides sans appeler le moteur', async () => {
    const { callbacks, request } = await createService();
    const invalidModel = await request('/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Test',
        model: 'modele-invente'
      })
    });
    expect(invalidModel.status).toBe(400);
    expect(callbacks.sendMessage).not.toHaveBeenCalled();

    const oversized = await request('/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        content: 'x'.repeat(300_000)
      })
    });
    expect(oversized.status).toBe(413);
    expect(callbacks.sendMessage).not.toHaveBeenCalled();
  });

  it('supprime le manifeste lors de l’arrêt', async () => {
    const { service, manifestPath } = await createService();
    await service.stop();
    await expect(readFile(manifestPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });
});
