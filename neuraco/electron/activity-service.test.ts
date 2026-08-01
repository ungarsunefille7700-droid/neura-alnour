import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityService } from './activity-service';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('ActivityService', () => {
  it('redacts secrets and builds a concrete task report', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-activity-'));
    directories.push(directory);
    const service = new ActivityService(directory);

    await service.append({
      taskId: 'task-1',
      projectId: 'project-1',
      category: 'agent',
      action: 'task_started',
      status: 'started',
      summary: 'Corriger le module sans exposer sk-secret-never-log-this',
      details: {
        agent: 'Développeur',
        apiKey: 'sk-secret-never-log-this',
        fileRead: 'src/App.tsx'
      }
    });
    await service.append({
      taskId: 'task-1',
      projectId: 'project-1',
      category: 'test',
      action: 'tests_completed',
      status: 'completed',
      summary: 'Tests réussis',
      details: {
        command: 'npm test',
        fileModified: 'src/App.tsx',
        filesCreated: ['src/NewPanel.tsx'],
        applications: ['Visual Studio Code'],
        creditsConsumed: 1.25
      },
      evidence: {
        id: 'evidence-test-1',
        source: 'machine',
        kind: 'test_result',
        status: 'passed',
        title: 'Suite Vitest',
        summary: 'La suite s’est terminée sans erreur.',
        capturedAt: '2026-07-28T12:00:00.000Z',
        command: 'npm test',
        exitCode: 0,
        durationMs: 1250,
        output: '136 tests passed'
      }
    });
    await service.append({
      taskId: 'task-1',
      projectId: 'project-1',
      category: 'agent',
      action: 'agent_claim',
      status: 'completed',
      summary: 'Je confirme que tout fonctionne.',
      details: { message: 'Simple affirmation textuelle.' },
      evidence: {
        id: 'evidence-fake-1',
        source: 'agent',
        kind: 'test_result',
        status: 'passed',
        title: 'Affirmation',
        summary: 'Aucun résultat machine.',
        capturedAt: '2026-07-28T12:00:00.000Z'
      } as never
    });

    const entries = await service.list();
    expect(entries[0].details?.apiKey).toBe('[MASQUÉ]');
    expect(entries[0].summary).not.toContain('sk-secret-never-log-this');
    expect(entries[0]).toMatchObject({
      sequence: 1,
      previousHash: 'GENESIS'
    });
    expect(entries[0].entryHash).toMatch(/^[a-f0-9]{64}$/);

    const report = await service.buildReport('task-1');
    expect(report.objective).not.toContain('sk-secret-never-log-this');
    expect(report.filesRead).toContain('src/App.tsx');
    expect(report.filesModified).toContain('src/App.tsx');
    expect(report.filesCreated).toContain('src/NewPanel.tsx');
    expect(report.applications).toContain('Visual Studio Code');
    expect(report.commands).toContain('npm test');
    expect(report.creditsConsumed).toBe(1.25);
    expect(report.evidence).toHaveLength(1);
    expect(report.evidence[0]).toMatchObject({
      source: 'machine',
      kind: 'test_result',
      exitCode: 0,
      output: '136 tests passed'
    });
    expect(report.integrity).toMatchObject({
      verified: true,
      chainedEntries: 3,
      legacyEntries: 0,
      invalidEntryIds: []
    });
    expect(await service.findEvidence('evidence-test-1')).toMatchObject({
      title: 'Suite Vitest'
    });
    expect(await service.findEvidence('evidence-fake-1')).toBeNull();
    const markdown = service.formatMarkdown(report);
    expect(markdown).toContain('# Rapport NeuraCo');
    expect(markdown).toContain('## Preuves de fonctionnement');
    expect(markdown).toContain('136 tests passed');
  });

  it('serializes concurrent writes into a valid hash chain', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-activity-'));
    directories.push(directory);
    const service = new ActivityService(directory);

    await Promise.all(Array.from({ length: 25 }, (_, index) => service.append({
      taskId: `task-${index % 2}`,
      category: 'test',
      action: 'concurrent_event',
      status: 'completed',
      summary: `Événement ${index}`
    })));

    const entries = await service.list();
    expect(entries).toHaveLength(25);
    expect(entries.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1)
    );
    const filtered = await service.buildReport('task-0');
    expect(filtered.events).toHaveLength(13);
    expect(filtered.integrity?.verified).toBe(true);
    expect(filtered.integrity?.chainedEntries).toBe(25);
  });

  it('detects a modified audit entry', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-activity-'));
    directories.push(directory);
    const service = new ActivityService(directory);
    await service.append({
      category: 'connection',
      action: 'login',
      status: 'completed',
      summary: 'Connexion établie'
    });
    await service.append({
      category: 'plugin',
      action: 'extension_installed',
      status: 'completed',
      summary: 'Extension installée'
    });

    const logPath = path.join(directory, 'activity.jsonl');
    const lines = (await readFile(logPath, 'utf8')).trim().split(/\r?\n/);
    const tampered = JSON.parse(lines[0]) as Record<string, unknown>;
    tampered.summary = 'Entrée falsifiée';
    lines[0] = JSON.stringify(tampered);
    await writeFile(logPath, `${lines.join('\n')}\n`, 'utf8');

    const report = await new ActivityService(directory).buildReport();
    expect(report.integrity?.verified).toBe(false);
    expect(report.integrity?.invalidEntryIds).toContain(tampered.id);
  });
});
