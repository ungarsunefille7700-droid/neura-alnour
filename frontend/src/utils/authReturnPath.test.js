import {
  clearAuthReturnPath,
  isNeuraCoSessionAuthError,
  rememberAuthReturnPath,
  resolveAuthReturnPath,
  shouldStartNeuraCoConnection,
  validateNeuraCoReturnPath
} from './authReturnPath';

const state = 'abcdefghijklmnopqrstuvwxyzABCDEF1234567890_-';
const validPath = `/neuraco/connect?state=${state}&callback=${encodeURIComponent('http://127.0.0.1:55773/callback')}`;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

test('accepts only a complete NeuraCo loopback return path', () => {
  expect(validateNeuraCoReturnPath(validPath)).toBe(validPath);
  expect(validateNeuraCoReturnPath('/chat')).toBeNull();
  expect(validateNeuraCoReturnPath(`/neuraco/connect?state=${state}&callback=${encodeURIComponent('https://example.com/callback')}`)).toBeNull();
  expect(validateNeuraCoReturnPath(`/neuraco/connect?state=short&callback=${encodeURIComponent('http://127.0.0.1:55773/callback')}`)).toBeNull();
});

test('restores the NeuraCo return path if OAuth comes back in another tab', () => {
  expect(rememberAuthReturnPath(validPath)).toBe(validPath);
  window.sessionStorage.clear();
  expect(resolveAuthReturnPath()).toBe(validPath);
});

test('the explicit OAuth callback destination has priority', () => {
  const secondPath = `/neuraco/connect?state=${state}second&callback=${encodeURIComponent('http://localhost:49152/callback')}`;
  rememberAuthReturnPath(validPath);
  expect(resolveAuthReturnPath(secondPath)).toBe(secondPath);
  clearAuthReturnPath();
  expect(resolveAuthReturnPath()).toBeNull();
});

test('waits for the web session check before starting the NeuraCo exchange', () => {
  expect(shouldStartNeuraCoConnection({ started: false, loading: true, token: 'token' })).toBe(false);
  expect(shouldStartNeuraCoConnection({ started: false, loading: false, token: null })).toBe(false);
  expect(shouldStartNeuraCoConnection({ started: true, loading: false, token: 'token' })).toBe(false);
  expect(shouldStartNeuraCoConnection({ started: false, loading: false, token: 'token' })).toBe(true);
});

test('recognizes an expired web session response', () => {
  expect(isNeuraCoSessionAuthError({ response: { status: 401 } })).toBe(true);
  expect(isNeuraCoSessionAuthError({ response: { status: 403 } })).toBe(false);
  expect(isNeuraCoSessionAuthError(new Error('network'))).toBe(false);
});
