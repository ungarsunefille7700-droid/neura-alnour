import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMaxExportScript,
  buildMaxInspectScript,
  parseFiveMManifest,
  StudioService,
  validateStudioProjectPath
} from './studio-service';

const temporaryDirectories: string[] = [];

const createFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-studio-'));
  temporaryDirectories.push(root);
  const resource = path.join(root, 'resources', 'demo');
  await mkdir(path.join(resource, 'client'), { recursive: true });
  await writeFile(path.join(resource, 'client', 'main.lua'), 'print("ready")\n', 'utf8');
  await writeFile(path.join(resource, 'fxmanifest.lua'), `
fx_version 'cerulean'
game 'gta5'
client_scripts {
  'client/main.lua',
  'client/missing.lua'
}
dependency 'ox_lib'
`, 'utf8');
  await writeFile(path.join(root, 'vehicle.blend'), 'fixture', 'utf8');
  await writeFile(path.join(root, 'scene.max'), 'fixture', 'utf8');
  return {
    root,
    project: { id: 'project-1', name: 'Studio fixture', rootPath: root }
  };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('NeuraCo structured studio integrations', () => {
  it('parses a FiveM manifest without executing it and reports missing files', async () => {
    const { root } = await createFixture();
    const manifest = await parseFiveMManifest(root, 'resources/demo/fxmanifest.lua');
    expect(manifest.fxVersion).toBe('cerulean');
    expect(manifest.games).toContain('gta5');
    expect(manifest.scripts).toContain('client/main.lua');
    expect(manifest.dependencies).toContain('ox_lib');
    expect(manifest.missingFiles).toEqual(['client/missing.lua']);
  });

  it('analyzes FiveM, Blender and 3ds Max files in one bounded project scan', async () => {
    const { root, project } = await createFixture();
    const programFiles = path.join(root, 'Program Files');
    const localAppData = path.join(root, 'Local');
    const blender = path.join(
      programFiles,
      'Blender Foundation',
      'Blender 5.1',
      'blender.exe'
    );
    const max3d = path.join(programFiles, 'Autodesk', '3ds Max 2027', '3dsmax.exe');
    const fiveM = path.join(localAppData, 'FiveM', 'FiveM.app', 'FiveM.exe');
    await Promise.all([
      mkdir(path.dirname(blender), { recursive: true }),
      mkdir(path.dirname(max3d), { recursive: true }),
      mkdir(path.dirname(fiveM), { recursive: true })
    ]);
    await Promise.all([
      writeFile(blender, ''),
      writeFile(max3d, ''),
      writeFile(fiveM, '')
    ]);
    const service = new StudioService({
      storageDirectory: path.join(root, 'studio-data'),
      environment: {
        ProgramFiles: programFiles,
        LOCALAPPDATA: localAppData
      }
    });
    const analysis = await service.analyze(project);
    expect(analysis.fiveM.detected).toBe(true);
    expect(analysis.blender.files).toEqual(['vehicle.blend']);
    expect(analysis.max3d.files).toEqual(['scene.max']);
    expect(analysis.tools.every((tool) => tool.installed)).toBe(true);
    expect(analysis.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        tool: 'fivem',
        message: expect.stringContaining('client/missing.lua')
      })
    ]));
  });

  it('confines every DCC target and output to the active project', async () => {
    const { root, project } = await createFixture();
    expect(validateStudioProjectPath(project, 'vehicle.blend'))
      .toBe(path.join(root, 'vehicle.blend'));
    expect(validateStudioProjectPath(project, 'exports/vehicle.glb', true))
      .toBe(path.join(root, 'exports', 'vehicle.glb'));
    expect(() => validateStudioProjectPath(project, path.join(root, '..', 'outside.max')))
      .toThrow(/hors du projet/i);
  });

  it('runs the FiveM validation operation and returns a concrete report', async () => {
    const { root, project } = await createFixture();
    const service = new StudioService({
      storageDirectory: path.join(root, 'studio-data')
    });
    const events: string[] = [];
    const result = await service.run(
      project,
      { operation: 'fivem_validate', taskId: 'fivem-test' },
      (event) => events.push(event.type)
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('1 ressource');
    expect(result.output).toContain('client/missing.lua');
    expect(events).toEqual(['started', 'failed']);
  });

  it('generates fixed MAXScript with escaped project paths and explicit shutdown', () => {
    const inspect = buildMaxInspectScript(
      'C:\\project\\scene "safe".max',
      'C:\\reports\\scene.txt'
    );
    const exportScript = buildMaxExportScript(
      'C:\\project\\scene.max',
      'C:\\project\\exports\\scene.fbx',
      'C:\\reports\\export.txt'
    );
    expect(inspect).toContain('loadMaxFile');
    expect(inspect).toContain('scene \\"safe\\".max');
    expect(inspect).toContain('quitMAX #noPrompt');
    expect(exportScript).toContain('exportFile');
    expect(exportScript).toContain('using:FBXEXP');
    expect(exportScript).toContain('quitMAX #noPrompt');
  });
});
