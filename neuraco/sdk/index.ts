import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  CliApiError,
  consumeCliAgentStream,
  type CliAgentEvent
} from '../cli/api-client';

export type NeuraCoModel =
  | 'auto'
  | 'claude-sonnet-4-5'
  | 'gpt-4o'
  | 'gemini-2.5-flash';

export type NeuraCoTaskMode = 'question' | 'plan';

export interface NeuraCoProjectRef {
  id: string;
  name: string;
}

export interface NeuraCoFileContext {
  path: string;
  content: string;
  language?: string;
}

export interface NeuraCoImageContext {
  id: string;
  name: string;
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  data_base64: string;
  width: number;
  height: number;
  size: number;
}

export interface NeuraCoTaskRequest {
  instruction: string;
  project: NeuraCoProjectRef;
  sessionId?: string;
  requestId?: string;
  mode?: NeuraCoTaskMode;
  model?: NeuraCoModel;
  files?: NeuraCoFileContext[];
  images?: NeuraCoImageContext[];
}

export interface NeuraCoSpecialistRequest {
  taskId?: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  agentInstructions?: string;
  objective: string;
  project: NeuraCoProjectRef;
  phase?: 'orchestrator' | 'specialist' | 'reviewer';
  budget?: number;
  model?: NeuraCoModel;
  files?: NeuraCoFileContext[];
}

export interface NeuraCoSdkOptions {
  token: string;
  baseUrl?: string;
}

export interface NeuraCoSessionSummary {
  session_id: string;
  project_id?: string;
  project_name?: string;
  last_message?: string;
  last_role?: string;
  updated_at?: string;
  message_count?: number;
}

export interface NeuraCoTaskResult extends CliAgentEvent {
  type: 'done';
}

export interface NeuraCoCloudTask {
  id: string;
  session_id: string;
  project_id: string;
  project_name: string;
  execution_mode: 'cloud';
  local_access: false;
  status: 'queued' | 'running' | 'cancel_requested' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
  model?: string;
  model_display?: string;
  usage?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const DEFAULT_API_BASE_URL = 'https://neura-alnour-backend.onrender.com/api';

const validateToken = (token: string): string => {
  if (typeof token !== 'string' || token.length < 16 || token.length > 16 * 1024) {
    throw new Error('Jeton NeuraCo SDK invalide.');
  }
  return token;
};

const validateBaseUrl = (value: string): string => {
  const url = new URL(value);
  const isLocal = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('Le SDK NeuraCo exige HTTPS, sauf pour un serveur local.');
  }
  return url.toString().replace(/\/$/, '');
};

export class NeuraCoTask extends EventEmitter {
  readonly id: string;
  readonly result: Promise<NeuraCoTaskResult>;
  private readonly controller: AbortController;

  constructor(
    id: string,
    controller: AbortController,
    executor: () => Promise<NeuraCoTaskResult>
  ) {
    super();
    this.id = id;
    this.controller = controller;
    this.result = executor();
  }

  stop(): void {
    this.controller.abort();
  }
}

