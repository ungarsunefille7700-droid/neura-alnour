import { authenticatedApiRequest, authenticatedApiStream } from './auth-service';
import type {
  NeuraCoAgentRequest,
  NeuraCoAgentResponse,
  NeuraCoAgentStreamEvent,
  NeuraCoProposedFile
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

interface AgentApiResponse {
  message: string;
  session_id: string;
  provider: string;
  model: string;
  model_display: string;
  mode: 'question' | 'plan';
  files_used: string[];
  proposed_files?: Array<{
    path: string;
    content: string;
    language?: string;
  }>;
  images_used: Array<{
    id: string;
    name: string;
    mime_type: string;
    width: number;
    height: number;
    size: number;
  }>;
  entitlement_plan: string;
  usage?: NeuraCoAgentResponse['usage'];
  reservation?: NeuraCoAgentResponse['reservation'];
}

export const GENERAL_CHAT_PROJECT_ID = '000000000000000000000001';

export const isGeneralChatRequest = (
  request: Partial<NeuraCoAgentRequest> | null | undefined
): boolean => (
  request?.scope === 'general'
  && request.projectId === GENERAL_CHAT_PROJECT_ID
  && request.mode === 'question'
  && Array.isArray(request.files)
  && request.files.length === 0
  && Array.isArray(request.images)
  && request.images.length === 0
);

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const validateConversationContext = (
  context: NeuraCoAgentRequest['conversationContext']
): NonNullable<NeuraCoAgentRequest['conversationContext']> => {
  if (!context) return [];
  if (!Array.isArray(context) || context.length > 20) {
    throw new Error('Contexte de conversation NeuraCo invalide.');
  }
  return context.flatMap((message) => {
    if (
      !message
      || !['user', 'assistant'].includes(message.role)
      || typeof message.content !== 'string'
    ) {
      return [];
    }
    const content = redactSecrets(message.content.trim()).slice(0, 6000);
    if (!content) return [];
    return [{
      id: String(message.id || '').slice(0, 160),
      role: message.role,
      content
    }];
  });
};

const validateAgentImages = (
  images: NeuraCoAgentRequest['images']
): NeuraCoAgentRequest['images'] => {
  if (!Array.isArray(images) || images.length > 5) {
    throw new Error('Vous pouvez joindre au maximum cinq images.');
  }
  let totalBytes = 0;
  return images.map((image) => {
    if (
      !image
      || typeof image.id !== 'string'
      || !/^[A-Za-z0-9_-]{8,120}$/.test(image.id)
      || typeof image.name !== 'string'
      || image.name.length < 1
      || image.name.length > 240
      || !IMAGE_MIME_TYPES.has(image.mimeType)
      || !Number.isInteger(image.width)
      || !Number.isInteger(image.height)
      || image.width < 1
      || image.height < 1
      || image.width > 20_000
      || image.height > 20_000
      || !Number.isInteger(image.size)
      || image.size < 1
      || image.size > MAX_IMAGE_BYTES
      || typeof image.dataBase64 !== 'string'
      || image.dataBase64.length < 4
      || image.dataBase64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.dataBase64)
    ) {
      throw new Error('Une image jointe est invalide ou trop volumineuse.');
    }
    const estimatedBytes = Math.floor(image.dataBase64.length * 0.75);
    if (Math.abs(estimatedBytes - image.size) > 3) {
      throw new Error('La taille déclarée d’une image est incohérente.');
    }
    totalBytes += image.size;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('Le volume total des images dépasse 24 Mo.');
    }
    return image;
  });
};

const validateAgentRequest = (request: NeuraCoAgentRequest): NeuraCoAgentRequest => {
  if (!request || typeof request.content !== 'string') {
    throw new Error('Demande NeuraCo invalide.');
  }
  const content = request.content.trim();
  if (content.length === 0 || content.length > 50_000) {
    throw new Error('La demande doit contenir entre 1 et 50 000 caractères.');
  }
  if (!/^[a-f0-9]{24}$/i.test(request.projectId)) {
    throw new Error('Identifiant de projet NeuraCo invalide.');
  }
  if (!['question', 'plan'].includes(request.mode)) {
    throw new Error('Mode NeuraCo invalide.');
  }
  if (request.scope && !['project', 'general'].includes(request.scope)) {
    throw new Error('Portée de demande NeuraCo invalide.');
  }
  if (request.scope === 'general' && !isGeneralChatRequest(request)) {
    throw new Error('La conversation générale ne peut pas accéder aux fichiers du projet.');
  }
  if (
    request.model
    && !['auto', 'claude-sonnet-4-5', 'gpt-4o', 'gemini-2.5-flash']
      .includes(request.model)
  ) {
    throw new Error('Modèle NeuraCo invalide.');
  }
  if (!Array.isArray(request.files) || request.files.length > 16) {
    throw new Error('Trop de fichiers joints à la demande.');
  }
  return {
    ...request,
    content,
    conversationContext: validateConversationContext(request.conversationContext),
    images: validateAgentImages(request.images || [])
  };
};

