import { describe, expect, it } from 'vitest';
import {
  FALLBACK_NEURACO_MODELS,
  isNeuraCoAgentModel,
  normalizeNeuraCoModels
} from './model-utils';

describe('NeuraCo model catalogue normalization', () => {
  it('preserves valid server models and their authoritative metadata', () => {
    const models = normalizeNeuraCoModels([
      {
        id: 'claude-opus-4-8',
        provider: 'anthropic',
        display_name: 'Claude Opus 4.8',
        group: 'Anthropic'
      },
      {
        id: 'gpt-5.6-sol',
        provider: 'openai',
        display_name: 'GPT-5.6 Sol',
        group: 'OpenAI'
      },
      {
        id: 'gemini-3.5-flash',
        provider: 'gemini',
        display_name: 'Gemini 3.5 Flash',
        group: 'Google Gemini'
      }
    ]);

    expect(models.map((model) => model.id)).toEqual([
      'claude-opus-4-8',
      'gpt-5.6-sol',
      'gemini-3.5-flash'
    ]);
    expect(models[0]).toMatchObject({
      provider: 'anthropic',
      display_name: 'Claude Opus 4.8'
    });
  });

  it('filters malformed and duplicate entries', () => {
    const models = normalizeNeuraCoModels([
      {
        id: 'gpt-4o',
        provider: 'openai',
        display_name: 'GPT-4o',
        group: 'OpenAI'
      },
      {
        id: 'gpt-4o',
        provider: 'fake',
        display_name: 'Duplicate',
        group: 'Fake'
      },
      {
        id: '../unsafe model',
        provider: 'openai',
        display_name: 'Unsafe',
        group: 'OpenAI'
      },
      { id: 'claude-opus-4-8' }
    ]);

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('gpt-4o');
  });

  it('uses the stable three-model fallback when the server payload is unusable', () => {
    expect(normalizeNeuraCoModels([])).toEqual([...FALLBACK_NEURACO_MODELS]);
    expect(normalizeNeuraCoModels(null)).toEqual([...FALLBACK_NEURACO_MODELS]);
  });

  it('accepts safe catalogue identifiers without accepting arbitrary text', () => {
    expect(isNeuraCoAgentModel('claude-opus-4-8')).toBe(true);
    expect(isNeuraCoAgentModel('gemini/gemini-2.5-flash')).toBe(true);
    expect(isNeuraCoAgentModel('../unsafe model')).toBe(false);
    expect(isNeuraCoAgentModel('auto', false)).toBe(false);
  });
});
