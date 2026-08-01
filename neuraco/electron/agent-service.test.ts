import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('./auth-service', () => ({
  authenticatedApiRequest: requestMock
}));

import {
  GENERAL_CHAT_PROJECT_ID,
  isGeneralChatRequest,
  sendAgentMessage
} from './agent-service';

beforeEach(() => requestMock.mockReset());

describe('agent-service conversation context', () => {
  it('autorise une conversation générale sans projet ni fichier local', async () => {
    requestMock.mockResolvedValue({
      message: 'Je peux vous aider sans ouvrir de dossier.',
      session_id: 'session_general_12345678',
      provider: 'openai',
      model: 'gpt-4o',
      model_display: 'GPT-4o',
      mode: 'question',
      files_used: [],
      images_used: [],
      entitlement_plan: 'neura_ultra'
    });
    const request = {
      content: 'Peux-tu me proposer un script FiveM ?',
      scope: 'general' as const,
      projectId: GENERAL_CHAT_PROJECT_ID,
      projectName: 'Conversation générale',
      mode: 'question' as const,
      model: 'auto' as const,
      files: [],
      images: []
    };

    expect(isGeneralChatRequest(request)).toBe(true);
    await expect(sendAgentMessage(request)).resolves.toMatchObject({
      message: 'Je peux vous aider sans ouvrir de dossier.'
    });
    expect(JSON.parse(requestMock.mock.calls[0][1].body)).toMatchObject({
      project_id: GENERAL_CHAT_PROJECT_ID,
      files: [],
      images: []
    });
  });

  it('refuse tout fichier local dans une conversation générale', async () => {
    const request = {
      content: 'Lis ce fichier.',
      scope: 'general' as const,
      projectId: GENERAL_CHAT_PROJECT_ID,
      projectName: 'Conversation générale',
      mode: 'question' as const,
      files: [{ path: 'secret.txt', content: 'secret' }],
      images: []
    };

    expect(isGeneralChatRequest(request)).toBe(false);
    await expect(sendAgentMessage(request)).rejects.toThrow(
      'ne peut pas accéder aux fichiers'
    );
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('transmet le contexte d’une branche sans révéler les secrets locaux', async () => {
    requestMock.mockResolvedValue({
      message: 'Alternative analysée.',
      session_id: 'session_branch_12345678',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      model_display: 'Claude Sonnet 4.5',
      mode: 'question',
      files_used: [],
      images_used: [],
      entitlement_plan: 'pro'
    });

    await sendAgentMessage({
      content: 'Continue cette alternative.',
      projectId: '0123456789abcdef01234567',
      projectName: 'Projet test',
      mode: 'question',
      model: 'auto',
      conversationContext: [
        {
          id: 'message-1',
          role: 'user',
          content: 'Utilise API_KEY=very-secret-value'
        },
        {
          id: 'message-system',
          role: 'system',
          content: 'Ce message système local ne doit pas être transmis.'
        }
      ],
      files: [],
      images: []
    });

    const body = JSON.parse(requestMock.mock.calls[0][1].body);
    expect(body.conversation_context).toEqual([{
      role: 'user',
      content: 'Utilise API_KEY=[MASQUÉ]'
    }]);
    expect(JSON.stringify(body)).not.toContain('very-secret-value');
    expect(JSON.stringify(body)).not.toContain('message système local');
  });

  it('refuse un contexte surdimensionné avant l’appel distant', async () => {
    await expect(sendAgentMessage({
      content: 'Continue.',
      projectId: '0123456789abcdef01234567',
      projectName: 'Projet test',
      mode: 'question',
      conversationContext: Array.from({ length: 21 }, (_, index) => ({
        id: `message-${index}`,
        role: 'user' as const,
        content: `Message ${index}`
      })),
      files: [],
      images: []
    })).rejects.toThrow('Contexte de conversation');
    expect(requestMock).not.toHaveBeenCalled();
  });
});
