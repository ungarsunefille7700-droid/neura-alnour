import { describe, expect, it, vi } from 'vitest';
import { consumeCliAgentStream } from './api-client';

const streamFromChunks = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
};

describe('consumeCliAgentStream', () => {
  it('parses SSE frames split across network chunks', async () => {
    const onEvent = vi.fn();
    const result = await consumeCliAgentStream(streamFromChunks([
      'data: {"type":"model","model":"gpt-4o"}\n\n',
      'data: {"type":"del',
      'ta","content":"Bon"}\n\n',
      'data: {"type":"done","session_id":"session_12345678",',
      '"usage":{"credits_consumed":1.5}}\n\n'
    ]), onEvent);
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEvent.mock.calls[1][0]).toMatchObject({ type: 'delta', content: 'Bon' });
    expect(result).toMatchObject({
      type: 'done',
      session_id: 'session_12345678',
      usage: { credits_consumed: 1.5 }
    });
  });

  it('fails closed when the stream has no final event', async () => {
    await expect(consumeCliAgentStream(streamFromChunks([
      'data: {"type":"delta","content":"incomplet"}\n\n'
    ]), () => undefined)).rejects.toThrow('sans résultat final');
  });
});
