// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NeuraCoTerminalEvent } from './ipc-contract';
import {
  listTerminalProfiles,
  startTerminalTask,
  validateTerminalCommand
} from './terminal-service';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('NeuraCo controlled terminal', () => {
  it('executes inside the authorized project and streams output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-terminal-'));
    temporaryRoots.push(root);
    const events: NeuraCoTerminalEvent[] = [];
    const command = process.platform === 'win32'
      ? 'echo %CD% & echo test-stderr 1>&2'
      : 'pwd; echo test-stderr 1>&2';

    const task = await startTerminalTask(root, command, (event) => events.push(event));
    const completed = await task.completion;

    expect(completed.type).toBe('completed');
    expect(completed.exitCode).toBe(0);
    expect(events.some((event) => event.type === 'stdout' && event.chunk?.includes(root))).toBe(true);
    expect(events.some((event) => event.type === 'stderr' && event.chunk?.includes('test-stderr'))).toBe(true);
  });

  it('can cancel an active command', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-terminal-'));
    temporaryRoots.push(root);
    const command = 'node -e "setTimeout(() => {}, 10000)"';
    const task = await startTerminalTask(root, command, () => undefined);
    task.cancel();
    const completed = await task.completion;
    expect(completed.type).toBe('cancelled');
  });

  it('rejects empty commands', () => {
    expect(() => validateTerminalCommand('   ')).toThrow(/vide/i);
  });

  it('detects installed shell profiles and executes a selected local profile', async () => {
    const profiles = await listTerminalProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual([
      'powershell',
      'cmd',
      'git-bash',
      'wsl',
      'ssh',
      'docker'
    ]);
    const selected = profiles.find((profile) => (
      profile.available && ['powershell', 'cmd', 'git-bash'].includes(profile.id)
    ));
    expect(selected).toBeDefined();
    if (process.platform === 'win32') {
      expect(selected?.detail).toContain('Job Object Windows');
      expect(selected?.detail).toContain('environnement sans secrets');
    }

    const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-terminal-'));
    temporaryRoots.push(root);
    const events: NeuraCoTerminalEvent[] = [];
    const command = selected!.id === 'cmd'
      ? 'echo selected-shell'
      : 'echo selected-shell';
    const task = await startTerminalTask(
      root,
      command,
      (event) => events.push(event),
      10_000,
      { terminalId: 'terminal-test', profileId: selected!.id }
    );
    const completed = await task.completion;
    const executionOutput = events
      .map((event) => event.chunk || event.message || '')
      .join('');
    expect(completed.exitCode, executionOutput).toBe(0);
    expect(events.some((event) => (
      event.type === 'stdout'
      && event.chunk?.includes('selected-shell')
      && event.terminalId === 'terminal-test'
      && event.profileId === selected!.id
    ))).toBe(true);
  }, 20_000);

  it('rejects malformed SSH and Docker targets before spawning', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-terminal-'));
    temporaryRoots.push(root);
    await expect(startTerminalTask(
      root,
      'echo blocked',
      () => undefined,
      10_000,
      { profileId: 'ssh', target: 'host; shutdown' }
    )).rejects.toThrow(/cible SSH/i);
    await expect(startTerminalTask(
      root,
      'echo blocked',
      () => undefined,
      10_000,
      { profileId: 'docker', target: '../container' }
    )).rejects.toThrow(/conteneur Docker/i);
  });

  it('does not expose inherited secret variables to a real child command', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-terminal-'));
    temporaryRoots.push(root);
    const previous = process.env.NEURACO_SANDBOX_PROBE_SECRET;
    process.env.NEURACO_SANDBOX_PROBE_SECRET = 'must-not-leak';
    const events: NeuraCoTerminalEvent[] = [];
    try {
      const command = process.platform === 'win32'
        ? 'if defined NEURACO_SANDBOX_PROBE_SECRET (echo leaked) else (echo %NEURACO_SANDBOX%)'
        : 'if [ -n "$NEURACO_SANDBOX_PROBE_SECRET" ]; then echo leaked; else echo "$NEURACO_SANDBOX"; fi';
      const task = await startTerminalTask(
        root,
        command,
        (event) => events.push(event)
      );
      const completed = await task.completion;
      const executionOutput = events
        .map((event) => event.chunk || event.message || '')
        .join('');
      expect(completed.exitCode, executionOutput).toBe(0);
      const output = events
        .filter((event) => event.type === 'stdout')
        .map((event) => event.chunk || '')
        .join('');
      expect(output).toContain('1');
      expect(output).not.toContain('must-not-leak');
    } finally {
      if (previous === undefined) delete process.env.NEURACO_SANDBOX_PROBE_SECRET;
      else process.env.NEURACO_SANDBOX_PROBE_SECRET = previous;
    }
  });
});
