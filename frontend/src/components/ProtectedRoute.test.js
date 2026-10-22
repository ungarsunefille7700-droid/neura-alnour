import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from './ProtectedRoute';

jest.mock('axios', () => {
  const interceptors = { response: { handlers: [], use: jest.fn(), eject: jest.fn() } };
  return { __esModule: true, default: { get: jest.fn(), post: jest.fn(), interceptors } };
});

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key })
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const USER = { id: 'u1', name: 'Amina' };

let container;
let root;
let authApi;

const AuthProbe = () => {
  authApi = useAuth();
  return null;
};

// Lets a page push navigation state, as AuthCallback used to do.
const ForgedStateLink = () => {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="forge" onClick={() => navigate('/chat', { state: { user: USER } })}>
      forge
    </button>
  );
};

const renderApp = async (initialEntries = ['/chat']) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={initialEntries}>
        <AuthProvider>
          <AuthProbe />
          <Routes>
            <Route path="/" element={<ForgedStateLink />} />
            <Route path="/auth" element={<div data-testid="auth-page">login</div>} />
            <Route path="/chat" element={<ProtectedRoute><div data-testid="protected">secret chat</div></ProtectedRoute>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
  });
};

const flush = () => act(async () => { await Promise.resolve(); });
const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
  localStorage.clear();
  axios.get.mockReset();
  axios.post.mockReset();
  // react-scripts resets mock implementations before each test.
  const { response } = axios.interceptors;
  response.handlers.length = 0;
  response.use.mockImplementation((onFulfilled, onRejected) => {
    response.handlers.push({ onFulfilled, onRejected });
    return response.handlers.length - 1;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  console.error.mockRestore();
});

describe('ProtectedRoute', () => {
  test('ignores a user object passed in navigation state when not authenticated', async () => {
    await renderApp(['/']);
    await act(async () => byTestId('forge').click());
    expect(byTestId('protected')).toBeNull();
    expect(byTestId('auth-page')).not.toBeNull();
  });

  test('ignores navigation state on a direct entry too (history replay after logout)', async () => {
    await renderApp([{ pathname: '/chat', state: { user: USER } }]);
    expect(byTestId('protected')).toBeNull();
    expect(byTestId('auth-page')).not.toBeNull();
  });

  test('restores the session from the stored token after a page reload', async () => {
    localStorage.setItem('neura_token', 'tok-1');
    axios.get.mockResolvedValueOnce({ data: USER });
    await renderApp();
    await flush();
    expect(axios.get).toHaveBeenCalledWith(`${API}/auth/me`, expect.objectContaining({
      headers: { Authorization: 'Bearer tok-1' }
    }));
    expect(byTestId('protected')).not.toBeNull();
  });

  test('drops a token rejected by the server and redirects to login', async () => {
    localStorage.setItem('neura_token', 'expired');
    axios.get.mockRejectedValueOnce({ response: { status: 401 } });
    await renderApp();
    await flush();
    expect(localStorage.getItem('neura_token')).toBeNull();
    expect(byTestId('auth-page')).not.toBeNull();
  });

  test('keeps the session and offers a retry when the server is unreachable', async () => {
    localStorage.setItem('neura_token', 'tok-1');
    axios.get
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: USER });
    await renderApp();
    await flush();
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('neura_token')).toBe('tok-1');
    expect(byTestId('auth-page')).toBeNull();
    expect(byTestId('auth-unavailable')).not.toBeNull();

    await act(async () => byTestId('auth-retry-btn').click());
    await flush();
    expect(byTestId('protected')).not.toBeNull();
  });

  test('logs in, then logs out back to the login page', async () => {
    axios.post.mockResolvedValueOnce({ data: { token: 'tok-2', user: USER } });
    await renderApp(['/']);
    await act(async () => { await authApi.login('a@b.fr', 'x'); });
    await act(async () => byTestId('forge').click());
    expect(byTestId('protected')).not.toBeNull();

    await act(async () => authApi.logout());
    expect(localStorage.getItem('neura_token')).toBeNull();
    expect(byTestId('auth-page')).not.toBeNull();
  });

  test('ends the session when any API call reports the token expired', async () => {
    localStorage.setItem('neura_token', 'tok-1');
    axios.get.mockResolvedValueOnce({ data: USER });
    await renderApp();
    await flush();
    expect(byTestId('protected')).not.toBeNull();

    const { onRejected } = axios.interceptors.response.handlers.at(-1);
    const otherCall = { response: { status: 401 }, config: { url: `${API}/chat/conversations`, headers: { Authorization: 'Bearer old-token' } } };
    await act(async () => { await onRejected(otherCall).catch(() => {}); });
    expect(byTestId('protected')).not.toBeNull();

    const expired = { response: { status: 401 }, config: { url: `${API}/chat/conversations`, headers: { Authorization: 'Bearer tok-1' } } };
    await act(async () => { await onRejected(expired).catch(() => {}); });
    expect(localStorage.getItem('neura_token')).toBeNull();
    expect(byTestId('auth-page')).not.toBeNull();
  });

  test('does not log out on a 403 permission error', async () => {
    localStorage.setItem('neura_token', 'tok-1');
    axios.get.mockResolvedValueOnce({ data: USER });
    await renderApp();
    await flush();
    const { onRejected } = axios.interceptors.response.handlers.at(-1);
    const forbidden = { response: { status: 403 }, config: { url: `${API}/founder-admin/overview`, headers: { Authorization: 'Bearer tok-1' } } };
    await act(async () => { await onRejected(forbidden).catch(() => {}); });
    expect(byTestId('protected')).not.toBeNull();
  });
});
