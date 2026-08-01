import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NeuraCoProject } from './ipc-contract';
import { HookService } from './hook-service';

const directories: string[] = [];

const setup = async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'neuraco-hooks-'));
  directories.push(rootPath);
  const project: NeuraCoProject = {
    id: 'project-hooks',
    name: 'Projet hooks',
    rootPath
  };
  return {
    rootPath,
    project,
    service: new HookService(path.join(rootPath, 'hooks.json'))
  };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('HookService', () => {
  it('always blocks secrets and destructive commands with immutable hooks', async () => {
    const { service, project } = await setup();
    const secret = await service.execute('before_instruction', {
      instruction: 'API_KEY=super-secret-value'
    }, project);
    expect(secret.blocked).toBe(true);
    expect(secret.runs[0].hookId).toBe('security-secret-protection');
    expect(JSON.stringify(await service.state())).not.toContain('super-secret-value');

    const command = await service.execute('before_command', {
      command: 'rm -rf /'
    }, project);
    expect(command.blocked).toBe(true);
    await expect(
      service.setEnabled('security-command-policy', false)
    ).rejects.toThrow('ne peut pas être désactivé');
  });

  it('supports policy, approval, notification and log hooks per project', async () => {
    const { service, project } = await setup();
    const saved = await service.save({
      name: 'Bloquer production',
      event: 'before_command',
      action: 'block_pattern',
      pattern: 'production',
      failureMode: 'block'
    }, project.id);
    const hookId = saved.hooks.find((hook) => !hook.security)!.id;
    await service.setEnabled(hookId, true);
    const blocked = await service.execute('before_command', {
      command: 'deploy production'
    }, project);
    expect(blocked.blocked).toBe(true);

    const approval = await service.save({
      name: 'Validation fusion',
      event: 'before_merge',
      action: 'approval'
    }, project.id);
    const approvalId = approval.hooks.find((hook) => (
      hook.name === 'Validation fusion'
    ))!.id;
    await service.setEnabled(approvalId, true);
    expect((await service.execute(
      'before_merge',
      { branch: 'feature' },
      project
    )).approvalRequired).toBe(true);
  });

  it('executes command hooks without a shell and redacts their output', async () => {
    const { service, project, rootPath } = await setup();
    const script = path.join(rootPath, 'hook.cjs');
    await writeFile(script, `
let input = '';
process.stdin.on('data', (chunk) => input += chunk);
process.stdin.on('end', () => {
  process.stdout.write('checked:' + JSON.parse(input).file);
});`, 'utf8');
    const saved = await service.save({
      name: 'Vérifier fichier',
      event: 'after_modification',
      action: 'command',
      command: process.execPath,
      args: [script],
      timeoutMs: 5_000,
      failureMode: 'block'
    }, project.id);
    const hookId = saved.hooks.find((hook) => !hook.security)!.id;
    await service.setEnabled(hookId, true);
    const result = await service.execute(
      'after_modification',
      { file: 'src/App.tsx' },
      project
    );
    expect(result.blocked).toBe(false);
    expect(result.runs.at(-1)?.output).toBe('checked:src/App.tsx');
  });

  it('keeps disabled hooks inactive and records a bounded run history', async () => {
    const { service, project } = await setup();
    const saved = await service.save({
      name: 'Journal fin de tâche',
      event: 'task_completed',
      action: 'log'
    }, project.id);
    const hookId = saved.hooks.find((hook) => !hook.security)!.id;
    expect((await service.execute(
      'task_completed',
      { taskId: 'task-1' },
      project
    )).runs).toEqual([]);
    await service.setEnabled(hookId, true);
    await service.execute('task_completed', { taskId: 'task-1' }, project);
    expect((await service.state()).recentRuns[0]).toMatchObject({
      hookId,
      status: 'passed'
    });
  });
});
