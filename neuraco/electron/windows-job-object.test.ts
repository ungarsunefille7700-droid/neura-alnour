// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NeuraCoTerminalEvent } from './ipc-contract';
import { startTerminalTask } from './terminal-service';
import { wrapWithWindowsJobObject } from './windows-job-object';

describe('NeuraCo Windows Job Object boundary', () => {
  it('wraps Windows commands without exposing their raw arguments in the process list', () => {
    const wrapped = wrapWithWindowsJobObject(
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/c', 'echo isolated'],
      { SystemRoot: 'C:\\Windows', PATH: 'safe' }
    );
    if (process.platform !== 'win32') {
      expect(wrapped.executable).toBe('C:\\Windows\\System32\\cmd.exe');
      return;
    }
    expect(wrapped.executable).toMatch(/powershell\.exe$/i);
    expect(wrapped.args).toContain('-EncodedCommand');
    expect(wrapped.args.join(' ')).not.toContain('echo isolated');
    expect(wrapped.environment.NEURACO_JOB_ARGUMENTS_BASE64).toBeTruthy();
  });

  it.skipIf(process.platform !== 'win32')(
    'kills a descendant automatically when the guarded shell exits',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-job-object-'));
      const events: NeuraCoTerminalEvent[] = [];
      let descendantPid = 0;
      try {
        const task = await startTerminalTask(
          root,
          '$p=Start-Process -FilePath "$env:SystemRoot\\System32\\cmd.exe" '
            + "-ArgumentList '/d','/c','ping 127.0.0.1 -n 30 >nul' -PassThru; "
            + 'Write-Output "DESCENDANT:$($p.Id)"',
          (event) => events.push(event),
          15_000,
          { profileId: 'powershell' }
        );
        const completed = await task.completion;
        const output = events.map((event) => event.chunk || '').join('');
        expect(completed.exitCode, output).toBe(0);
        descendantPid = Number(/DESCENDANT:(\d+)/.exec(output)?.[1] || 0);
        expect(descendantPid).toBeGreaterThan(0);
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(() => process.kill(descendantPid, 0)).toThrow();
      } finally {
        if (descendantPid > 0) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {
            // Expected: the Job Object already terminated the descendant.
          }
        }
        await rm(root, { recursive: true, force: true });
      }
    },
    20_000
  );
});
