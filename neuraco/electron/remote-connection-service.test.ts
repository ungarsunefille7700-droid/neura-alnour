import { describe, expect, it, vi } from 'vitest';
import {
  parseSshConfig,
  RemoteConnectionService
} from './remote-connection-service';

describe('RemoteConnectionService', () => {
  it('detects explicit SSH hosts without reading private key contents', () => {
    const hosts = parseSshConfig(`
      Host production
        HostName prod.example.com
        User deploy
        Port 2222
        IdentityFile ~/.ssh/id_ed25519
      Host *
        ServerAliveInterval 30
    `);
    expect(hosts).toEqual([{
      id: 'production',
      alias: 'production',
      hostname: 'prod.example.com',
      user: 'deploy',
      port: 2222,
      identityFiles: [expect.stringContaining('.ssh')]
    }]);
  });

  it('uses argument arrays for WSL and Docker operations', async () => {
    const runner = vi.fn(async (
      command: string,
      args: string[]
    ) => ({
      exitCode: 0,
      stdout: `${command} ${args.join(' ')}`,
      stderr: '',
      durationMs: 2
    }));
    const service = new RemoteConnectionService(runner);

    const wsl = await service.run({
      kind: 'wsl2',
      action: 'list_files',
      target: 'Ubuntu',
      path: '/workspace'
    });
    const docker = await service.run({
      kind: 'docker',
      action: 'logs',
      target: 'neuraco-dev'
    });

    expect(wsl.ok).toBe(true);
    expect(runner).toHaveBeenCalledWith(
      'wsl.exe',
      expect.arrayContaining(['--distribution', 'Ubuntu', '--']),
      120_000
    );
    expect(docker.stdout).toContain('docker logs --tail 300 neuraco-dev');
  });

  it('rejects malformed targets and unsafe paths before execution', async () => {
    const runner = vi.fn();
    const service = new RemoteConnectionService(runner);

    await expect(service.run({
      kind: 'ssh',
      action: 'connect',
      target: 'host;shutdown'
    })).rejects.toThrow(/Hôte SSH invalide/);
    await expect(service.run({
      kind: 'docker',
      action: 'read_file',
      target: '../container',
      path: '/app'
    })).rejects.toThrow(/Conteneur Docker invalide/);
    expect(runner).not.toHaveBeenCalled();
  });
});
