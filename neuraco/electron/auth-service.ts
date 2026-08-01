import {
  app,
  net,
  safeStorage,
  shell
} from 'electron';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  NeuraCoEntitlement,
  NeuraCoLoginCredentials,
  NeuraCoRegistration,
  NeuraCoSession,
  NeuraCoUser
} from './ipc-contract';

const API_BASE_URL = (
  process.env.NEURACO_API_BASE_URL
  || 'https://neura-alnour-backend.onrender.com/api'
).replace(/\/$/, '');
const WEBSITE_URL = (
  process.env.NEURACO_WEBSITE_URL
  || 'https://neura-alnour.vercel.app'
).replace(/\/$/, '');
const GOOGLE_TIMEOUT_MS = 5 * 60 * 1000;

interface LoginResponse {
  token: string;
  user: NeuraCoUser;
}

interface ExchangeResponse extends LoginResponse {
  entitlement: NeuraCoEntitlement;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown
  ) {
    super(message);
  }
}

const tokenPath = () => path.join(app.getPath('userData'), 'session.bin');

const apiRequest = async <T>(
  route: string,
  options: RequestInit = {},
  token?: string
): Promise<T> => {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await net.fetch(`${API_BASE_URL}${route}`, {
    ...options,
    headers
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === 'string'
      ? detail
      : detail?.message || 'La requête NeuraCo a échoué.';
    throw new ApiError(message, response.status, detail);
  }
  return payload as T;
};

export const publicApiRequest = <T>(
  route: string,
  options: RequestInit = {}
): Promise<T> => apiRequest<T>(route, options);

export const authenticatedApiRequest = async <T>(
  route: string,
  options: RequestInit = {}
): Promise<T> => {
  const token = await loadToken();
  if (!token) throw new ApiError('Session NeuraCo expirée.', 401);
  return apiRequest<T>(route, options, token);
};

export const authenticatedApiDownload = async (
  absoluteUrl: string,
  signal?: AbortSignal
): Promise<Response> => {
  const token = await loadToken();
  if (!token) throw new ApiError('Session NeuraCo expirée.', 401);
  const target = new URL(absoluteUrl);
  const api = new URL(API_BASE_URL);
  if (
    target.protocol !== 'https:'
    || target.origin !== api.origin
    || !target.pathname.startsWith('/api/neuraco/download/')
  ) {
    throw new ApiError('Source de mise à jour NeuraCo non autorisée.', 400);
  }
  return net.fetch(target.toString(), {
    method: 'GET',
    signal,
    headers: {
      Accept: 'application/vnd.microsoft.portable-executable',
      Authorization: `Bearer ${token}`
    }
  });
};

const saveToken = async (token: string): Promise<boolean> => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const target = tokenPath();
  const temporary = `${target}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, safeStorage.encryptString(token));
  await rename(temporary, target);
  return true;
};

const loadToken = async (): Promise<string | null> => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(await readFile(tokenPath()));
  } catch {
    return null;
  }
};

const deleteToken = async (): Promise<void> => {
  await rm(tokenPath(), { force: true });
};

const deniedSession = (
  user: NeuraCoUser | undefined,
  entitlement: NeuraCoEntitlement
): NeuraCoSession => ({
  status: 'denied',
  user,
  entitlement,
  persistent: false
});

const sessionFromToken = async (
  token: string,
  persist: boolean
): Promise<NeuraCoSession> => {
  const [user, entitlement] = await Promise.all([
    apiRequest<NeuraCoUser>('/auth/me', {}, token),
    apiRequest<NeuraCoEntitlement>('/neuraco/access', {}, token)
  ]);
  if (!entitlement.neuraco_access) {
    return deniedSession(user, entitlement);
  }
  const persistent = persist ? await saveToken(token) : safeStorage.isEncryptionAvailable();
  return {
    status: 'authenticated',
    user,
    entitlement,
    persistent
  };
};

const sessionError = (error: unknown): NeuraCoSession => {
  if (error instanceof ApiError && error.status === 403) {
    const detail = error.detail as { reason?: string; plan?: string } | undefined;
    return deniedSession(undefined, {
      neuraco_access: false,
      plan: detail?.plan || 'free',
      reason: detail?.reason || 'access_denied'
    });
  }
  if (
    error instanceof ApiError
    && error.status === 401
    && (error.detail as { code?: string } | undefined)?.code === 'two_factor_required'
  ) {
    return {
      status: 'error',
      error: error.message,
      requiresTwoFactor: true
    };
  }
  return {
    status: 'error',
    error: error instanceof Error
      ? error.message
      : 'Impossible de se connecter à NeuraCo.'
  };
};

export const restoreSession = async (): Promise<NeuraCoSession> => {
  const token = await loadToken();
  if (!token) return { status: 'signed_out' };
  try {
    return await sessionFromToken(token, false);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await deleteToken();
      return { status: 'signed_out' };
    }
    return sessionError(error);
  }
};

export const loginWithPassword = async (
  credentials: NeuraCoLoginCredentials
): Promise<NeuraCoSession> => {
  const email = credentials.email.trim().toLowerCase();
  if (
    email.length < 3
    || email.length > 254
    || !email.includes('@')
    || credentials.password.length < 6
    || credentials.password.length > 256
  ) {
    return {
      status: 'error',
      error: 'Adresse e-mail ou mot de passe invalide.'
    };
  }

  try {
    const response = await apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: credentials.password,
        two_factor_code: credentials.twoFactorCode?.trim() || undefined
      })
    });
    return await sessionFromToken(response.token, true);
  } catch (error) {
    return sessionError(error);
  }
};

export const registerWithPassword = async (
  registration: NeuraCoRegistration
): Promise<NeuraCoSession> => {
  const name = registration.name.trim();
  const email = registration.email.trim().toLowerCase();
  if (
    name.length < 2
    || name.length > 120
    || email.length < 3
    || email.length > 254
    || !email.includes('@')
    || registration.password.length < 8
    || registration.password.length > 256
  ) {
    return {
      status: 'error',
      error: 'Nom, adresse e-mail ou mot de passe invalide.'
    };
  }

  try {
    const response = await apiRequest<LoginResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password: registration.password })
    });
    return await sessionFromToken(response.token, true);
  } catch (error) {
    return sessionError(error);
  }
};

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

let activeGoogleLogin: Promise<NeuraCoSession> | null = null;

const startGoogleLogin = async (): Promise<NeuraCoSession> => {
  const state = randomBytes(32).toString('base64url');
  let server: Server;
  let timeout: ReturnType<typeof setTimeout>;

  const callback = new Promise<string>(async (resolve, reject) => {
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
        reject(new Error('La vérification de sécurité Google a échoué.'));
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      response.end(
        '<!doctype html><html lang="fr"><meta charset="utf-8">'
        + '<title>NeuraCo connecté</title><body style="font-family:system-ui;'
        + 'background:#07090f;color:#fff;padding:48px">'
        + '<h1>Connexion NeuraCo validée</h1>'
        + '<p>Vous pouvez fermer cette fenêtre et revenir dans NeuraCo.</p></body></html>'
      );
      resolve(code);
    });

    try {
      const port = await listenOnLoopback(server);
      const callbackUrl = `http://127.0.0.1:${port}/callback`;
      const connectUrl = new URL('/neuraco/connect', WEBSITE_URL);
      connectUrl.searchParams.set('state', state);
      connectUrl.searchParams.set('callback', callbackUrl);
      await shell.openExternal(connectUrl.toString());
    } catch (error) {
      reject(error);
    }

    timeout = setTimeout(
      () => reject(new Error('La connexion Google NeuraCo a expiré.')),
      GOOGLE_TIMEOUT_MS
    );
  });

  try {
    const code = await callback;
    const response = await apiRequest<ExchangeResponse>('/neuraco/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    const persistent = await saveToken(response.token);
    return {
      status: 'authenticated',
      user: response.user,
      entitlement: response.entitlement,
      persistent
    };
  } catch (error) {
    return sessionError(error);
  } finally {
    clearTimeout(timeout!);
    server!.close();
  }
};

export const loginWithGoogle = (): Promise<NeuraCoSession> => {
  if (!activeGoogleLogin) {
    activeGoogleLogin = startGoogleLogin().finally(() => {
      activeGoogleLogin = null;
    });
  }
  return activeGoogleLogin;
};

export const logout = async (): Promise<NeuraCoSession> => {
  try {
    await authenticatedApiRequest('/auth/logout', { method: 'POST' });
  } catch {
    // Local sign-out must remain available while the server is offline.
  }
  await deleteToken();
  return { status: 'signed_out' };
};
