import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  readFile: vi.fn().mockResolvedValue(Buffer.from('encrypted-session')),
  rm: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('C:\\NeuraCo-Test')
  },
  net: {
    fetch: mocks.fetch
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    decryptString: vi.fn().mockReturnValue('stored-token'),
    encryptString: vi.fn().mockReturnValue(Buffer.from('encrypted-session'))
  },
  shell: {
    openExternal: vi.fn()
  }
}));

vi.mock('node:fs/promises', () => {
  const module = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: mocks.readFile,
    rename: vi.fn().mockResolvedValue(undefined),
    rm: mocks.rm,
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
  return { ...module, default: module };
});

import { prewarmBackend, restoreSession } from './auth-service';

describe('NeuraCo authentication timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetch.mockReset();
    mocks.fetch.mockImplementation((_url, options: RequestInit = {}) => (
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      })
    ));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arrete les controles serveur qui ne repondent jamais', async () => {
    const pending = restoreSession();

    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: 'error',
      error: 'Le serveur NeuraCo ne repond pas. Verifiez votre connexion puis reessayez.'
    });
    expect(mocks.rm).not.toHaveBeenCalled();
  });

  it('arrete aussi une reponse dont le contenu reste bloque', async () => {
    mocks.fetch.mockImplementation((_url, options: RequestInit = {}) => (
      Promise.resolve({
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        })
      })
    ));

    const pending = restoreSession();
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(pending).resolves.toMatchObject({
      status: 'error',
      error: 'Le serveur NeuraCo ne repond pas. Verifiez votre connexion puis reessayez.'
    });
  });

  it('reveille le backend sans bloquer indefiniment le demarrage', async () => {
    const pending = prewarmBackend();

    await vi.advanceTimersByTimeAsync(8_000);

    await expect(pending).resolves.toBe(false);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://neura-alnour-backend.onrender.com/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
