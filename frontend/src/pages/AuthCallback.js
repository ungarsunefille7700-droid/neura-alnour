import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const AuthCallback = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUserFromGoogle } = useAuth();
  const hasProcessed = useRef(false);
  const [status, setStatus] = useState('Connexion en cours...');
  const [error, setError] = useState('');

  const extractSessionId = useCallback(() => {
    const hash = location.hash;
    return hash?.split('session_id=')[1]?.split('&')[0];
  }, [location.hash]);

  const exchangeGoogleSession = useCallback(async (sessionId) => {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const wakeTimer = window.setTimeout(() => {
        setStatus('Serveur en réveil, connexion en cours...');
      }, 4000);
      const timeout = window.setTimeout(() => controller.abort(), 12000);

      try {
        setStatus(attempt === 1 ? 'Connexion en cours...' : `Nouvelle tentative ${attempt}/3...`);
        const startedAt = performance.now();
        const response = await axios.post(
          `${API}/auth/google/session`,
          { session_id: sessionId },
          { signal: controller.signal, timeout: 13000 }
        );
        console.info(`Google auth completed in ${Math.round(performance.now() - startedAt)}ms`);
        return response;
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
        }
      } finally {
        window.clearTimeout(wakeTimer);
        window.clearTimeout(timeout);
      }
    }
    throw lastError;
  }, []);

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
      const { token, user } = response.data;

      setUserFromGoogle(user, token);
      toast.success(`Bienvenue ${user.name}!`);
      navigate('/chat', { replace: true, state: { user } });
    } catch (err) {
      console.error('Google auth error:', err);
      const detail = err.response?.data?.detail;
      setError(detail || "La connexion Google prend trop de temps. Réessaie dans quelques secondes.");
      setStatus('Connexion interrompue');
    }
  }, [exchangeGoogleSession, extractSessionId, navigate, setUserFromGoogle]);

  useEffect(() => {
    // Prevent double processing in StrictMode
    if (hasProcessed.current) return;
    hasProcessed.current = true;
    processGoogleAuth();
  }, [processGoogleAuth]);

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
