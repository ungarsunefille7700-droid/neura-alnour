import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoAgentFileContext,
  NeuraCoAgentResponse,
  NeuraCoConversationThread,
  NeuraCoConversationThreadSummary,
  NeuraCoProjectPermissions,
  NeuraCoUsageSummary
} from './ipc-contract';

const PROTOCOL_VERSION = 1;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_FILES = 8;
const MAX_FILE_CONTENT = 80_000;

export interface NeuraCoIdeBridgeManifest {
  protocolVersion: number;
  port: number;
  token: string;
  pid: number;
  generatedAt: string;
}

export interface NeuraCoIdeBridgeModel {
  id: 'auto' | 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash';
  name: string;
  provider: string;
}

export interface NeuraCoIdeBridgeContext {
  project: {
    id: string;
    name: string;
    rootPath: string;
  };
  threads: NeuraCoConversationThreadSummary[];
  activeThread: NeuraCoConversationThread | null;
  agents: unknown[];
  permissions: NeuraCoProjectPermissions;
  models: NeuraCoIdeBridgeModel[];
  usage: NeuraCoUsageSummary | null;
}

export interface NeuraCoIdeBridgeChatRequest {
  content: string;
  threadId?: string;
  agentId?: string;
  mode: 'question' | 'plan';
  model: NeuraCoIdeBridgeModel['id'];
  files: NeuraCoAgentFileContext[];
}

export interface NeuraCoIdeBridgeChatResponse {
  response: NeuraCoAgentResponse;
  thread: NeuraCoConversationThread;
}

interface IdeBridgeCallbacks {
  getContext: () => Promise<NeuraCoIdeBridgeContext>;
  createThread: (title?: string) => Promise<NeuraCoConversationThread>;
  selectThread: (threadId: string) => Promise<NeuraCoConversationThread>;
  sendMessage: (
    request: NeuraCoIdeBridgeChatRequest
  ) => Promise<NeuraCoIdeBridgeChatResponse>;
}

interface IdeBridgeOptions {
  manifestPath: string;
  callbacks: IdeBridgeCallbacks;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const json = (
  response: ServerResponse,
  status: number,
  value: unknown
): void => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  response.end(body);
};

const isLoopback = (request: IncomingMessage): boolean => {
  const address = request.socket.remoteAddress || '';
  return (
    address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
  );
};

const cleanText = (
  value: unknown,
  name: string,
  maximum: number,
  required = true
): string => {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return '';
    throw new HttpError(400, `${name} invalide.`);
  }
  const result = value.trim();
  if ((required && !result) || result.length > maximum) {
    throw new HttpError(400, `${name} invalide.`);
  }
  return result;
};

const readBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new HttpError(413, 'La requête IDE dépasse la taille autorisée.');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('invalid');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Corps JSON invalide.');
  }
};

const validateFiles = (value: unknown): NeuraCoAgentFileContext[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FILES) {
    throw new HttpError(400, 'Contexte de fichiers IDE invalide.');
  }
  return value.map((raw) => {
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
      throw new HttpError(400, 'Contexte de fichier IDE invalide.');
    }
    const file = raw as Record<string, unknown>;
    return {
      path: cleanText(file.path, 'Chemin du fichier', 1_000),
      content: cleanText(file.content, 'Contenu du fichier', MAX_FILE_CONTENT),
      language: cleanText(file.language, 'Langage du fichier', 80, false) || undefined
    };
  });
};

export class IdeBridgeService {
  private server: Server | null = null;
  private manifest: NeuraCoIdeBridgeManifest | null = null;

  constructor(private readonly options: IdeBridgeOptions) {}

  state(): Omit<NeuraCoIdeBridgeManifest, 'token'> | null {
    if (!this.manifest) return null;
    const { token: _token, ...safeManifest } = this.manifest;
    return safeManifest;
  }

  async start(): Promise<Omit<NeuraCoIdeBridgeManifest, 'token'>> {
    if (this.server && this.manifest) {
      return this.state() as Omit<NeuraCoIdeBridgeManifest, 'token'>;
    }
    const token = randomBytes(32).toString('base64url');
    const server = createServer((request, response) => {
      void this.handle(request, response, token);
    });
    server.maxHeadersCount = 32;
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Le pont IDE local n’a pas obtenu de port sécurisé.');
    }
    this.server = server;
    this.manifest = {
      protocolVersion: PROTOCOL_VERSION,
      port: address.port,
      token,
      pid: process.pid,
      generatedAt: new Date().toISOString()
    };
    await this.writeManifest(this.manifest);
    return this.state() as Omit<NeuraCoIdeBridgeManifest, 'token'>;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.manifest = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await unlink(this.options.manifestPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private async writeManifest(manifest: NeuraCoIdeBridgeManifest): Promise<void> {
    await mkdir(path.dirname(this.options.manifestPath), { recursive: true });
    const temporary = `${this.options.manifestPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporary, this.options.manifestPath);
  }

  private authorize(request: IncomingMessage, token: string): void {
    if (!isLoopback(request)) {
      throw new HttpError(403, 'Client IDE non local refusé.');
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      throw new HttpError(401, 'Association NeuraCo Desktop requise.');
    }
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    token: string
  ): Promise<void> {
    try {
      this.authorize(request, token);
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        json(response, 200, {
          ok: true,
          protocolVersion: PROTOCOL_VERSION,
          product: 'NeuraCo Desktop'
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/context') {
        json(response, 200, await this.options.callbacks.getContext());
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/threads') {
        const body = await readBody(request);
        const title = cleanText(body.title, 'Titre du fil', 120, false) || undefined;
        json(response, 201, await this.options.callbacks.createThread(title));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/threads/select') {
        const body = await readBody(request);
        const threadId = cleanText(body.threadId, 'Identifiant du fil', 160);
        json(response, 200, await this.options.callbacks.selectThread(threadId));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/chat') {
        const body = await readBody(request);
        const mode = body.mode === undefined ? 'question' : String(body.mode);
        const model = body.model === undefined ? 'auto' : String(body.model);
        if (!['question', 'plan'].includes(mode)) {
          throw new HttpError(400, 'Mode IDE invalide.');
        }
        if (![
          'auto',
          'claude-sonnet-4-5',
          'gpt-4o',
          'gemini-2.5-flash'
        ].includes(model)) {
          throw new HttpError(400, 'Modèle IDE invalide.');
        }
        json(response, 200, await this.options.callbacks.sendMessage({
          content: cleanText(body.content, 'Demande IDE', 12_000),
          threadId: cleanText(
            body.threadId,
            'Identifiant du fil',
            160,
            false
          ) || undefined,
          agentId: cleanText(
            body.agentId,
            'Identifiant de l’agent',
            120,
            false
          ) || undefined,
          mode: mode as 'question' | 'plan',
          model: model as NeuraCoIdeBridgeModel['id'],
          files: validateFiles(body.files)
        }));
        return;
      }
      throw new HttpError(404, 'Route du pont IDE introuvable.');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error
        ? error.message
        : 'Le pont IDE NeuraCo a rencontré une erreur.';
      json(response, status, { error: message });
    }
  }
}
