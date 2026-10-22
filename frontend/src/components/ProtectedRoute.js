import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

// Protected Route Component
// Access relies only on the user restored or established by AuthContext
// (never on navigation state, which any page can set and history replays).
const ProtectedRoute = ({ children }) => {
  const { user, token, loading, authError, fetchUser } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl">{t('common.loading')}</div>
      </div>
    );
  }
  
  // Valid-looking session but the server could not be reached: offer a retry
  // instead of sending the user back to the login form.
  if (!user && token && authError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="text-center max-w-sm space-y-4" data-testid="auth-unavailable">
          <p className="text-muted-foreground">
            Le serveur ne répond pas pour le moment. Votre session est conservée.
          </p>
          <button
            type="button"
            onClick={fetchUser}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
            data-testid="auth-retry-btn"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/auth"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  
  return children;
};

export default ProtectedRoute;
