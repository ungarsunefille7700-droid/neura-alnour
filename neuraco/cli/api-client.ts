export const CLI_API_BASE_URL = (
  process.env.NEURACO_API_BASE_URL
  || 'https://neura-alnour-backend.onrender.com/api'
).replace(/\/$/, '');

export interface CliAgentEvent {
  type: 'model' | 'delta' | 'done' | 'error';
  content?: string;
  detail?: string;
  session_id?: string;
  provider?: string;
  model?: string;
  model_display?: string;
  usage?: {
    credits_consumed?: number;
    input_tokens?: number;
    output_tokens?: number;
    duration_ms?: number;
  };
  [key: string]: unknown;
}

export class CliApiError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: unknown) {
    super(message);
  }
}

export const cliApiRequest = async <T>(
  route: string,
  token: string,
  options: RequestInit = {}
): Promise<T> => {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${CLI_API_BASE_URL}${route}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === 'string'
      ? detail
      : detail?.message || `Requête NeuraCo refusée (${response.status}).`;
    throw new CliApiError(message, response.status, detail);
  }
  return payload as T;
};

export const streamCliAgent = async (
  token: string,
  payload: Record<string, unknown>,
  onEvent: (event: CliAgentEvent) => void,
  signal?: AbortSignal
): Promise<CliAgentEvent> => {
  const response = await fetch(`${CLI_API_BASE_URL}/neuraco/agent/stream`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal
  });
  if (!response.ok || !response.body) {
    const payloadError = await response.json().catch(() => null);
    const detail = payloadError?.detail;
    throw new CliApiError(
      typeof detail === 'string' ? detail : `Flux NeuraCo refusé (${response.status}).`,
      response.status,
      detail
    );
  }

  return consumeCliAgentStream(response.body, onEvent);
};

export const consumeCliAgentStream = async (
  body: ReadableStream<Uint8Array>,
  onEvent: (event: CliAgentEvent) => void
): Promise<CliAgentEvent> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalEvent: CliAgentEvent | undefined;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      const event = JSON.parse(data) as CliAgentEvent;
      onEvent(event);
      if (event.type === 'done') finalEvent = event;
      if (event.type === 'error') throw new Error(event.detail || 'Flux NeuraCo interrompu.');
    }
  }
  if (!finalEvent) throw new Error('Le serveur NeuraCo a fermé le flux sans résultat final.');
  return finalEvent;
};
