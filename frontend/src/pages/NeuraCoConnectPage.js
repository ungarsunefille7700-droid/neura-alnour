import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  isNeuraCoSessionAuthError,
  shouldStartNeuraCoConnection,
  validateNeuraCoReturnPath
} from '@/utils/authReturnPath';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const NeuraCoConnectPage = () => {
  const { token, loading, logout } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('Vérification de votre accès NeuraCo...');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef(false);
  const returnPath = validateNeuraCoReturnPath(`${location.pathname}${location.search}`);

  useEffect(() => {
    if (!shouldStartNeuraCoConnection({
      started: startedRef.current,
      loading,
      token
    })) return;
    startedRef.current = true;

    const connect = async () => {
      const state = searchParams.get('state') || '';
      const callbackUrl = searchParams.get('callback') || '';
      if (!returnPath) {
        setError('Demande de connexion NeuraCo invalide.');
        return;
      }

      try {
        const response = await axios.post(
          `${API}/neuraco/auth/code`,
          { state, callback_url: callbackUrl },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 12000 }
        );
        setStatus('Accès validé. Retour vers NeuraCo...');
        window.location.replace(response.data.redirect_url);
      } catch (requestError) {
        if (isNeuraCoSessionAuthError(requestError)) {
          startedRef.current = false;
          setStatus('Session expirée. Reconnexion nécessaire...');
          logout();
          return;
        }
        const detail = requestError.response?.data?.detail;
        if (detail?.code === 'neuraco_access_required') {
          setError('NeuraCo nécessite un abonnement Plus ou supérieur actif.');
          return;
        }
        setError(
          typeof detail === 'string'
            ? detail
            : 'Impossible de terminer la connexion à NeuraCo.'
        );
      }
    };

    connect();
  }, [attempt, loading, logout, returnPath, searchParams, token]);

  const retry = () => {
    startedRef.current = false;
    setError('');
    setStatus('Vérification de votre accès NeuraCo...');
    setAttempt((current) => current + 1);
  };

  if (!returnPath) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <section className="w-full max-w-md border border-border rounded-lg bg-card p-7 text-center">
          <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-destructive" aria-hidden="true" />
          <h1 className="text-2xl font-bold">Connexion NeuraCo invalide</h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Relance la connexion depuis l'application NeuraCo.
          </p>
        </section>
      </main>
    );
  }

  if (!token && !loading) {
    const authTarget = `/auth?return_to=${encodeURIComponent(returnPath)}`;
    return <Navigate to={authTarget} replace state={{ from: returnPath }} />;
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <section className="w-full max-w-md border border-border rounded-lg bg-card p-7 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {error ? <ShieldAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
        </div>
        <h1 className="text-2xl font-bold">Connexion NeuraCo</h1>
        {error ? (
          <>
            <p className="mt-4 text-sm leading-6 text-destructive">{error}</p>
            {token && (
              <button
                type="button"
                onClick={retry}
                className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-5 font-semibold"
              >
                Réessayer
              </button>
            )}
            <Link
              to="/subscription"
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 font-semibold text-primary-foreground"
            >
              Voir les abonnements
            </Link>
          </>
        ) : (
          <div className="mt-5 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <p>{status}</p>
          </div>
        )}
      </section>
    </main>
  );
};

export default NeuraCoConnectPage;
