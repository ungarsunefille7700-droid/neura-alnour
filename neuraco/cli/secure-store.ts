import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_TOKEN_BYTES = 16 * 1024;

const storageDirectory = (): string => path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'NeuraCo'
);

export const cliTokenPath = (): string => path.join(storageDirectory(), 'cli-session.bin');

const runDpapi = async (
  operation: 'protect' | 'unprotect',
  input: string
): Promise<string> => {
  if (process.platform !== 'win32') {
    throw new Error('Le stockage sécurisé NeuraCo CLI nécessite Windows.');
  }
  const script = operation === 'protect'
    ? [
        'Add-Type -AssemblyName System.Security',
        '$raw = [Convert]::FromBase64String($env:NEURACO_DPAPI_INPUT)',
        '$encrypted = [System.Security.Cryptography.ProtectedData]::Protect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
        '[Convert]::ToBase64String($encrypted)'
      ].join('; ')
    : [
        'Add-Type -AssemblyName System.Security',
        '$encrypted = [Convert]::FromBase64String($env:NEURACO_DPAPI_INPUT)',
        '$raw = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
        '[Convert]::ToBase64String($raw)'
      ].join('; ');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 128 * 1024,
      env: {
        ...process.env,
        NEURACO_DPAPI_INPUT: input
      }
    }
  );
  const output = stdout.trim();
  if (!output || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) {
    throw new Error('Windows n’a pas pu protéger la session NeuraCo.');
  }
  return output;
};

export const saveCliToken = async (token: string): Promise<void> => {
  const tokenBytes = Buffer.from(token, 'utf8');
  if (tokenBytes.length < 16 || tokenBytes.length > MAX_TOKEN_BYTES) {
    throw new Error('Jeton de session NeuraCo invalide.');
  }
  const protectedValue = await runDpapi('protect', tokenBytes.toString('base64'));
  const target = cliTokenPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, protectedValue, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
};

export const loadCliToken = async (): Promise<string | null> => {
  try {
    const protectedValue = (await readFile(cliTokenPath(), 'utf8')).trim();
    if (
      protectedValue.length < 16
      || protectedValue.length > MAX_TOKEN_BYTES * 4
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(protectedValue)
    ) {
      throw new Error('Session locale NeuraCo invalide.');
    }
    const clearBase64 = await runDpapi('unprotect', protectedValue);
    const token = Buffer.from(clearBase64, 'base64').toString('utf8');
    return token.length >= 16 && token.length <= MAX_TOKEN_BYTES ? token : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

export const deleteCliToken = async (): Promise<void> => {
  await rm(cliTokenPath(), { force: true });
};
