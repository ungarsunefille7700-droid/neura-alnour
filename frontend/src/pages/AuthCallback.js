import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import axios from 'axios';
import { clearAuthReturnPath, resolveAuthReturnPath } from '@/utils/authReturnPath';
import { apiErrorMessage } from '@/utils/apiError';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const AuthCallback = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUserFromGoogle } = useAuth();
  const hasProcessed = useRef(false);
  const [status, setStatus] = useState('Connexion en cours...');
  const [error, setError] = useState('');
  // Google accounts protected by two-factor authentication: the server sends a
  // short-lived challenge instead of a token, finished with the user's code.
  const [twoFactorChallenge, setTwoFactorChallenge] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const extractSessionId = useCallback(() => {
    const hash = location.hash;
    return hash?.split('session_id=')[1]?.split('&')[0];
  }, [location.hash]);

  const exchangeGoogleSession = useCallback(async (sessionId) => {
    const controller = new AbortController();
    const wakeTimer = window.setTimeout(() => {
      setStatus('Serveur en réveil, connexion en cours...');
    }, 4000);
    const timeout = window.setTimeout(() => controller.abort(), 45000);

    try {
      setStatus('Connexion en cours...');
      const startedAt = performance.now();
      const response = await axios.post(
        `${API}/auth/google/session`,
        { session_id: sessionId },
        { signal: controller.signal, timeout: 46000 }
      );
      console.info(`Google auth completed in ${Math.round(performance.now() - startedAt)}ms`);
      return response;
    } finally {
      window.clearTimeout(wakeTimer);
      window.clearTimeout(timeout);
    }
  }, []);

  const finishSignIn = useCallback(({ token, user }) => {
    setUserFromGoogle(user, token);
    toast.success(`Bienvenue ${user.name}!`);
    const queryReturnPath = new URLSearchParams(location.search).get('return_to');
    const returnPath = resolveAuthReturnPath(queryReturnPath) || '/chat';
    clearAuthReturnPath();
    navigate(returnPath, { replace: true });
  }, [location.search, navigate, setUserFromGoogle]);

  const processGoogleAuth = useCallback(async () => {
    setError('');
    try {
      const sessionId = extractSessionId();

      if (!sessionId) {
        toast.error('Session invalide');
        navigate('/auth');
        return;
      }

      const response = await exchangeGoogleSession(sessionId);
      finishSignIn(response.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (detail?.code === 'two_factor_required' && detail.challenge) {
        setTwoFactorChallenge(detail.challenge);
        setTwoFactorCode('');
        setStatus('Double authentification');
        return;
      }
      console.error('Google auth error:', err);
      setError(err.response
        ? apiErrorMessage(err, 'Connexion Google impossible.')
        : "La connexion Google prend trop de temps. Réessaie dans quelques secondes.");
      setStatus('Connexion interrompue');
    }
  }, [exchangeGoogleSession, extractSessionId, finishSignIn, navigate]);

  const submitTwoFactor = async (event) => {
    event.preventDefault();
    if (!twoFactorCode.trim() || verifying) return;
    setVerifying(true);
    setError('');
    try {
      const response = await axios.post(
        `${API}/auth/google/2fa`,
        { challenge: twoFactorChallenge, code: twoFactorCode.trim() },
        { timeout: 46000 }
      );
      finishSignIn(response.data);
    } catch (err) {
      const code = err.response?.data?.detail?.code;
      if (code === 'two_factor_expired') {
        setTwoFactorChallenge('');
        setStatus('Connexion interrompue');
      }
      setTwoFactorCode('');
      setError(apiErrorMessage(err, 'Vérification impossible. Réessaie.'));
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    // Prevent double processing in StrictMode
    if (hasProcessed.current) return;
    hasProcessed.current = true;
    processGoogleAuth();
  }, [processGoogleAuth]);

  if (twoFactorChallenge) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <form onSubmit={submitTwoFactor} className="w-full max-w-sm px-6 space-y-4 text-center" data-testid="google-2fa">
          <h1 className="text-xl font-semibold">Double authentification</h1>
          <p className="text-sm text-muted-foreground">
            Entrez le code de votre application d’authentification, ou un code de secours.
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={32}
            value={twoFactorCode}
            onChange={(e) => setTwoFactorCode(e.target.value)}
            placeholder="123456"
            aria-label="Code de double authentification"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-center text-lg tracking-widest"
            data-testid="google-2fa-input"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={verifying || !twoFactorCode.trim()}
            className="w-full rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            data-testid="google-2fa-submit"
          >
            {verifying ? 'Vérification...' : 'Valider'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/auth')}
            className="block mx-auto text-sm text-muted-foreground hover:text-foreground"
          >
            Retour connexion
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-sm px-6">
        <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
        <p className="text-lg text-muted-foreground">{status}</p>
        {error && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <button
              type="button"
              onClick={processGoogleAuth}
              className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={() => navigate('/auth')}
              className="block mx-auto text-sm text-muted-foreground hover:text-foreground"
            >
              Retour connexion
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;
