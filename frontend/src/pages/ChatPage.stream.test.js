// Integration tests of the chat stream handling inside ChatPage.
// The network is replaced by test doubles (axios + fetch); no backend is involved.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import ChatPage from './ChatPage';
import { recordUtterance, speakWithVoice, transcribeAudio } from '@/utils/voice';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));
// Spoken replies: each call creates a speech stream that records what it was given.
const mockStreams = [];
const mockCreateSpeechStream = (options) => {
  const stream = {
    options, pushed: '', ended: null, finished: Promise.resolve(),
    push: (text) => { stream.pushed += text; },
    end: (full) => { stream.ended = full; },
  };
  mockStreams.push(stream);
  return stream;
};
jest.mock('@/utils/voice', () => ({
  ...jest.requireActual('@/utils/voice'),
  voiceCallSupported: () => true,
  recordUtterance: jest.fn(),
  transcribeAudio: jest.fn(),
  speakWithVoice: jest.fn(),
  createSpeechStream: (options) => mockCreateSpeechStream(options),
}));

const mockHandleUnauthorized = jest.fn();
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Amina', subscription: 'free' },
    getAuthHeader: () => ({ Authorization: 'Bearer tok' }),
    logout: jest.fn(),
    handleUnauthorizedResponse: mockHandleUnauthorized
  })
}));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: jest.fn() }) }));
jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'fr', languageName: 'Français', t: (key) => key })
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const encoder = new TextEncoder();
const sseResponse = (chunks, { failAfter } = {}) => {
  const queue = chunks.map((chunk) => encoder.encode(chunk));
  let reads = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        cancel: jest.fn().mockResolvedValue(undefined),
        read: async () => {
          reads += 1;
          if (failAfter !== undefined && reads > failAfter) throw new TypeError('network error');
          return queue.length ? { done: false, value: queue.shift() } : { done: true, value: undefined };
        }
      })
    }
  };
};

let container;
let root;
let savedMessages;
let conversationType;

const setupAxios = () => {
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/chat/conversations')) return { data: [{ id: 'c0', title: 'A' }, { id: 'c1', title: 'B' }] };
    if (url.endsWith('/conversations/c1/messages')) return { data: [{ id: 'b1', role: 'user', content: 'Message de B' }] };
    if (url.endsWith('/conversations/c1/quota')) return { data: { conversation_type: 'chat' } };
    if (url.endsWith('/chat/models')) {
      return { data: { options: [{ key: 'chatgpt', model: { label: 'GPT' } }], intelligence_modes: [], work_available: conversationType === 'work' } };
    }
    if (url.endsWith('/conversations/c0/messages')) return { data: savedMessages };
    if (url.endsWith('/conversations/c0/quota')) return { data: { conversation_type: conversationType } };
    return { data: {} };
  });
  axios.post.mockImplementation(async (url) => {
    return { data: {} };
  });
};

const renderChat = async () => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/chat/c0']}>
        <Routes>
          <Route path="/chat/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>
    );
  });
};

const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);
const messageTexts = () => Array.from(container.querySelectorAll('[data-testid^="message-"]'))
  .filter((node) => /^message-\d+$/.test(node.dataset.testid))
  .map((node) => node.textContent);

const sendText = async (text) => {
  const input = byTestId('chat-input');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  // Let the stream promise chain settle.
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
};

beforeEach(() => {
  savedMessages = [];
  conversationType = 'chat';
  setupAxios();
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete global.fetch;
  console.error.mockRestore();
});

// Stream whose chunks are released by the test (simulates a slow answer).
const controlledStream = () => {
  const queue = [];
  let wake = null;
  let finished = false;
  const push = (text) => { queue.push(encoder.encode(text)); if (wake) { wake(); wake = null; } };
  const end = () => { finished = true; if (wake) { wake(); wake = null; } };
  const response = {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        cancel: jest.fn().mockResolvedValue(undefined),
        read: async () => {
          while (!queue.length && !finished) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => { wake = resolve; });
          }
          return queue.length ? { done: false, value: queue.shift() } : { done: true, value: undefined };
        }
      })
    }
  };
  return { response, push, end };
};

const settle = async () => {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
};

