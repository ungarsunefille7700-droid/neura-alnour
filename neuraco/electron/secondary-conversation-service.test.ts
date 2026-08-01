import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecondaryConversationService } from './secondary-conversation-service';

describe('SecondaryConversationService', () => {
  let directory: string;
  let storePath: string;
  let service: SecondaryConversationService;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-secondary-'));
    storePath = path.join(directory, 'secondary.json');
    service = new SecondaryConversationService(storePath);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('persists a secondary conversation linked to the main thread and task', async () => {
    const created = await service.create('project-1', {
      parentThreadId: 'thread_main_12345678',
      linkedTaskId: 'task_12345678',
      title: 'Examiner la solution'
    });
    await service.append('project-1', created.id, {
      id: 'message_user_12345678',
      role: 'user',
      content: 'Pourquoi cette architecture ?'
    });
    const answered = await service.append('project-1', created.id, {
      id: 'message_agent_12345678',
      role: 'assistant',
      content: 'Elle isole la mission principale.',
      model: 'Claude Sonnet 4.5 · anthropic'
    });

    expect(answered.parentThreadId).toBe('thread_main_12345678');
    expect(answered.linkedTaskId).toBe('task_12345678');
    expect(answered.messages).toHaveLength(2);
    expect((await service.list('project-1'))[0].id).toBe(created.id);
  });

  it('redacts secrets and archives only the targeted secondary conversation', async () => {
    const first = await service.create('project-1', {
      parentThreadId: 'thread_main_12345678'
    });
    const second = await service.create('project-1', {
      parentThreadId: 'thread_main_12345678'
    });
    await service.append('project-1', first.id, {
      id: 'message_secret_12345678',
      role: 'user',
      content: 'Token ghp_abcdefghijklmnopqrstuvwxyz1234567890'
    });
    const visible = await service.archive('project-1', first.id);

    expect(visible.map((conversation) => conversation.id)).toEqual([second.id]);
    expect(await service.list('project-1', undefined, true)).toHaveLength(2);
    expect(await readFile(storePath, 'utf8')).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz1234567890'
    );
  });
});
