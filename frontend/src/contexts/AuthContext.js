import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// A sleeping Render instance can take 30-60s to answer the first request.
const AUTH_ME_TIMEOUT_MS = 45000;
const AUTH_ME_ATTEMPTS = 2;

// True when a failed request proves that `token` is no longer accepted by our backend.
export const isExpiredSessionError = (error, token) => {
  if (!token || error?.response?.status !== 401) return false;
  const url = String(error.config?.url || '');
  if (!url.startsWith(API)) return false;
  const headers = error.config?.headers || {};
  const authorization = typeof headers.get === 'function'
    ? headers.get('Authorization')
    : headers.Authorization || headers.authorization;
  return authorization === `Bearer ${token}`;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('neura_token'));
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const fetchingTokenRef = useRef(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const clearSession = useCallback(() => {
    localStorage.removeItem('neura_token');
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setAuthError(false);
  }, []);

  const fetchUser = useCallback(async () => {
    if (!token || fetchingTokenRef.current === token) return;
    fetchingTokenRef.current = token;
    setLoading(true);
    setAuthError(false);
    try {
      for (let attempt = 1; attempt <= AUTH_ME_ATTEMPTS; attempt += 1) {
        try {
          const response = await axios.get(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: AUTH_ME_TIMEOUT_MS
          });
          // Ignore a late answer for a token that was replaced or logged out meanwhile.
          if (tokenRef.current === token) setUser(response.data);
          return;
        } catch (error) {
          console.error('Auth error:', error);
          if ([401, 403].includes(error.response?.status)) {
            if (tokenRef.current === token) clearSession();
            return;
          }
          if (attempt === AUTH_ME_ATTEMPTS && tokenRef.current === token) {
            // Network error or server unavailable: keep the stored token so the
            // session can be restored with a retry instead of forcing a new login.
            setUser(null);
            setAuthError(true);
          }
        }
      }
    } finally {
      if (fetchingTokenRef.current === token) fetchingTokenRef.current = null;
      setLoading(false);
    }
  }, [token, clearSession]);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (window.location.hash?.includes('session_id=')) {
      setLoading(false);
      return;
    }

    if (token && !user) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, [token, user, fetchUser]);

  // An expired or revoked token answered with 401 by any API call ends the
  // local session, so protected screens redirect to the login page.
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (isExpiredSessionError(error, tokenRef.current)) clearSession();
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, [clearSession]);

  const login = async (email, password, twoFactorCode) => {
    const body = { email, password };
    if (twoFactorCode) body.two_factor_code = twoFactorCode;
    const response = await axios.post(`${API}/auth/login`, body);
    const { token: newToken, user: userData } = response.data;
    localStorage.setItem('neura_token', newToken);
    tokenRef.current = newToken;
    setToken(newToken);
    setUser(userData);
    setAuthError(false);
    return userData;
  };

  const register = async (email, password, name) => {
    const response = await axios.post(`${API}/auth/register`, { email, password, name });
    const { token: newToken, user: userData } = response.data;
    localStorage.setItem('neura_token', newToken);
    tokenRef.current = newToken;
    setToken(newToken);
    setUser(userData);
    setAuthError(false);
    return userData;
  };

  // Set user from Google OAuth callback
  const setUserFromGoogle = (userData, newToken) => {
    localStorage.setItem('neura_token', newToken);
    tokenRef.current = newToken;
    setToken(newToken);
    setUser(userData);
    setAuthError(false);
    setLoading(false);
  };

  const logout = clearSession;

  // For fetch() based calls (streams), which the axios interceptor does not see.
  const handleUnauthorizedResponse = useCallback((status, requestToken = tokenRef.current) => {
    if (status === 401 && requestToken && requestToken === tokenRef.current) clearSession();
  }, [clearSession]);

  const getAuthHeader = useCallback(() => {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [token]);

  return (
    <AuthContext.Provider value={{
      user, token, loading, authError, login, register, logout, getAuthHeader,
      fetchUser, setUserFromGoogle, handleUnauthorizedResponse
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