describe('ChatPage streaming', () => {
  test('an answer still streaming for A never shows up in conversation B', async () => {
    await renderChat();
    const stream = controlledStream();
    global.fetch = jest.fn().mockResolvedValue(stream.response);

    await sendText('Question dans A');
    await act(async () => { stream.push('data: {"type":"delta","content":"Debut de la reponse A"}\n\n'); });
    await settle();
    expect(container.textContent).toContain('Debut de la reponse A');

    // Open conversation B in the sidebar while A is still answering.
    await act(async () => { byTestId('conversation-c1').click(); });
    await settle();
    await act(async () => {
      stream.push('data: {"type":"delta","content":" et la fin"}\n\n');
      stream.push('data: {"type":"done","conversation_id":"c0"}\n\n');
      stream.end();
    });
    await settle();

    expect(container.textContent).toContain('Message de B');
    expect(container.textContent).not.toContain('reponse A');
    expect(container.textContent).not.toContain('Question dans A');
    expect(toast.error).not.toHaveBeenCalled();
    // The send button is usable again in B (A's request no longer blocks it).
    expect(byTestId('chat-input').disabled).toBe(false);
  });

  test('like ChatGPT: « Réflexion en cours » while it answers, the reasoning folded inside', async () => {
    await renderChat();
    const stream = controlledStream();
    global.fetch = jest.fn().mockResolvedValue(stream.response);

    await sendText('Crée-moi un jeu de quiz islamique en HTML');
    await settle();
    // Auto, nothing reasoned yet: only the blue dot, never a fake « Réflexion en cours ».
    expect(byTestId('writing-dot')).toBeTruthy();
    expect(container.querySelector('[data-testid="thinking-panel"]')).toBeNull();

    await act(async () => {
      stream.push('data: {"type":"thinking","content":"Il veut un quiz en 3 fichiers."}\n\n');
    });
    await settle();
    expect(byTestId('thinking-title').textContent).toBe('Réflexion en cours');
    expect(container.querySelector('[data-testid="thinking-details"]')).toBeNull(); // folded

    await act(async () => {
      stream.push('data: {"type":"delta","content":"Je vais créer un quiz.\\n\\nFichier: index.html\\n```html\\n<h1>Quiz</h1>\\n"}\n\n');
    });
    await settle();
    expect(container.textContent).toContain('Je vais créer un quiz.');
    expect(container.textContent).not.toContain('Il veut un quiz'); // reasoning stays folded
    await act(async () => { byTestId('thinking-toggle').click(); });
    expect(byTestId('thinking-text').textContent).toBe('Il veut un quiz en 3 fichiers.');
    expect(byTestId('thinking-details').textContent).toContain('Écriture de index.html');

    await act(async () => {
      stream.push('data: {"type":"delta","content":"```\\n"}\n\n');
      stream.push('data: {"type":"done","conversation_id":"c0"}\n\n');
      stream.end();
    });
    await settle();
    expect(container.querySelector('[data-testid="stop-generating-btn"]')).toBeNull();
  });

  test('the Stop button halts the answer at once and keeps what was written', async () => {
    await renderChat();
    let rejectRead;
    let aborted = false;
    const encoderStop = new TextEncoder();
    const first = encoderStop.encode('data: {"type":"delta","content":"Debut de la longue reponse"}\n\n');
    let sent = false;
    global.fetch = jest.fn().mockImplementation(async (url, init) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        rejectRead?.(error);
      });
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            cancel: jest.fn().mockResolvedValue(undefined),
            read: () => (sent
              ? new Promise((resolve, reject) => { rejectRead = reject; })
              : (sent = true, Promise.resolve({ done: false, value: first }))),
          }),
        },
      };
    });

    await sendText('Ecris-moi une tres longue histoire');
    await settle();
    expect(container.textContent).toContain('Debut de la longue reponse');
    const stop = byTestId('stop-generating-btn');
    await act(async () => { stop.click(); });
    await settle();

    expect(aborted).toBe(true);
    expect(container.textContent).toContain('Debut de la longue reponse');
    expect(byTestId('message-stopped').textContent).toContain('Réponse arrêtée');
    expect(container.querySelector('[data-testid="stop-generating-btn"]')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('uses the final event even without a trailing separator, without duplicates', async () => {
    await renderChat();
    global.fetch = jest.fn().mockImplementation(async () => {
      // After the stream, the page reloads the conversation saved by the server.
      savedMessages = [
        { id: 'm1', role: 'user', content: 'Salam' },
        { id: 'm2', role: 'assistant', content: 'Wa alaykum salam' }
      ];
      return sseResponse([
        'data: {"type":"delta","content":"Wa alaykum"}\n\n',
        'data: {"type":"delta","content":" salam"}\n\ndata: {"type":"done","conversation_id":"c0"}'
      ]);
    });

    await sendText('Salam');

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/chat/stream'), expect.objectContaining({ method: 'POST' }));
    expect(toast.error).not.toHaveBeenCalled();
    const texts = messageTexts();
    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain('Wa alaykum salam');
    expect(byTestId('message-interrupted')).toBeNull();
  });

  test('keeps a partial answer, marked as incomplete, when the stream stops before "done"', async () => {
    await renderChat();
    global.fetch = jest.fn().mockResolvedValue(sseResponse([
      'data: {"type":"delta","content":"Début de réponse"}\n\n'
    ]));

    await sendText('Explique la zakat');

    const texts = messageTexts();
    expect(texts[0]).toContain('Explique la zakat');
    expect(texts[1]).toContain('Début de réponse');
    expect(byTestId('message-interrupted')).not.toBeNull();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('interrompue'));
  });

  test('keeps a partial answer when the network fails mid-stream', async () => {
    await renderChat();
    global.fetch = jest.fn().mockResolvedValue(sseResponse([
      'data: {"type":"delta","content":"Morceau reçu"}\n\n', 'data: {"type":"delta"'
    ], { failAfter: 1 }));

    await sendText('Question');

    expect(messageTexts()[1]).toContain('Morceau reçu');
    expect(byTestId('message-interrupted')).not.toBeNull();
  });

  test('shows the server error and removes the pending message when nothing was received', async () => {
    await renderChat();
    global.fetch = jest.fn().mockResolvedValue(sseResponse([
      'data: {"type":"error","detail":"Service momentanément saturé."}'
    ]));

    await sendText('Question');

    expect(toast.error).toHaveBeenCalledWith('Service momentanément saturé.');
    expect(messageTexts()).toHaveLength(0);
  });

  test('Work mode: uses the final "done" event even without a trailing separator', async () => {
    conversationType = 'work';
    await renderChat();
    global.fetch = jest.fn().mockImplementation(async () => {
      savedMessages = [
        { id: 'w1', role: 'user', content: 'Prépare un plan' },
        { id: 'w2', role: 'assistant', content: 'Livrable : plan en 3 étapes' }
      ];
      return sseResponse([
        'data: {"type":"phase","phase":"analyzing"}\n\n',
        'data: {"type":"done","response":"Livrable : plan en 3 étapes","conversation_id":"c0"}'
      ]);
    });

    await sendText('Prépare un plan');

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/chat/work'), expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
    const texts = messageTexts();
    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain('Livrable : plan en 3 étapes');
  });

  test('Work mode: an incomplete stream shows a French message, not a technical one', async () => {
    conversationType = 'work';
    await renderChat();
    global.fetch = jest.fn().mockResolvedValue(sseResponse(['data: {"type":"phase","phase":"generating"}\n\n']));

    await sendText('Prépare un plan');

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('interrompue'));
    expect(messageTexts()).toHaveLength(0);
  });

  test('reports an expired session (HTTP 401) to the auth context', async () => {
    await renderChat();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      body: null,
      json: async () => ({ detail: 'Session expirée' })
    });

    await sendText('Question');

    expect(mockHandleUnauthorized).toHaveBeenCalledWith(401);
    expect(toast.error).toHaveBeenCalledWith('Session expirée');
    expect(messageTexts()).toHaveLength(0);
  });
});