const agentApiBody = (request: NeuraCoAgentRequest) => JSON.stringify({
  content: request.content,
  session_id: request.sessionId,
  request_id: request.requestId,
  scope: request.scope || 'project',
  project_id: request.projectId,
  project_name: request.projectName,
  mode: request.mode,
      model: request.model || 'auto',
      effort: request.effort || 'normal',
      communication_style: request.communicationStyle || 'normal',
      response_speed: request.responseSpeed || 'standard',
  conversation_context: request.conversationContext?.map((message) => ({
    role: message.role,
    content: message.content
  })),
  files: request.files,
  images: request.images.map((image) => ({
    id: image.id,
    name: image.name,
    mime_type: image.mimeType,
    data_base64: image.dataBase64,
    width: image.width,
    height: image.height,
    size: image.size
  }))
});

const mapAgentResponse = (response: AgentApiResponse): NeuraCoAgentResponse => ({
  message: response.message,
  sessionId: response.session_id,
  provider: response.provider,
  model: response.model,
  modelDisplay: response.model_display,
  mode: response.mode,
  filesUsed: response.files_used,
  proposedFiles: (response.proposed_files || []).map((file): NeuraCoProposedFile => ({
    path: file.path,
    content: file.content,
    language: file.language,
    status: 'pending'
  })),
  imagesUsed: (response.images_used || []).map((image) => ({
    id: image.id,
    name: image.name,
    mimeType: image.mime_type,
    width: image.width,
    height: image.height,
    size: image.size
  })),
  entitlementPlan: response.entitlement_plan,
  usage: response.usage,
  reservation: response.reservation
});

export const sendAgentMessage = async (
  rawRequest: NeuraCoAgentRequest,
  signal?: AbortSignal
): Promise<NeuraCoAgentResponse> => {
  const request = validateAgentRequest(rawRequest);
  const response = await authenticatedApiRequest<AgentApiResponse>('/neuraco/agent/chat', {
    method: 'POST',
    signal,
    body: agentApiBody(request)
  });
  return mapAgentResponse(response);
};

export const streamAgentMessage = async (
  rawRequest: NeuraCoAgentRequest,
  onEvent: (event: NeuraCoAgentStreamEvent) => void,
  signal?: AbortSignal
): Promise<NeuraCoAgentResponse> => {
  const request = validateAgentRequest(rawRequest);
  const requestId = request.requestId || '';
  const response = await authenticatedApiStream('/neuraco/agent/stream', {
    method: 'POST',
    signal,
    body: agentApiBody(request)
  });
  if (!response.body) throw new Error('Le serveur NeuraCo n’a pas ouvert le flux de réponse.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: NeuraCoAgentResponse | null = null;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const data = frame.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      const payload = JSON.parse(data);
      if (payload.type === 'delta') {
        onEvent({ requestId, type: 'delta', content: String(payload.content || '') });
      } else if (payload.type === 'model') {
        onEvent({ requestId, type: 'model' });
      } else if (payload.type === 'error') {
        const detail = String(payload.detail || 'La diffusion NeuraCo a échoué.');
        onEvent({ requestId, type: 'error', detail });
        throw new Error(detail);
      } else if (payload.type === 'done') {
        finalResponse = mapAgentResponse({
          message: payload.message || payload.completion || '',
          session_id: payload.session_id,
          provider: payload.provider,
          model: payload.model,
          model_display: payload.model_display,
          mode: payload.mode,
          files_used: payload.files_used || [],
          proposed_files: payload.proposed_files || [],
          images_used: payload.images_used || [],
          entitlement_plan: payload.entitlement_plan,
          usage: payload.usage,
          reservation: payload.reservation
        });
        onEvent({ requestId, type: 'done', response: finalResponse });
      }
    }
    if (done) break;
  }
  if (!finalResponse) throw new Error('Le flux NeuraCo s’est terminé sans réponse finale.');
  return finalResponse;
};
