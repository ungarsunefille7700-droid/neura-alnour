import { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import ApiKeysPanel from './ApiKeysPanel';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const API = `${process.env.REACT_APP_BACKEND_URL}/api/gateway`;
const HEADERS = { Authorization: 'Bearer session' };
const KEY = {
  id: 'k1', name: 'NeuraCo', prefix: 'nan_AbCdEf', last4: 'wxyz', status: 'active', total_requests: 12,
  limits: { requests_per_minute: 20, daily_neurons: 500, max_concurrent: 2 }, today: { requests: 3, used: 42.5 },
};
const STATUS = {
  engine: { provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it', legacy_ai: false },
  budget: { day: '2026-10-14', used: 6800, daily_limit: 9000, requests: 210 },
  queue: { active: 1, waiting: 0, rejected: 0 },
};
const STATS = { enabled: true, budget: STATUS.budget, days: { '2026-10-14': { requests: 210 } }, cache_hits: 31, latency_ms_p50: 1800 };

let container;
let root;

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const setInput = (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  axios.get.mockImplementation(async (url) => {
    if (url === `${API}/status`) return { data: STATUS };
    if (url === `${API}/keys`) return { data: [KEY] };
    if (url.startsWith(`${API}/stats`)) return { data: STATS };
    throw new Error(`unexpected ${url}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

test('shows the engine, the free Neuron budget and the keys without their secret', async () => {
  await act(async () => { root.render(<ApiKeysPanel headers={HEADERS} />); });
  await flush();
  expect(container.textContent).toContain('cloudflare');
  expect(container.textContent).toContain('mode 100 % gratuit');
  expect(container.querySelector('[data-testid="budget-used"]').textContent.replace(/\s/g, '')).toBe('6800/9000');
  const row = container.querySelector('[data-testid="api-key-row"]');
  expect(row.textContent).toContain('nan_AbCdEf…wxyz');
  expect(row.textContent).toContain('aujourd\'hui : 3 req');
  expect(axios.get).toHaveBeenCalledWith(`${API}/keys`, { headers: HEADERS });
});

test('a new key is shown once, then hidden for good', async () => {
  axios.post.mockResolvedValue({ data: { key: 'nan_SECRET_value_123', api_key: { id: 'k2' } } });
  await act(async () => { root.render(<ApiKeysPanel headers={HEADERS} />); });
  await flush();
  await act(async () => { setInput(container.querySelector('[data-testid="api-key-name"]'), 'Partenaire'); });
  await act(async () => {
    container.querySelector('[data-testid="api-key-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
  expect(axios.post).toHaveBeenCalledWith(`${API}/keys`, {
    name: 'Partenaire', requests_per_minute: 20, daily_neurons: 500, max_concurrent: 2,
  }, { headers: HEADERS });
  const secret = container.querySelector('[data-testid="api-key-secret"]');
  expect(secret.textContent).toContain('nan_SECRET_value_123');
  const done = [...secret.querySelectorAll('button')].find((b) => b.textContent.includes("J'ai copié"));
  await act(async () => { done.click(); });
  expect(container.textContent).not.toContain('nan_SECRET_value_123');
});

test('revoking asks for confirmation first', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  axios.post.mockResolvedValue({ data: { ok: true } });
  await act(async () => { root.render(<ApiKeysPanel headers={HEADERS} />); });
  await flush();
  const revoke = container.querySelector('[data-testid="api-key-revoke"]');
  await act(async () => { revoke.click(); });
  expect(axios.post).not.toHaveBeenCalled();
  await act(async () => { revoke.click(); });
  await flush();
  expect(axios.post).toHaveBeenCalledWith(`${API}/keys/k1/revoke`, {}, { headers: HEADERS });
  confirm.mockRestore();
});