describe('ChatPage voice call', () => {
  const settle = async () => {
    for (let i = 0; i < 15; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
  };

  test('the call button next to Send talks with Neura and reads the answer with the chosen voice', async () => {
    let hangUpListen;
    recordUtterance
      .mockResolvedValueOnce({ blob: new Blob(['a'], { type: 'audio/webm' }), heard: true })
      .mockImplementationOnce(() => new Promise((resolve) => { hangUpListen = resolve; }));
    transcribeAudio.mockResolvedValue('Quels sont les piliers ?');
    speakWithVoice.mockResolvedValue();
    await renderChat();
    // After the stream, the page reloads the conversation saved by the server.
    savedMessages = [
      { id: 'v1', role: 'user', content: 'Quels sont les piliers ?' },
      { id: 'v2', role: 'assistant', content: 'Il y en a cinq.' },
    ];
    global.fetch = jest.fn().mockResolvedValue(sseResponse([
      'data: {"type":"delta","content":"Il y en a cinq."}\n\n',
      'data: {"type":"done","conversation_id":"c0"}\n\n',
    ]));

    const callButton = byTestId('voice-call-btn');
    expect(callButton.nextElementSibling).toBe(byTestId('send-message-btn'));
    await act(async () => { callButton.click(); });
    await settle();

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/chat/stream'), expect.objectContaining({
      body: expect.stringContaining('Quels sont les piliers ?'),
    }));
    expect(messageTexts().join(' ')).toContain('Quels sont les piliers ?');
    // The voice received the reply while it streamed, not only at the end.
    const stream = mockStreams[mockStreams.length - 1];
    expect(stream.options).toEqual(expect.objectContaining({ voice: 'nova' }));
    expect(stream.pushed).toBe('Il y en a cinq.');
    expect(byTestId('voice-call-panel')).not.toBeNull();

    await act(async () => { byTestId('voice-call-hangup').click(); });
    await act(async () => { hangUpListen({ blob: null, heard: false }); });
    expect(byTestId('voice-call-panel')).toBeNull();
  });

  test('the + menu also offers the voice call and the voice choice', async () => {
    await renderChat();
    await act(async () => { byTestId('tools-menu-button').click(); });
    expect(byTestId('tools-voice-call').textContent).toContain('Appel vocal');
    const picker = byTestId('voice-picker');
    expect(Array.from(picker.querySelectorAll('optgroup')).map((group) => group.label))
      .toEqual(['Voix féminines', 'Voix masculines', 'Voix neutre']);
  });
});
