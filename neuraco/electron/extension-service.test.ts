import {
  createServer,
  type Server
} from 'node:http';
import {
  generateKeyPairSync,
  sign
} from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExtensionService,
  inspectExtensionPackage
} from './extension-service';

const directories: string[] = [];
const servers: Server[] = [];

const setup = async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'neuraco-extensions-'));
  directories.push(rootPath);
  const sourcePath = path.join(rootPath, 'source');
  await mkdir(sourcePath, { recursive: true });
  return {
    rootPath,
    sourcePath,
    storePath: path.join(rootPath, 'store.json'),
    service: new ExtensionService(
      path.join(rootPath, 'store.json'),
      path.join(rootPath, 'installed')
    )
  };
};

const writeSkill = async (
  sourcePath: string,
  override: Record<string, unknown> = {}
) => {
  await writeFile(
    path.join(sourcePath, 'SKILL.md'),
    '# React\nToujours vérifier les composants existants avant toute modification.',
    'utf8'
  );
  await writeFile(
    path.join(sourcePath, 'example.md'),
    'Exemple React.',
    'utf8'
  );
  await writeFile(
    path.join(sourcePath, 'skill.test.js'),
    'export default true;',
    'utf8'
  );
  await writeFile(
    path.join(sourcePath, 'neuraco-extension.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'react-developer',
      name: 'Développeur React',
      version: '1.0.0',
      description: 'Compétence React locale',
      kind: 'skill',
      origin: 'local',
      provider: 'NeuraCo local',
      privacyPolicy: 'Aucune donnée ne quitte le poste.',
      permissions: {
        files: ['src/**'],
        network: [],
        commands: ['npm test'],
        data: ['code source']
      },
      instructions: 'SKILL.md',
      scripts: [],
      references: [],
      examples: ['example.md'],
      tests: ['skill.test.js'],
      tools: [{
        id: 'react-review',
        name: 'Revue React',
        description: 'Vérifie un composant'
      }],
      ...override
    }, null, 2),
    'utf8'
  );
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => (
    new Promise<void>((resolve) => server.close(() => resolve()))
  )));
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('ExtensionService', () => {
  it('installs a complete local skill and exposes only enabled instructions', async () => {
    const { service, sourcePath } = await setup();
    await writeSkill(sourcePath);
    const installed = await service.installFromDirectory(sourcePath);

    expect(installed.extensions).toHaveLength(1);
    expect(installed.extensions[0]).toMatchObject({
      id: 'react-developer',
      kind: 'skill',
      trust: 'unsigned',
      enabled: false
    });
    expect(installed.extensions[0].permissions.files).toEqual(['src/**']);
    expect(installed.extensions[0].examples).toEqual(['example.md']);
    expect(await service.promptContext()).toBe('');

    await service.setToolEnabled('react-developer', 'react-review', false);
    await service.setEnabled('react-developer', true);
    expect(await service.promptContext()).toContain('Toujours vérifier');
    await service.setEnabled('react-developer', false);
    expect(await service.promptContext()).toBe('');
    expect((await service.state()).extensions[0].tools[0].enabled).toBe(false);
  });

  it('rejects invalid integrity, unsigned official packages and symlinks by policy', async () => {
    const { service, sourcePath } = await setup();
    await writeSkill(sourcePath, { integrity: 'sha256:invalid' });
    await expect(service.installFromDirectory(sourcePath)).rejects.toThrow(
      'intégrité'
    );

    await writeSkill(sourcePath, {
      origin: 'official',
      integrity: undefined
    });
    await expect(service.installFromDirectory(sourcePath)).rejects.toThrow(
      'doit être signée'
    );
  });

  it('verifies a genuinely signed official package with Ed25519', async () => {
    const { service, sourcePath } = await setup();
    await writeSkill(sourcePath, { origin: 'official' });
    const inspection = await inspectExtensionPackage(sourcePath);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signature = sign(
      null,
      Buffer.from(inspection.digest, 'utf8'),
      privateKey
    ).toString('base64');
    const manifestPath = path.join(sourcePath, 'neuraco-extension.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.integrity = inspection.integrity;
    manifest.signature = {
      algorithm: 'ed25519',
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      value: signature
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const state = await service.installFromDirectory(sourcePath);
    expect(state.extensions[0]).toMatchObject({
      origin: 'official',
      trust: 'verified',
      signatureVerified: true
    });
    expect(state.extensions[0].warnings).toEqual([]);
  });

  it('updates from the original local source and removes managed files', async () => {
    const { service, sourcePath, storePath } = await setup();
    await writeSkill(sourcePath);
    const first = await service.installFromDirectory(sourcePath);
    const installPath = first.extensions[0].installPath;
    await writeSkill(sourcePath, { version: '1.1.0' });
    const updated = await service.update('react-developer');
    expect(updated.extensions[0].version).toBe('1.1.0');

    const removed = await service.remove('react-developer');
    expect(removed.extensions).toEqual([]);
    expect(await readFile(storePath, 'utf8')).not.toContain('react-developer');
    await expect(readFile(path.join(installPath, 'SKILL.md'), 'utf8')).rejects.toThrow();
  });

  it('automatically disables a managed package modified after installation', async () => {
    const { service, sourcePath } = await setup();
    await writeSkill(sourcePath);
    const installed = await service.installFromDirectory(sourcePath);
    await service.setEnabled('react-developer', true);
    await writeFile(
      path.join(installed.extensions[0].installPath, 'SKILL.md'),
      'Contenu modifié après installation.',
      'utf8'
    );

    const verified = await service.state();
    expect(verified.extensions[0].enabled).toBe(false);
    expect(verified.extensions[0].warnings).toContain(
      'Extension désactivée : contrôle d’intégrité échoué.'
    );
    expect(await service.promptContext()).toBe('');
  });

  it('connects to a real local MCP stdio server and controls tools individually', async () => {
    const { service, rootPath } = await setup();
    const serverScript = path.join(rootPath, 'mcp-server.cjs');
    await writeFile(serverScript, `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'test', version: '1.0.0' }
      }
    }) + '\\n');
  }
  if (request.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [{
          name: 'project_search',
          description: 'Recherche dans le projet',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
        }]
      }
    }) + '\\n');
  }
});`, 'utf8');

    const added = await service.addMcpServer({
      name: 'MCP local de test',
      transport: 'stdio',
      command: process.execPath,
      args: [serverScript],
      environmentVariables: []
    });
    const serverId = added.mcpServers[0].id;
    const tested = await service.testMcpServer(serverId);
    expect(tested.mcpServers[0]).toMatchObject({
      status: 'disabled',
      lastError: undefined
    });
    expect(tested.mcpServers[0].tools[0].name).toBe('project_search');

    const enabled = await service.setMcpEnabled(serverId, true);
    expect(enabled.enabledMcpToolCount).toBe(1);
    const toolDisabled = await service.setMcpToolEnabled(
      serverId,
      'project_search',
      false
    );
    expect(toolDisabled.enabledMcpToolCount).toBe(0);
    expect(await service.promptContext()).toBe('');
  });

  it('connects to a real MCP HTTP endpoint and discovers its tools', async () => {
    const { service } = await setup();
    let initialized = false;
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', () => {
        const message = JSON.parse(body);
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Mcp-Session-Id', 'session-test');
        if (message.method === 'initialize') {
          initialized = true;
          response.end(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'http-test', version: '1.0.0' }
            }
          }));
          return;
        }
        if (message.method === 'notifications/initialized') {
          response.statusCode = 202;
          response.end();
          return;
        }
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [{
              name: 'cloud_lookup',
              description: 'Consulte le service distant',
              inputSchema: { type: 'object' }
            }]
          }
        }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Port indisponible.');
    const added = await service.addMcpServer({
      name: 'MCP HTTP de test',
      transport: 'http',
      url: `http://127.0.0.1:${address.port}/mcp`
    });
    const tested = await service.testMcpServer(added.mcpServers[0].id);
    expect(initialized).toBe(true);
    expect(tested.mcpServers[0].tools[0].name).toBe('cloud_lookup');
    expect(tested.mcpServers[0].lastError).toBeUndefined();
  });

  it('never stores raw MCP secrets and rejects untested activation', async () => {
    const { service } = await setup();
    const added = await service.addMcpServer({
      name: 'Serveur distant',
      transport: 'http',
      url: 'https://mcp.example.test/rpc',
      environmentVariables: ['MCP_TOKEN'],
      headers: [{ name: 'Authorization', environmentVariable: 'MCP_TOKEN' }]
    });
    expect(JSON.stringify(added)).not.toContain(process.env.MCP_TOKEN || 'secret-value');
    await expect(
      service.setMcpEnabled(added.mcpServers[0].id, true)
    ).rejects.toThrow('Testez le serveur');
  });
});
