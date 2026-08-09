import { randomUUID } from 'node:crypto';
import { authenticatedApiRequest } from './auth-service';
import type {
  NeuraCoCloudTask,
  NeuraCoCloudTaskRequest
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

interface CloudTaskApi {
  id: string;
  session_id: string;
  project_id: string;
  project_name: string;
  execution_mode: 'cloud';
  local_access: false;
  status: NeuraCoCloudTask['status'];
  result?: string;
  error?: string;
  provider?: string;
  model?: string;
  model_display?: string;
  estimated_credits?: number;
  usage?: NeuraCoCloudTask['usage'];
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  cancelled_at?: string;
}

const taskId = (value: string): string => {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(value)) {
    throw new Error('Identifiant de tâche Cloud invalide.');
  }
  return value;
};

const toTask = (task: CloudTaskApi): NeuraCoCloudTask => ({
  id: task.id,
  sessionId: task.session_id,
  projectId: task.project_id,
  projectName: task.project_name,
  executionMode: task.execution_mode,
  localAccess: task.local_access,
  status: task.status,
  result: task.result,
  error: task.error,
  provider: task.provider,
  model: task.model,
  modelDisplay: task.model_display,
  estimatedCredits: task.estimated_credits,
  usage: task.usage,
  createdAt: task.created_at,
  updatedAt: task.updated_at,
  startedAt: task.started_at,
  completedAt: task.completed_at,
  failedAt: task.failed_at,
  cancelledAt: task.cancelled_at
});

export const listCloudTasks = async (
  projectId: string,
  limit = 50
): Promise<NeuraCoCloudTask[]> => {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  const params = new URLSearchParams({
    project_id: projectId,
    limit: String(safeLimit)
  });
  const tasks = await authenticatedApiRequest<CloudTaskApi[]>(
    `/neuraco/cloud/tasks?${params.toString()}`
  );
  return tasks.map(toTask);
};

export const createCloudTask = async (
  request: NeuraCoCloudTaskRequest
): Promise<NeuraCoCloudTask> => {
  if (!request.content.trim()) throw new Error('Instruction Cloud vide.');
  const task = await authenticatedApiRequest<CloudTaskApi>('/neuraco/cloud/tasks', {
    method: 'POST',
    body: JSON.stringify({
      content: request.content.trim(),
      session_id: request.sessionId,
      request_id: request.requestId || randomUUID(),
      project_id: request.projectId,
      project_name: request.projectName,
      mode: request.mode,
      model: request.model || 'auto',
      effort: request.effort || 'normal',
      communication_style: request.communicationStyle || 'normal',
      response_speed: request.responseSpeed || 'standard',
      conversation_context: (request.conversationContext || [])
        .slice(-20)
        .filter((message) => ['user', 'assistant'].includes(message.role))
        .map((message) => ({
          role: message.role,
          content: redactSecrets(message.content.slice(0, 6000))
        })),
      files: request.files
    })
  });
  return toTask(task);
};

export const getCloudTask = async (id: string): Promise<NeuraCoCloudTask> => (
  toTask(await authenticatedApiRequest<CloudTaskApi>(
    `/neuraco/cloud/tasks/${encodeURIComponent(taskId(id))}`
  ))
);

export const cancelCloudTask = async (id: string): Promise<NeuraCoCloudTask> => (
  toTask(await authenticatedApiRequest<CloudTaskApi>(
    `/neuraco/cloud/tasks/${encodeURIComponent(taskId(id))}/cancel`,
    { method: 'POST' }
  ))
);
