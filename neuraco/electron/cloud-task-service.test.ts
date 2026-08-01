import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('./auth-service', () => ({
  authenticatedApiRequest: requestMock
}));

import {
  cancelCloudTask,
  createCloudTask,
  getCloudTask,
  listCloudTasks
} from './cloud-task-service';

const apiTask = {
  id: 'task_12345678',
  session_id: 'session_12345678',
  project_id: 'project_12345678',
  project_name: 'Projet test',
  execution_mode: 'cloud' as const,
  local_access: false as const,
  status: 'running' as const,
  estimated_credits: 1.25,
  created_at: '2026-07-26T10:00:00.000Z',
  updated_at: '2026-07-26T10:00:01.000Z'
};

beforeEach(() => requestMock.mockReset());

describe('cloud-task-service', () => {
  it('crée une tâche distante avec seulement les fichiers explicitement fournis', async () => {
    requestMock.mockResolvedValue(apiTask);
    const task = await createCloudTask({
      content: 'Analyse le fichier',
      projectId: 'project_12345678',
      projectName: 'Projet test',
      mode: 'plan',
      conversationContext: [{
        id: 'message-1',
        role: 'user',
        content: 'TOKEN=cloud-secret-value'
      }],
      files: [{ path: 'src/main.ts', content: 'export {}' }]
    });

    expect(task).toMatchObject({
      id: apiTask.id,
      executionMode: 'cloud',
      localAccess: false,
      estimatedCredits: 1.25
    });
    const body = JSON.parse(requestMock.mock.calls[0][1].body);
    expect(body.files).toEqual([{ path: 'src/main.ts', content: 'export {}' }]);
    expect(body.conversation_context).toEqual([{
      role: 'user',
      content: 'TOKEN=[MASQUÉ]'
    }]);
    expect(JSON.stringify(body)).not.toContain('cloud-secret-value');
    expect(body).not.toHaveProperty('images');
  });

  it('liste, consulte et annule les tâches avec des routes sûres', async () => {
    requestMock.mockResolvedValueOnce([apiTask]);
    await expect(listCloudTasks('project_12345678', 500)).resolves.toHaveLength(1);
    expect(requestMock.mock.calls[0][0]).toContain('limit=200');

    requestMock.mockResolvedValueOnce(apiTask);
    await expect(getCloudTask(apiTask.id)).resolves.toMatchObject({ status: 'running' });

    requestMock.mockResolvedValueOnce({ ...apiTask, status: 'cancelled' });
    await expect(cancelCloudTask(apiTask.id)).resolves.toMatchObject({ status: 'cancelled' });
    expect(requestMock.mock.calls[2][1]).toEqual({ method: 'POST' });
  });

  it('refuse un identifiant de tâche invalide avant toute requête', async () => {
    await expect(getCloudTask('../secret')).rejects.toThrow('invalide');
    expect(requestMock).not.toHaveBeenCalled();
  });
});
