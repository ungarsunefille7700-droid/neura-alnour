import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalSessionStore } from './session-service';

const temporaryDirectories: string[] = [];
const project = {
  id: 'project-session-test',
  name: 'Projet test',
  rootPath: 'C:\\Projet'
};

const createStore = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-session-'));
  temporaryDirectories.push(directory);
  const storePath = path.join(directory, 'sessions.json');
  return {
    store: new LocalSessionStore(storePath),
    storePath
  };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('LocalSessionStore', () => {
  it('sauvegarde et restaure une session de projet sans pixels d’images', async () => {
    const { store, storePath } = await createStore();
    await store.save(project, {
      sessionId: 'session_12345678',
      executionMode: 'cloud',
      cloudTaskId: 'task_12345678',
      messages: [{
        id: 'message-1',
        role: 'user',
        content: 'Analyse ce projet',
        files: ['src/main.ts']
      }]
    });

    await expect(store.get(project)).resolves.toMatchObject({
      projectId: project.id,
      sessionId: 'session_12345678',
      executionMode: 'cloud',
      cloudTaskId: 'task_12345678',
      messages: [{
        role: 'user',
        content: 'Analyse ce projet',
        files: ['src/main.ts']
      }]
    });
    expect(await readFile(storePath, 'utf8')).not.toContain('data:image');
  });

  it('écrit atomiquement, limite l’historique et peut le supprimer', async () => {
    const { store } = await createStore();
    await store.save(project, {
      executionMode: 'local',
      messages: Array.from({ length: 230 }, (_, index) => ({
        id: `message-${index}`,
        role: 'assistant' as const,
        content: `Réponse ${index}`
      }))
    });

    const restored = await store.get(project);
    expect(restored?.messages).toHaveLength(200);
    expect(restored?.messages[0].content).toBe('Réponse 30');
    await expect(store.clear(project)).resolves.toBe(true);
    await expect(store.get(project)).resolves.toBeNull();
  });

  it('compresse les gros historiques et les relit sans perte', async () => {
    const { store, storePath } = await createStore();
    await store.save(project, {
      executionMode: 'local',
      messages: Array.from({ length: 200 }, (_, index) => ({
        id: `large-message-${index}`,
        role: 'assistant' as const,
        content: `Bloc ${index} ${'contenu répétitif '.repeat(220)}`
      }))
    });

    const payload = await readFile(storePath);
    expect([...payload.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
    const restored = await new LocalSessionStore(storePath).get(project);
    expect(restored?.messages).toHaveLength(200);
    expect(restored?.messages.at(-1)?.content).toContain('Bloc 199');
  });

  it('récupère proprement un fichier corrompu', async () => {
    const { store, storePath } = await createStore();
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, '{cassé', 'utf8');
    await expect(store.get(project)).resolves.toBeNull();
  });

  it('gère plusieurs fils persistants, leur renommage et leur archivage', async () => {
    const { store } = await createStore();
    await store.save(project, {
      executionMode: 'local',
      messages: [{
        id: 'main-message',
        role: 'assistant',
        content: 'Solution principale.'
      }]
    });
    const alternative = await store.create(project, {
      title: 'Autre piste',
      fromThreadId: `main_${project.id}`,
      fromMessageId: 'main-message'
    });
    expect(alternative.parentThreadId).toBe(`main_${project.id}`);
    expect(alternative.messages).toHaveLength(1);

    const renamed = await store.rename(project, alternative.threadId, 'Alternative API');
    expect(renamed.title).toBe('Alternative API');
    expect((await store.list(project)).map((thread) => thread.title)).toContain(
      'Alternative API'
    );

    const archived = await store.archive(project, alternative.threadId, true);
    expect(archived.find((thread) => thread.threadId === alternative.threadId))
      .toMatchObject({ archived: true, active: false });
    expect((await store.list(project)).some(
      (thread) => thread.threadId === alternative.threadId
    )).toBe(false);
  });

  it('bifurque, revient à un message et efface uniquement la mémoire ciblée', async () => {
    const { store } = await createStore();
    const saved = await store.save(project, {
      executionMode: 'hybrid',
      sessionId: 'session_originale',
      cloudTaskId: 'cloud_originale',
      messages: [
        { id: 'step-1', role: 'user', content: 'Première étape' },
        { id: 'step-2', role: 'assistant', content: 'Deuxième étape' },
        { id: 'step-3', role: 'user', content: 'Troisième étape' }
      ]
    });
    const branch = await store.fork(project, saved.threadId, 'step-2');
    expect(branch.messages.map((message) => message.id)).toEqual(['step-1', 'step-2']);
    expect(branch.sessionId).toBeUndefined();

    await store.save(project, {
      threadId: branch.threadId,
      executionMode: 'local',
      messages: [
        ...branch.messages,
        { id: 'branch-step', role: 'assistant', content: 'Autre solution' }
      ]
    });
    const rewound = await store.rewind(project, branch.threadId, 'step-1');
    expect(rewound.messages).toHaveLength(1);
    expect(rewound.sessionId).toBeUndefined();

    const cleared = await store.clearMemory(project, branch.threadId);
    expect(cleared.messages).toEqual([]);
    const original = await store.select(project, saved.threadId);
    expect(original.messages).toHaveLength(3);
  });

  it('exporte le fil en Markdown sans révéler de secret', async () => {
    const { store } = await createStore();
    const saved = await store.save(project, {
      executionMode: 'local',
      messages: [{
        id: 'secret-message',
        role: 'user',
        content: 'API_KEY=very-secret-value et sk-test_12345678901234567890'
      }]
    });
    await store.attachCheckpoint(project, saved.threadId, 'checkpoint_12345678');
    const markdown = await store.exportMarkdown(project, saved.threadId);
    expect(markdown).toContain('# Fil principal');
    expect(markdown).toContain('checkpoint_12345678');
    expect(markdown).toContain('[MASQUÉ]');
    expect(markdown).not.toContain('very-secret-value');
    expect(markdown).not.toContain('sk-test_12345678901234567890');
  });

  it('restaure une conversation et ses réglages de tâche de façon sélective', async () => {
    const { store } = await createStore();
    const original = await store.save(project, {
      executionMode: 'local',
      taskSettings: {
        taskMode: 'code',
        effort: 'deep',
        communicationStyle: 'detailed',
        executionMode: 'local',
        includeActiveFile: true
      },
      messages: [{
        id: 'before-checkpoint',
        role: 'user',
        content: 'État sauvegardé'
      }]
    });
    await store.save(project, {
      executionMode: 'cloud',
      taskSettings: {
        taskMode: 'research',
        effort: 'rapid',
        communicationStyle: 'direct',
        executionMode: 'cloud',
        includeActiveFile: false
      },
      messages: [{
        id: 'after-checkpoint',
        role: 'assistant',
        content: 'État récent'
      }]
    });

    const conversationOnly = await store.restoreSnapshot(project, original, false);
    expect(conversationOnly.messages[0].id).toBe('before-checkpoint');
    expect(conversationOnly.taskSettings?.taskMode).toBe('research');

    const complete = await store.restoreSnapshot(project, original, true);
    expect(complete.taskSettings).toMatchObject({
      taskMode: 'code',
      effort: 'deep',
      communicationStyle: 'detailed'
    });
  });

  it('migre sans perte le format de session version 1', async () => {
    const { store, storePath } = await createStore();
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify({
      version: 1,
      sessions: {
        [project.id]: {
          projectId: project.id,
          projectName: project.name,
          executionMode: 'local',
          messages: [{
            id: 'legacy-message',
            role: 'assistant',
            content: 'Ancienne session conservée.'
          }],
          updatedAt: '2026-07-26T00:00:00.000Z'
        }
      }
    }), 'utf8');
    const migrated = await store.get(project);
    expect(migrated?.threadId).toBe(`main_${project.id}`);
    expect(migrated?.messages[0].content).toBe('Ancienne session conservée.');
  });
});
