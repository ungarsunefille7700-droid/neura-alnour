import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NeuraCoProject } from './ipc-contract';
import {
  HostedSiteService,
  type HostedSiteCommandRunner
} from './hosted-site-service';

const directories: string[] = [];
const services: HostedSiteService[] = [];

const setup = async (runCommand?: HostedSiteCommandRunner) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-sites-'));
  directories.push(directory);
  const projectRoot = path.join(directory, 'project');
  await mkdir(path.join(projectRoot, 'dist', 'assets'), { recursive: true });
  await writeFile(
    path.join(projectRoot, 'dist', 'index.html'),
    '<!doctype html><html><body><h1>NeuraCo Site</h1><script src="/assets/app.js"></script></body></html>',
    'utf8'
  );
  await writeFile(
    path.join(projectRoot, 'dist', 'assets', 'app.js'),
    'document.body.dataset.ready = "true";',
    'utf8'
  );
  await writeFile(path.join(projectRoot, 'dist', '.env'), 'API_KEY=secret', 'utf8');
  const service = new HostedSiteService({
    storePath: path.join(directory, 'sites.json'),
    storageDirectory: path.join(directory, 'hosted-sites'),
    runCommand
  });
  services.push(service);
  const project: NeuraCoProject = {
    id: '0123456789abcdef01234567',
    name: 'Projet sites',
    rootPath: projectRoot
  };
  return { directory, project, projectRoot, service };
};

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAllPreviews()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe('HostedSiteService', () => {
  it('lists the exact publishable files without exposing environment files', async () => {
    const { project, service } = await setup();
    const preview = await service.preview(project, {
      name: 'Tableau de bord équipe',
      kind: 'dashboard',
      sourceDirectory: 'dist',
      visibility: 'public',
      environmentVariables: ['PUBLIC_API_URL'],
      authorizedPeople: [],
      hostingDurationDays: 30
    });

    expect(preview).toMatchObject({
      projectId: project.id,
      slug: 'tableau-de-bord-equipe',
      provider: 'vercel',
      framework: 'Site statique',
      plannedAddress: 'https://tableau-de-bord-equipe.vercel.app',
      plannedAddressIsEstimate: true,
      estimatedCredits: 0,
      authorizedPeople: ['Tout le monde (site public)']
    });
    expect(preview.files.map((file) => file.relativePath)).toEqual([
      'assets/app.js',
      'index.html'
    ]);
    expect(JSON.stringify(preview)).not.toContain('API_KEY=secret');
  });

  it('serves a real loopback-only static preview and supports SPA fallback', async () => {
    const { project, service } = await setup();
    const preview = await service.preview(project, {
      name: 'Application légère',
      kind: 'web_app',
      sourceDirectory: 'dist',
      visibility: 'local',
      environmentVariables: [],
      authorizedPeople: []
    });
    const session = await service.startPreview(preview.id);
    expect(session.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const home = await fetch(session.address);
    expect(home.status).toBe(200);
    expect(home.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await home.text()).toContain('NeuraCo Site');

    const asset = await fetch(new URL('/assets/app.js', session.address));
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('dataset.ready');

    const spa = await fetch(new URL('/revision/chapitre-1', session.address));
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('NeuraCo Site');
    expect(await service.stopPreview(preview.id)).toBe(true);
  });

  it('requires explicit public confirmation and deploys only the previewed files', async () => {
    const command = vi.fn<HostedSiteCommandRunner>(async (_executable, args, cwd) => {
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: 'Vercel CLI 54.15.0\n54.15.0', stderr: '' };
      }
      expect(args).toEqual([
        'deploy',
        cwd,
        '--yes',
        '--prod',
        '--name',
        'galerie-neuraco'
      ]);
      expect(await readFile(path.join(cwd, 'index.html'), 'utf8')).toContain('NeuraCo Site');
      await expect(readFile(path.join(cwd, '.env'), 'utf8')).rejects.toThrow();
      return {
        exitCode: 0,
        stdout: 'Production: https://galerie-neuraco-abc.vercel.app',
        stderr: ''
      };
    });
    const { directory, project, service } = await setup(command);
    const preview = await service.preview(project, {
      name: 'Galerie NeuraCo',
      kind: 'gallery',
      sourceDirectory: 'dist',
      visibility: 'public',
      environmentVariables: [],
      authorizedPeople: []
    });

    await expect(service.deploy(project.id, preview.id, false)).rejects.toThrow(
      'confirmation explicite'
    );
    const deployment = await service.deploy(project.id, preview.id, true);
    expect(deployment).toMatchObject({
      projectId: project.id,
      address: 'https://galerie-neuraco-abc.vercel.app',
      visibility: 'public',
      provider: 'vercel'
    });
    expect(await service.list(project.id)).toEqual([
      expect.objectContaining({ id: deployment.id })
    ]);
    expect(await readFile(path.join(directory, 'sites.json'), 'utf8'))
      .toContain('galerie-neuraco-abc.vercel.app');
  });

  it('blocks deployment when files changed after the reviewed preview', async () => {
    const command = vi.fn<HostedSiteCommandRunner>(async () => ({
      exitCode: 0,
      stdout: '54.15.0',
      stderr: ''
    }));
    const { project, projectRoot, service } = await setup(command);
    const preview = await service.preview(project, {
      name: 'Site protégé',
      kind: 'site',
      sourceDirectory: 'dist',
      visibility: 'public',
      environmentVariables: [],
      authorizedPeople: []
    });
    await writeFile(
      path.join(projectRoot, 'dist', 'index.html'),
      '<!doctype html><html><body>Version modifiée</body></html>',
      'utf8'
    );

    await expect(service.deploy(project.id, preview.id, true)).rejects.toThrow(
      'Les fichiers ont changé'
    );
    expect(command).not.toHaveBeenCalled();
  });
});
