import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import LanguageTutorPage from './LanguageTutorPage';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'tok',
    getAuthHeader: () => ({ Authorization: 'Bearer tok' }),
    handleUnauthorizedResponse: () => {},
  }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout: the page scrolls to the last message.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const SESSIONS = {
  English: [
    { session_id: 's-en-2', title: 'Second English chat', updated_at: '2026-10-14T10:00:00+00:00' },
    { session_id: 's-en-1', title: 'First English chat', updated_at: '2026-10-13T10:00:00+00:00' },
  ],
  'Tarifit (Rif Berber)': [
    { session_id: 's-rif', title: 'Azul', updated_at: '2026-10-14T09:00:00+00:00' },
  ],
};
const MESSAGES = {
  's-en-2': [{ role: 'user', content: 'latest english question' }, { role: 'assistant', content: 'latest english answer' }],
  's-en-1': [{ role: 'user', content: 'older english question' }],
  's-rif': [{ role: 'user', content: 'azul fellawen' }, { role: 'assistant', content: 'tarifit lesson' }],
};

let container;
let root;

const flush = async () => {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);
const choose = async (select, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
};

beforeEach(() => {
  localStorage.setItem('neura_tutor_lang', 'en');
  axios.get.mockImplementation((url, config) => {
    if (url === `${API}/language-tutor/progress`) return Promise.resolve({ data: [] });
    if (url === `${API}/language-tutor/sessions`) {
      return Promise.resolve({ data: SESSIONS[config.params.language] || [] });
    }
    const match = url.match(/sessions\/([^/]+)\/messages$/);
    if (match) return Promise.resolve({ data: MESSAGES[match[1]] });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  axios.delete.mockResolvedValue({ data: { deleted: true } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
  localStorage.clear();
});

const render = async () => {
  await act(async () => {
    root.render(<MemoryRouter><LanguageTutorPage /></MemoryRouter>);
  });
  await flush();
};

test('reopens the latest saved conversation of the language', async () => {
  await render();
  expect(container.textContent).toContain('latest english answer');
  expect(byTestId('tutor-session-select').value).toBe('s-en-2');
});

test('each language has its own conversations', async () => {
  await render();
  await choose(byTestId('tutor-lang'), 'rif');
  expect(container.textContent).toContain('tarifit lesson');
  expect(container.textContent).not.toContain('latest english answer');
  expect(byTestId('tutor-session-select').value).toBe('s-rif');

  await choose(byTestId('tutor-lang'), 'en');
  expect(container.textContent).toContain('latest english answer');
});

test('an older conversation can be reopened, and a new one started', async () => {
  await render();
  await choose(byTestId('tutor-session-select'), 's-en-1');
  expect(container.textContent).toContain('older english question');
  expect(container.textContent).not.toContain('latest english answer');

  await act(async () => { byTestId('tutor-new-conversation').click(); });
  expect(container.textContent).not.toContain('older english question');
  expect(byTestId('tutor-session-select').value).toBe('');
});

test('a conversation can be deleted', async () => {
  window.confirm = jest.fn(() => true);
  await render();
  await act(async () => { byTestId('tutor-delete-conversation').click(); });
  await flush();
  expect(axios.delete).toHaveBeenCalledWith(`${API}/language-tutor/sessions/s-en-2`, expect.anything());
});
