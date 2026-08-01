import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeuraCoClient } from './index';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const sseResponse = (): Response => {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        'data: {"type":"model","model":"gpt-4o","model_display":"GPT-4o"}\n\n'
      ));
      controller.enqueue(encoder.encode(
        'data: {"type":"delta","content":"Réponse"}\n\n'
      ));
      controller.enqueue(encoder.encode(
        'data: {"type":"done","session_id":"session_12345678",'
        + '"usage":{"credits_consumed":0.5}}\n\n'
      ));
      controller.close();
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
};

describe('NeuraCoClient', () => {
  it('streams a task and forwards server events', async () => {
    globalThis.fetch = vi.fn(async (_url, options) => {
      expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-token-1234567890');
      return sseResponse();
    }) as typeof fetch;
    const client = new NeuraCoClient({
      token: 'test-token-1234567890',
      baseUrl: 'https://api.example.test/api'
    });
    const task = client.startTask({
      instruction: 'Analyse',
      project: { id: 'project_12345678', name: 'Projet test' },
      model: 'gpt-4o'
    });
    const events: string[] = [];
    task.on('event', (event) => events.push(event.type));
    const result = await task.result;
    expect(events).toEqual(['model', 'delta', 'done']);
    expect(result).toMatchObject({
      session_id: 'session_12345678',
      usage: { credits_consumed: 0.5 }
    });
  });

  it('uses server session endpoints and validates identifiers locally', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([
      { session_id: 'session_12345678', message_count: 2 }
    ]), { status: 200 })) as typeof fetch;
    const client = new NeuraCoClient({
      token: 'test-token-1234567890',
      baseUrl: 'http://127.0.0.1:8000/api'
    });
    await expect(client.listSessions()).resolves.toHaveLength(1);
    await expect(client.getSession('bad session')).rejects.toThrow('invalide');
  });

  it('creates and cancels a real cloud task through server endpoints', async () => {
    const requests: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = vi.fn(async (url, options) => {
      requests.push({ url: String(url), method: options?.method });
      return new Response(JSON.stringify({
        id: 'task_12345678',
        session_id: 'session_12345678',
        project_id: 'project_12345678',
        project_name: 'Projet test',
        execution_mode: 'cloud',
        local_access: false,
        status: options?.method === 'POST' && String(url).endsWith('/cancel')
          ? 'cancel_requested'
          : 'queued',
        created_at: '2026-07-26T00:00:00Z',
        updated_at: '2026-07-26T00:00:00Z'
      }), { status: 200 });
    }) as typeof fetch;
    const client = new NeuraCoClient({
      token: 'test-token-1234567890',
      baseUrl: 'https://api.example.test/api'
    });
    await expect(client.createCloudTask({
      instruction: 'Préparer les tests',
      project: { id: 'project_12345678', name: 'Projet test' }
    })).resolves.toMatchObject({ status: 'queued', local_access: false });
    await expect(client.cancelCloudTask('task_12345678'))
      .resolves.toMatchObject({ status: 'cancel_requested' });
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.example.test/api/neuraco/cloud/tasks',
      'https://api.example.test/api/neuraco/cloud/tasks/task_12345678/cancel'
    ]);
  });

  it('rejects insecure remote API origins', () => {
    expect(() => new NeuraCoClient({
      token: 'test-token-1234567890',
      baseUrl: 'http://api.example.test/api'
    })).toThrow('HTTPS');
  });
});