export class NeuraCoClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: NeuraCoSdkOptions) {
    this.token = validateToken(options.token);
    this.baseUrl = validateBaseUrl(options.baseUrl || DEFAULT_API_BASE_URL);
  }

  startTask(request: NeuraCoTaskRequest): NeuraCoTask {
    const requestId = request.requestId || randomUUID();
    const controller = new AbortController();
    let task: NeuraCoTask;
    task = new NeuraCoTask(requestId, controller, async () => {
      const response = await fetch(`${this.baseUrl}/neuraco/agent/stream`, {
        method: 'POST',
        headers: this.headers('text/event-stream'),
        body: JSON.stringify({
          content: request.instruction,
          session_id: request.sessionId,
          request_id: requestId,
          project_id: request.project.id,
          project_name: request.project.name,
          mode: request.mode || 'question',
          model: request.model || 'auto',
          files: request.files || [],
          images: request.images || []
        }),
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        await this.throwApiError(response);
      }
      const final = await consumeCliAgentStream(
        response.body!,
        (event) => task.emit('event', event)
      );
      task.emit('done', final);
      return final as NeuraCoTaskResult;
    });
    return task;
  }

  async sendInstruction(request: NeuraCoTaskRequest): Promise<NeuraCoTaskResult> {
    return this.startTask(request).result;
  }

  async runSpecialist(request: NeuraCoSpecialistRequest): Promise<Record<string, unknown>> {
    return this.request('/neuraco/agents/execute', {
      method: 'POST',
      body: JSON.stringify({
        task_id: request.taskId || randomUUID(),
        agent_id: request.agentId,
        agent_name: request.agentName,
        agent_role: request.agentRole,
        agent_instructions: request.agentInstructions || '',
        objective: request.objective,
        project_id: request.project.id,
        project_name: request.project.name,
        phase: request.phase || 'specialist',
        budget: request.budget || 1,
        model: request.model || 'auto',
        files: request.files || []
      })
    });
  }

  async createCloudTask(request: NeuraCoTaskRequest): Promise<NeuraCoCloudTask> {
    return this.request('/neuraco/cloud/tasks', {
      method: 'POST',
      body: JSON.stringify({
        content: request.instruction,
        session_id: request.sessionId,
        request_id: request.requestId || randomUUID(),
        project_id: request.project.id,
        project_name: request.project.name,
        mode: request.mode || 'plan',
        model: request.model || 'auto',
        files: request.files || []
      })
    });
  }

  async listCloudTasks(
    projectId?: string,
    limit = 50
  ): Promise<NeuraCoCloudTask[]> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(Math.trunc(limit), 200)))
    });
    if (projectId) params.set('project_id', projectId);
    return this.request(`/neuraco/cloud/tasks?${params.toString()}`);
  }

  async getCloudTask(taskId: string): Promise<NeuraCoCloudTask> {
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(taskId)) {
      throw new Error('Identifiant de tâche NeuraCo invalide.');
    }
    return this.request(`/neuraco/cloud/tasks/${encodeURIComponent(taskId)}`);
  }

  async cancelCloudTask(taskId: string): Promise<NeuraCoCloudTask> {
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(taskId)) {
      throw new Error('Identifiant de tâche NeuraCo invalide.');
    }
    return this.request(`/neuraco/cloud/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST'
    });
  }

  async listSessions(limit = 30): Promise<NeuraCoSessionSummary[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    return this.request(`/neuraco/sessions?limit=${safeLimit}`);
  }

  async getSession(
    sessionId: string,
    limit = 100
  ): Promise<{ session_id: string; messages: Array<Record<string, unknown>> }> {
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(sessionId)) {
      throw new Error('Identifiant de session NeuraCo invalide.');
    }
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 300));
    return this.request(
      `/neuraco/sessions/${encodeURIComponent(sessionId)}/messages?limit=${safeLimit}`
    );
  }

  async getUsage(): Promise<Record<string, unknown>> {
    return this.request('/neuraco/usage');
  }

  async estimateUsage(input: {
    mode?: 'economic' | 'balanced' | 'quality' | 'custom';
    model: Exclude<NeuraCoModel, 'auto'>;
    promptCharacters: number;
    maxOutputTokens?: number;
    agents?: number;
    imageCount?: number;
  }): Promise<Record<string, unknown>> {
    return this.request('/neuraco/usage/estimate', {
      method: 'POST',
      body: JSON.stringify({
        mode: input.mode || 'balanced',
        model: input.model,
        prompt_characters: input.promptCharacters,
        max_output_tokens: input.maxOutputTokens || 4096,
        agents: input.agents || 1,
        image_count: input.imageCount || 0
      })
    });
  }

  private headers(accept = 'application/json'): Headers {
    return new Headers({
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    });
  }

  private async request<T>(route: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${route}`, {
      ...options,
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) await this.throwApiError(response);
    return response.json() as Promise<T>;
  }

  private async throwApiError(response: Response): Promise<never> {
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail;
    throw new CliApiError(
      typeof detail === 'string'
        ? detail
        : detail?.message || `Requête NeuraCo refusée (${response.status}).`,
      response.status,
      detail
    );
  }
}
