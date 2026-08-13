import type { NeuraCoAgentModel, NeuraCoModelOption } from './ipc-contract';

const SAFE_MODEL_ID = /^[a-z0-9][a-z0-9./-]{0,119}$/i;

export const isNeuraCoAgentModel = (
  value: unknown,
  allowAuto = true
): value is NeuraCoAgentModel => (
  typeof value === 'string'
  && value !== 'auto'
  && SAFE_MODEL_ID.test(value)
) || (
  allowAuto && value === 'auto'
);

export const FALLBACK_NEURACO_MODELS: readonly NeuraCoModelOption[] = Object.freeze([
  {
    id: 'claude-sonnet-4-5',
    provider: 'anthropic',
    display_name: 'Claude Sonnet 4.5',
    group: 'Anthropic'
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    display_name: 'GPT-4o',
    group: 'OpenAI'
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    display_name: 'Gemini 2.5 Flash',
    group: 'Google Gemini'
  }
]);

export const normalizeNeuraCoModels = (
  models: unknown
): NeuraCoModelOption[] => {
  if (!Array.isArray(models)) return [...FALLBACK_NEURACO_MODELS];
  const seen = new Set<string>();
  const normalized = models.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Partial<NeuraCoModelOption>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!isNeuraCoAgentModel(id, false) || seen.has(id)) return [];
    const displayName = typeof item.display_name === 'string'
      ? item.display_name.trim().slice(0, 120)
      : '';
    const provider = typeof item.provider === 'string'
      ? item.provider.trim().slice(0, 80)
      : '';
    const group = typeof item.group === 'string'
      ? item.group.trim().slice(0, 80)
      : '';
    if (!displayName || !provider || !group) return [];
    seen.add(id);
    return [{ id, display_name: displayName, provider, group }];
  });
  return normalized.length > 0 ? normalized : [...FALLBACK_NEURACO_MODELS];
};
