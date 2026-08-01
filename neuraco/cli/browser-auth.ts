import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { CLI_API_BASE_URL } from './api-client';

const execFileAsync = promisify(execFile);
const WEBSITE_URL = (
  process.env.NEURACO_WEBSITE_URL
  || 'https://neura-alnour.vercel.app'
).replace(/\/$/, '');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface ExchangeResponse {
  token: string;
  user: { id: string; email: string; name?: string };
  entitlement: { neuraco_access: boolean; plan: string; reason: string };
}

const listenOnLoopback = (server: Server): Promise<number> => new Promise(
  (resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Callback local NeuraCo indisponible.'));
        return;
      }
      resolve(address.port);
    });
  }
);

const openBrowser = async (url: string): Promise<void> => {
  if (process.platform !== 'win32') throw new Error('NeuraCo CLI nécessite Windows.');
  await execFileAsync('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    windowsHide: true,
    timeout: 30_000
  });
};

export const authenticateCliInBrowser = async (): Promise<ExchangeResponse> => {
  const state = randomBytes(32).toString('base64url');
  let server: Server | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const codePromise = new Promise<string>(async (resolve, reject) => {
      server = createServer((request, response) => {
        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== '/callback') {
          response.writeHead(404).end();
          return;
        }
        const returnedState = requestUrl.searchParams.get('state');
        const code = requestUrl.searchParams.get('code');
        if (returnedState !== state || !code) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Connexion NeuraCo invalide.');
          reject(new Error('La vérification de sécurité NeuraCo a échoué.'));
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        response.end(
          '<!doctype html><html lang="fr"><meta charset="utf-8">'
          + '<title>NeuraCo connecté</title><body style="font-family:system-ui;padding:48px">'
          + '<h1>Connexion NeuraCo validée</h1>'
          + '<p>Vous pouvez fermer cette fenêtre et revenir au terminal.</p></body></html>'
        );
        resolve(code);
      });
      try {
        const port = await listenOnLoopback(server);
        const callbackUrl = `http://127.0.0.1:${port}/callback`;
        const connectUrl = new URL('/neuraco/connect', WEBSITE_URL);
        connectUrl.searchParams.set('state', state);
        connectUrl.searchParams.set('callback', callbackUrl);
        await openBrowser(connectUrl.toString());
      } catch (error) {
        reject(error);
      }
      timeout = setTimeout(
        () => reject(new Error('La connexion NeuraCo a expiré.')),
        LOGIN_TIMEOUT_MS
      );
    });
    const code = await codePromise;
    const response = await fetch(`${CLI_API_BASE_URL}/neuraco/auth/exchange`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(30_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.token) {
      throw new Error(
        typeof payload?.detail === 'string'
          ? payload.detail
          : 'Le serveur a refusé la connexion NeuraCo.'
      );
    }
    return payload as ExchangeResponse;
  } finally {
    if (timeout) clearTimeout(timeout);
    server?.close();
  }
};

