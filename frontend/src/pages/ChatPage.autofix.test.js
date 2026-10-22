// The automatic correction loop of ChatPage (step 3), with the real component: the AI is
// replaced by a test double that always (or not) delivers failing code, the Python run by a
// stub. Checks: 3 corrections at most, never a 4th, the message shown, the immediate stop
// when everything passes, nothing for an error kept on purpose, nothing for plain chat.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import ChatPage from './ChatPage';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), put: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));
const mockRunPy = jest.fn();
jest.mock('@/utils/codeRunner', () => {
  const actual = jest.requireActual('@/utils/codeRunner');
  return { ...actual, verifyProject: (files) => actual.verifyProject(files, { runPy: (...args) => mockRunPy(...args) }) };
});
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Amina', subscription: 'free' },
    getAuthHeader: () => ({ Authorization: 'Bearer tok' }),
    logout: jest.fn(),
    handleUnauthorizedResponse: jest.fn(),
  }),
}));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: jest.fn() }) }));
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'fr', languageName: 'Français', t: (key) => key }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;
const encoder = new TextEncoder();
const F = '```';

let container;
let root;
let saved;
let sent;
let answers;

const sse = (content) => {
  const chunks = [`data: ${JSON.stringify({ type: 'delta', content })}\n\n`, 'data: {"type":"done","conversation_id":"c0"}\n\n']
    .map((chunk) => encoder.encode(chunk));
  return { ok: true, status: 200, body: { getReader: () => ({ cancel: jest.fn().mockResolvedValue(undefined),
    read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined }) }) } };
};

const code = (n) => `Voici le code ${n}.\n\nFichier: calc.py\n${F}python\ndef carre(x):\n    return x * ${n}\n${F}\n\nFichier: test_calc.py\n${F}python\nfrom calc import carre\n\ndef test_carre():\n    assert carre(2) == 4\n${F}`;

beforeEach(() => {
  saved = [];
  sent = [];
  mockRunPy.mockReset();
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/chat/conversations')) return { data: [{ id: 'c0', title: 'A' }] };
    if (url.endsWith('/conversations/c0/messages')) return { data: saved };
    if (url.endsWith('/conversations/c0/quota')) return { data: { conversation_type: 'chat' } };
    if (url.endsWith('/chat/models')) return { data: { options: [{ key: 'chatgpt', model: { label: 'GPT' } }], intelligence_modes: [] } };
    return { data: {} };
  });
  axios.post.mockResolvedValue({ data: {} });
  axios.put.mockResolvedValue({ data: {} });
  global.fetch = jest.fn(async (url, options) => {
    const content = JSON.parse(options.body).content;
    sent.push(content);
    const answer = answers(sent.length, content);
    saved = [...saved, { id: `u${sent.length}`, role: 'user', content }, { id: `a${sent.length}`, role: 'assistant', content: answer }];
    return sse(answer);
  });
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

const settle = async (rounds = 40) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
};

const send = async (text) => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/chat/c0']}><Routes><Route path="/chat/:conversationId" element={<ChatPage />} /></Routes></MemoryRouter>);
  });
  await settle(5);
  const input = container.querySelector('[data-testid="chat-input"]');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setValue.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  // wait until nothing moves any more: no check running and no new message for a while
  let quiet = 0;
  let last = -1;
  for (let i = 0; i < 2000 && quiet < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const running = container.querySelector('[data-testid="verification-running"]');
    quiet = !running && sent.length === last ? quiet + 1 : 0;
    last = sent.length;
  }
};

const failing = { ran: true, compiled: ['calc.py', 'test_calc.py'], syntax_errors: [], import_errors: [],
  tests: [{ name: 'test_calc.py::test_carre', ok: false, error: 'AssertionError (test_calc.py ligne 4 : assert carre(2) == 4)' }] };
const passing = { ...failing, tests: [{ name: 'test_calc.py::test_carre', ok: true }] };
const notes = () => [...container.querySelectorAll('[data-testid="verification-note"]')].map((node) => node.textContent);

test('code toujours faux : 3 corrections automatiques, jamais une 4e, puis le message à l\'utilisateur', async () => {
  answers = (n) => code(n + 2); // a new (still wrong) version each time
  mockRunPy.mockResolvedValue(failing);
  await send('Écris calc.py avec carre et son test');
  expect(sent).toHaveLength(4); // the request + 3 corrections
  expect(sent.slice(1).every((text) => text.startsWith('Le projet que tu viens de créer a des erreurs'))).toBe(true);
  expect(sent[1]).toContain('test_calc.py::test_carre : test échoué : AssertionError (test_calc.py ligne 4 : assert carre(2) == 4)');
  expect(sent[1]).not.toMatch(/Lua|fxmanifest|HTML/);
  const shown = notes();
  expect(shown).toHaveLength(4);
  expect(shown[0]).toContain('Correction automatique 1/3 envoyée à Neura');
  expect(shown[1]).toContain('Correction automatique 2/3 envoyée à Neura');
  expect(shown[2]).toContain('Correction automatique 3/3 envoyée à Neura');
  expect(shown[3]).toContain('3 corrections automatiques déjà faites : à toi de voir');
  await settle(60);
  expect(sent).toHaveLength(4); // still no 4th correction
});

test('les corrections s\'arrêtent dès que tous les tests passent', async () => {
  answers = (n) => code(n + 2);
  mockRunPy.mockResolvedValueOnce(failing).mockResolvedValue(passing);
  await send('Écris calc.py avec carre et son test');
  expect(sent).toHaveLength(2);
  const shown = notes();
  expect(shown[0]).toContain('Correction automatique 1/3');
  expect(shown[1]).toContain('tests 1/1 réussis — aucun problème trouvé');
  expect(shown[1]).not.toContain('Correction automatique');
});

test('erreur gardée volontairement : aucune correction automatique', async () => {
  answers = () => code(3);
  mockRunPy.mockResolvedValue(failing);
  await send("Écris calc.py et son test, l'erreur est voulue, c'est pour un exercice");
  expect(sent).toHaveLength(1);
  expect(container.querySelector('[data-testid="verification-autofix"]').textContent)
    .toContain('Pas de correction automatique : tu as demandé de garder cette erreur');
});

test('conversation normale sans code : aucune vérification lancée', async () => {
  answers = () => 'La prière du Fajr se fait avant le lever du soleil.';
  await send('Quand fait-on la prière du Fajr ?');
  expect(sent).toHaveLength(1);
  expect(mockRunPy).not.toHaveBeenCalled();
  expect(container.querySelector('[data-testid="verification-note"]')).toBeNull();
  expect(container.querySelector('[data-testid="verification-running"]')).toBeNull();
});
