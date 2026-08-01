import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  NeuraCoPermissionMode,
  NeuraCoProjectPermissions
} from './ipc-contract';
import {
  assessTerminalCommand,
  fileAccessForPath,
  isDefaultProtectedFilePath,
  isSensitiveTerminalCommand,
  normalizeNetworkDomain,
  permissionAllowsWithoutPrompt,
  permissionRefusesWithoutPrompt,
  permissionSignature,
  ProjectPermissionStore
} from './permission-service';

const temporaryDirectories: string[] = [];

const createStore = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-permissions-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    store: new ProjectPermissionStore(path.join(directory, 'permissions.json'))
  };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

const permissionsFor = (
  mode: NeuraCoPermissionMode,
  overrides: Partial<NeuraCoProjectPermissions> = {}
): NeuraCoProjectPermissions => ({
  projectId: 'project-1',
  projectRoot: 'C:\\project',
  configured: true,
  mode,
  allowedActions: [],
  allowedFolders: ['C:\\project'],
  allowedCommandPrefixes: [],
  allowedDomains: [],
  allowedApplications: [],
  alwaysAllowedSignatures: [],
  updatedAt: new Date().toISOString(),
  ...overrides
});

describe('NeuraCo project permissions', () => {
  it('defaults every new project to an unconfigured manual mode', async () => {
    const { store } = await createStore();
    const permissions = await store.get('project-1', 'C:\\project');
    expect(permissions.mode).toBe('manual');
    expect(permissions.configured).toBe(false);
    expect(permissions.readOnlyFolders).toEqual(['C:\\project']);
    expect(permissions.writableFolders).toEqual([]);
    expect(permissions.forbiddenPaths).toEqual([]);
    expect(permissions.networkAccessMode).toBe('ask_each');
  });

  it('persists a sanitized secure automatic configuration per project', async () => {
    const { store, directory } = await createStore();
    const permissions = await store.update('project-1', 'C:\\project', {
      mode: 'safe_auto',
      allowedActions: ['read_file', 'terminal'],
      allowedFolders: ['C:\\project'],
      readOnlyFolders: ['C:\\project\\docs'],
      writableFolders: ['C:\\project\\src'],
      forbiddenPaths: ['C:\\project\\private'],
      allowedCommandPrefixes: ['npm test', 'npm test', 'git status'],
      allowedDomains: ['docs.python.org'],
      allowedApplications: ['Visual Studio Code'],
      alwaysAllowedSignatures: []
    });
    expect(permissions.configured).toBe(true);
    expect(permissions.allowedCommandPrefixes).toEqual(['npm test', 'git status']);
    expect(permissions.readOnlyFolders).toEqual(['C:\\project\\docs']);
    expect(permissions.writableFolders).toEqual(['C:\\project\\src']);
    expect(permissions.forbiddenPaths).toEqual(['C:\\project\\private']);
    const raw = await readFile(path.join(directory, 'permissions.json'), 'utf8');
    expect(raw).not.toContain('api_key');
  });

  it('migrates legacy ask and scoped modes without losing their rules', async () => {
    const { store, directory } = await createStore();
    await writeFile(path.join(directory, 'permissions.json'), JSON.stringify({
      version: 1,
      projects: {
        manualProject: {
          projectId: 'manualProject',
          projectRoot: 'C:\\manual',
          configured: true,
          mode: 'ask',
          allowedActions: [],
          allowedFolders: ['C:\\manual'],
          allowedCommandPrefixes: [],
          allowedDomains: [],
          allowedApplications: [],
          alwaysAllowedSignatures: [],
          updatedAt: '2026-07-28T00:00:00.000Z'
        },
        safeProject: {
          projectId: 'safeProject',
          projectRoot: 'C:\\safe',
          configured: true,
          mode: 'scoped',
          allowedActions: ['terminal'],
          allowedFolders: ['C:\\safe'],
          allowedCommandPrefixes: ['npm test'],
          allowedDomains: [],
          allowedApplications: [],
          alwaysAllowedSignatures: [],
          updatedAt: '2026-07-28T00:00:00.000Z'
        }
      }
    }), 'utf8');

    expect((await store.get('manualProject', 'C:\\manual')).mode).toBe('manual');
    const safe = await store.get('safeProject', 'C:\\safe');
    expect(safe.mode).toBe('safe_auto');
    expect(safe.allowedCommandPrefixes).toEqual(['npm test']);
  });

  it('enforces plan, manual and accept-edits behavior', () => {
    const plan = permissionsFor('plan', { allowedActions: ['read_file'] });
    expect(permissionAllowsWithoutPrompt(
      plan,
      'read_file',
      'C:\\project\\src\\App.tsx',
      new Set()
    )).toBe(true);
    expect(permissionAllowsWithoutPrompt(
      plan,
      'write_file',
      'C:\\project\\src\\App.tsx',
      new Set()
    )).toBe(false);
    expect(permissionRefusesWithoutPrompt(plan, 'terminal', 'npm test', new Set()))
      .toBe(true);

    const manual = permissionsFor('manual');
    expect(permissionAllowsWithoutPrompt(
      manual,
      'write_file',
      'C:\\project\\src\\App.tsx',
      new Set()
    )).toBe(false);
    expect(permissionRefusesWithoutPrompt(
      manual,
      'write_file',
      'C:\\project\\src\\App.tsx',
      new Set()
    )).toBe(false);

    const acceptEdits = permissionsFor('accept_edits', {
      allowedActions: ['read_file', 'write_file']
    });
    expect(permissionAllowsWithoutPrompt(
      acceptEdits,
      'write_file',
      'C:\\project\\src\\App.tsx',
      new Set()
    )).toBe(true);
    expect(permissionAllowsWithoutPrompt(
      acceptEdits,
      'write_file',
      'C:\\outside\\secret.txt',
      new Set()
    )).toBe(false);
    expect(permissionAllowsWithoutPrompt(
      acceptEdits,
      'terminal',
      'npm test',
      new Set()
    )).toBe(false);
  });

  it('enforces forbidden, read-only and writable file scopes in priority order', () => {
    const scoped = permissionsFor('safe_auto', {
      allowedActions: ['read_file', 'write_file'],
      allowedFolders: ['C:\\project'],
      readOnlyFolders: ['C:\\project\\docs'],
      writableFolders: ['C:\\project\\src'],
      forbiddenPaths: ['C:\\project\\src\\private']
    });

    expect(fileAccessForPath(scoped, 'C:\\project\\docs\\guide.md')).toBe('read_only');
    expect(fileAccessForPath(scoped, 'C:\\project\\src\\App.tsx')).toBe('writable');
    expect(fileAccessForPath(scoped, 'C:\\project\\src\\private\\token.txt'))
      .toBe('forbidden');
    expect(permissionAllowsWithoutPrompt(
      scoped,
      'read_file',
      'C:\\project\\docs\\guide.md',
      new Set()
    )).toBe(true);
    expect(permissionAllowsWithoutPrompt(
      scoped,
      'write_file',
      'C:\\project\\docs\\guide.md',
      new Set()
    )).toBe(false);
    expect(permissionAllowsWithoutPrompt(
      scoped,
      'write_file',
      'C:\\project\\src\\App.tsx',
      new Set()
    )).toBe(true);
    expect(permissionRefusesWithoutPrompt(
      scoped,
      'read_file',
      'C:\\project\\src\\private\\token.txt',
      new Set()
    )).toBe(true);
  });

  it('blocks secret files and Windows system locations before project rules', () => {
    const full = permissionsFor('full', {
      writableFolders: ['C:\\'],
      readOnlyFolders: ['C:\\']
    });
    expect(isDefaultProtectedFilePath('C:\\project\\.env.production')).toBe(true);
    expect(permissionAllowsWithoutPrompt(
      full,
      'read_file',
      'C:\\project\\.env.production',
      new Set()
    )).toBe(false);

    if (process.env.WINDIR) {
      const systemFile = path.join(process.env.WINDIR, 'System32', 'config', 'SAM');
      expect(isDefaultProtectedFilePath(systemFile)).toBe(true);
      expect(fileAccessForPath(full, systemFile)).toBe('forbidden');
    }
  });

  it('enforces safe-auto and deny-unapproved scopes', () => {
    const scoped = permissionsFor('safe_auto', {
      allowedActions: ['write_file', 'terminal', 'network', 'application'],
      allowedCommandPrefixes: ['npm test'],
      allowedDomains: ['example.com'],
      allowedApplications: ['vscode']
    });
    expect(permissionAllowsWithoutPrompt(scoped, 'terminal', 'npm test -- --run', new Set()))
      .toBe(true);
    expect(permissionAllowsWithoutPrompt(scoped, 'terminal', 'git push', new Set()))
      .toBe(false);
    expect(permissionAllowsWithoutPrompt(scoped, 'network', 'docs.example.com', new Set()))
      .toBe(true);
    expect(permissionAllowsWithoutPrompt(scoped, 'network', 'example.net', new Set()))
      .toBe(false);
    expect(permissionAllowsWithoutPrompt(scoped, 'application', 'vscode', new Set()))
      .toBe(true);
    expect(permissionAllowsWithoutPrompt(scoped, 'application', 'powershell', new Set()))
      .toBe(false);

    const deny = { ...scoped, mode: 'deny_unapproved' as const };
    expect(permissionRefusesWithoutPrompt(
      deny,
      'network',
      'docs.example.com',
      new Set()
    )).toBe(false);
    expect(permissionRefusesWithoutPrompt(
      deny,
      'network',
      'example.net',
      new Set()
    )).toBe(true);
  });

  it('enforces all four network access modes with exact visible domains', () => {
    const none = permissionsFor('safe_auto', {
      networkAccessMode: 'none',
      allowedDomains: ['example.com']
    });
    expect(permissionAllowsWithoutPrompt(
      none,
      'network',
      'https://example.com/docs',
      new Set()
    )).toBe(false);
    expect(permissionRefusesWithoutPrompt(
      none,
      'network',
      'example.com',
      new Set()
    )).toBe(true);

    const approved = permissionsFor('safe_auto', {
      networkAccessMode: 'approved_domains',
      allowedDomains: ['example.com']
    });
    expect(normalizeNetworkDomain('https://Docs.Example.com/path')).toBe('docs.example.com');
    expect(permissionAllowsWithoutPrompt(
      approved,
      'network',
      'https://docs.example.com/path',
      new Set()
    )).toBe(true);
    expect(permissionRefusesWithoutPrompt(
      approved,
      'network',
      'attacker.example.net',
      new Set()
    )).toBe(true);

    const askEach = permissionsFor('full', {
      networkAccessMode: 'ask_each'
    });
    expect(permissionAllowsWithoutPrompt(
      askEach,
      'network',
      'docs.example.com',
      new Set()
    )).toBe(false);
    expect(permissionAllowsWithoutPrompt(
      askEach,
      'network',
      'docs.example.com',
      new Set(['network:docs.example.com'])
    )).toBe(true);

    const temporary = permissionsFor('manual', {
      networkAccessMode: 'temporary_full',
      temporaryFullNetworkUntil: new Date(Date.now() + 10 * 60_000).toISOString()
    });
    expect(permissionAllowsWithoutPrompt(
      temporary,
      'network',
      'fresh.example.net',
      new Set()
    )).toBe(true);
    expect(permissionAllowsWithoutPrompt(
      {
        ...temporary,
        temporaryFullNetworkUntil: new Date(Date.now() - 1_000).toISOString()
      },
      'network',
      'fresh.example.net',
      new Set()
    )).toBe(false);
  });

  it('rejects expired or excessively long temporary network grants in storage', async () => {
    const { store } = await createStore();
    const expired = await store.update('project-1', 'C:\\project', {
      mode: 'manual',
      allowedActions: [],
      allowedFolders: ['C:\\project'],
      allowedCommandPrefixes: [],
      allowedDomains: [],
      networkAccessMode: 'temporary_full',
      temporaryFullNetworkUntil: new Date(Date.now() - 1_000).toISOString(),
      allowedApplications: [],
      alwaysAllowedSignatures: []
    });
    expect(expired.networkAccessMode).toBe('ask_each');

    const excessive = await store.update('project-1', 'C:\\project', {
      ...expired,
      networkAccessMode: 'temporary_full',
      temporaryFullNetworkUntil: new Date(Date.now() + 2 * 60 * 60_000).toISOString()
    });
    expect(excessive.networkAccessMode).toBe('ask_each');
  });

  it('keeps critical terminal protections active in full access', () => {
    const full = permissionsFor('full');
    expect(permissionAllowsWithoutPrompt(full, 'terminal', 'npm test', new Set()))
      .toBe(true);
    expect(permissionAllowsWithoutPrompt(
      full,
      'terminal',
      'git push origin main',
      new Set()
    )).toBe(false);
    expect(permissionAllowsWithoutPrompt(full, 'application', 'Blender', new Set()))
      .toBe(true);
    expect(isSensitiveTerminalCommand('Remove-Item secrets.txt')).toBe(true);
    expect(permissionSignature('write_file', 'src/App.tsx')).toContain('src/app.tsx');
  });

  it('classifies safe, moderate and sensitive commands on the trusted side', () => {
    expect(assessTerminalCommand('git status')).toMatchObject({
      level: 'safe',
      requiresExplicitConfirmation: false
    });
    expect(assessTerminalCommand('npm install zod')).toMatchObject({
      level: 'moderate',
      requiresExplicitConfirmation: false
    });
    expect(assessTerminalCommand('git push origin main')).toMatchObject({
      level: 'sensitive',
      requiresExplicitConfirmation: true
    });
    expect(assessTerminalCommand('type .env.production')).toMatchObject({
      level: 'sensitive',
      requiresExplicitConfirmation: true
    });
    expect(assessTerminalCommand('Get-Content $HOME\\.ssh\\id_ed25519')).toMatchObject({
      level: 'sensitive',
      requiresExplicitConfirmation: true
    });
  });
});
