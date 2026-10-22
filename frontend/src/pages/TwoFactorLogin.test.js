import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import AuthCallback from './AuthCallback';
import AuthPage from './AuthPage';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

const mockAuth = { login: jest.fn(), register: jest.fn(), setUserFromGoogle: jest.fn() };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: () => {} }) }));
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key }) }));
jest.mock('@/utils/backendWarmup', () => ({ waitForBackendWarmup: () => Promise.resolve() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const USER = { id: 'g1', name: 'Amina' };

let container;
let root;

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);
const typeInto = async (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const submit = async (form) => {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
};
const httpError = (detail) => Object.assign(new Error('401'), { response: { status: 401, data: { detail } } });

const render = async (path, element) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/auth/callback" element={element} />
          <Route path="/auth" element={element} />
          <Route path="/chat" element={<div data-testid="chat">chat</div>} />
        </Routes>
      </MemoryRouter>
    );
  });
  await flush();
};

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Google sign-in with two-factor authentication', () => {
  const callbackPath = '/auth/callback#session_id=abc';

  test('asks for the code instead of signing in, then signs in with it', async () => {
    axios.post.mockImplementation((url) => {
      if (url === `${API}/auth/google/session`) {
        return Promise.reject(httpError({ code: 'two_factor_required', message: 'Code requis', challenge: 'ch-123' }));
      }
      return Promise.resolve({ data: { token: 'jwt', user: USER } });
    });
    await render(callbackPath, <AuthCallback />);

    expect(mockAuth.setUserFromGoogle).not.toHaveBeenCalled();
    expect(byTestId('google-2fa')).not.toBeNull();

    await typeInto(byTestId('google-2fa-input'), '123456');
    await submit(byTestId('google-2fa'));

    expect(axios.post).toHaveBeenLastCalledWith(
      `${API}/auth/google/2fa`, { challenge: 'ch-123', code: '123456' }, expect.anything()
    );
    expect(mockAuth.setUserFromGoogle).toHaveBeenCalledWith(USER, 'jwt');
    expect(byTestId('chat')).not.toBeNull();
  });

  test('a wrong code keeps the form open with the server message', async () => {
    axios.post.mockImplementation((url) => (url === `${API}/auth/google/session`
      ? Promise.reject(httpError({ code: 'two_factor_required', message: 'Code requis', challenge: 'ch-1' }))
      : Promise.reject(httpError({ code: 'two_factor_invalid', message: 'Code de double authentification invalide.' }))));
    await render(callbackPath, <AuthCallback />);
    await typeInto(byTestId('google-2fa-input'), '000000');
    await submit(byTestId('google-2fa'));

    expect(mockAuth.setUserFromGoogle).not.toHaveBeenCalled();
    expect(byTestId('google-2fa')).not.toBeNull();
    expect(container.textContent).toContain('Code de double authentification invalide.');
  });

  test('an error detail object is shown as text, not rendered raw', async () => {
    axios.post.mockRejectedValue(httpError({ code: 'other', message: 'Session Google refusée.' }));
    await render(callbackPath, <AuthCallback />);
    expect(container.textContent).toContain('Session Google refusée.');
  });

  test('accounts without 2FA sign in directly', async () => {
    axios.post.mockResolvedValue({ data: { token: 'jwt', user: USER } });
    await render(callbackPath, <AuthCallback />);
    expect(mockAuth.setUserFromGoogle).toHaveBeenCalledWith(USER, 'jwt');
    expect(byTestId('google-2fa')).toBeNull();
  });
});

describe('Password sign-in with two-factor authentication', () => {
  test('shows the code field when required and sends the code', async () => {
    mockAuth.login
      .mockRejectedValueOnce(httpError({ code: 'two_factor_required', message: 'Code requis' }))
      .mockResolvedValueOnce(USER);
    await render('/auth', <AuthPage />);

    await typeInto(byTestId('login-email-input'), 'a@b.fr');
    await typeInto(byTestId('login-password-input'), 'secret123');
    const form = byTestId('login-submit-btn').closest('form');
    await submit(form);

    expect(mockAuth.login).toHaveBeenLastCalledWith('a@b.fr', 'secret123', undefined);
    expect(byTestId('login-2fa-input')).not.toBeNull();

    await typeInto(byTestId('login-2fa-input'), '654321');
    await submit(form);
    expect(mockAuth.login).toHaveBeenLastCalledWith('a@b.fr', 'secret123', '654321');
    expect(byTestId('chat')).not.toBeNull();
  });
});
