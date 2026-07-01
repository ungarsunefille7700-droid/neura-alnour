import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    // Prevent double processing in StrictMode
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const processGoogleAuth = async () => {
      try {
        // Extract session_id from URL fragment
        const hash = location.hash;
        const sessionId = hash?.split('session_id=')[1]?.split('&')[0];

        if (!sessionId) {
          toast.error('Session invalide');
          navigate('/auth');
          return;
        }

        // Exchange session_id for user data
        const response = await axios.post(`${API}/auth/google/session`, {
          session_id: sessionId
        });

        const { token, user } = response.data;

        // Store token and user once through the auth context.
        setUserFromGoogle(user, token);

        toast.success(`Bienvenue ${user.name}!`);
        
        // Redirect to chat
        navigate('/chat', { replace: true, state: { user } });
      } catch (error) {
        console.error('Google auth error:', error);
        toast.error(error.response?.data?.detail || 'Erreur d\'authentification Google');
        navigate('/auth');
      }
    };

    processGoogleAuth();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
        <p className="text-lg text-muted-foreground">Connexion en cours...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
