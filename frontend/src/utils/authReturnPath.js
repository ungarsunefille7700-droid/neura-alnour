const SESSION_KEY = 'neura_auth_return_to';
const PERSISTED_KEY = 'neura_auth_return_to_persisted';
const RETURN_PATH_TTL_MS = 10 * 60 * 1000;
const VALIDATION_ORIGIN = 'https://neura-alnour.local';

const isValidLoopbackCallback = (value) => {
  try {
    const callback = new URL(value);
    const port = Number(callback.port);
    return callback.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(callback.hostname)
      && callback.pathname === '/callback'
      && Number.isInteger(port)
      && port > 0
      && port <= 65535
      && !callback.username
      && !callback.password
      && !callback.search
      && !callback.hash;
  } catch {
    return false;
  }
};

export const validateNeuraCoReturnPath = (value) => {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/neuraco/connect?')) {
    return null;
  }

  try {
    const parsed = new URL(value, VALIDATION_ORIGIN);
    const state = parsed.searchParams.get('state') || '';
    const callback = parsed.searchParams.get('callback') || '';

    if (parsed.origin !== VALIDATION_ORIGIN
      || parsed.pathname !== '/neuraco/connect'
      || parsed.hash
      || !/^[A-Za-z0-9_-]{32,256}$/.test(state)
      || !isValidLoopbackCallback(callback)) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
};

export const clearAuthReturnPath = () => {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(PERSISTED_KEY);
  } catch {
    // Storage may be disabled. The callback query remains usable.
  }
};

export const rememberAuthReturnPath = (value) => {
  const returnPath = validateNeuraCoReturnPath(value);
  clearAuthReturnPath();
  if (!returnPath) return null;

  try {
    window.sessionStorage.setItem(SESSION_KEY, returnPath);
    window.localStorage.setItem(PERSISTED_KEY, JSON.stringify({
      path: returnPath,
      createdAt: Date.now()
    }));
  } catch {
    // The return path is also carried in the OAuth callback URL.
  }

  return returnPath;
};

export const resolveAuthReturnPath = (explicitValue) => {
  const explicitPath = validateNeuraCoReturnPath(explicitValue);
  if (explicitPath) return explicitPath;

  try {
    const sessionPath = validateNeuraCoReturnPath(window.sessionStorage.getItem(SESSION_KEY));
    if (sessionPath) return sessionPath;

    const persisted = JSON.parse(window.localStorage.getItem(PERSISTED_KEY) || 'null');
    const isFresh = Number.isFinite(persisted?.createdAt)
      && Date.now() - persisted.createdAt <= RETURN_PATH_TTL_MS;
    if (isFresh) return validateNeuraCoReturnPath(persisted.path);
  } catch {
    return null;
  }

  clearAuthReturnPath();
  return null;
};
