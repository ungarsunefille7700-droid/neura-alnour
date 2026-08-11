import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApplicationService, validateApplicationTarget } from './application-service';

const project = {
  id: 'project-1',
  name: 'Demo',
  rootPath: path.resolve('C:\\projects\\demo')
};

describe('NeuraCo application allowlist', () => {
  it('allows only targets located in the active project', () => {
    const inside = path.join(project.rootPath, 'src', 'App.tsx');
    expect(validateApplicationTarget(project, inside)).toBe(path.resolve(inside));
    expect(validateApplicationTarget(project)).toBeUndefined();
  });

  it('rejects a target outside the active project', () => {
    expect(() => validateApplicationTarget(
      project,
      path.resolve('C:\\projects\\other\\secret.txt')
    )).toThrow(/hors du projet/i);
  });

  it('detects the standalone FiveM launcher installation', async () => {
    const localAppData = await mkdtemp(path.join(os.tmpdir(), 'neuraco-fivem-detect-'));
    const previousLocalAppData = process.env.LOCALAPPDATA;
    try {
      const executable = path.join(localAppData, 'FiveM', 'FiveM.exe');
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, 'launcher');
      process.env.LOCALAPPDATA = localAppData;

      const service = new ApplicationService({
        storageDirectory: path.join(localAppData, 'NeuraCo')
      });
      const fiveM = (await service.list()).find((application) => application.id === 'fivem');

      expect(fiveM).toMatchObject({
        installed: true,
        executable
      });
    } finally {
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
      await rm(localAppData, { recursive: true, force: true });
    }
  });
});
