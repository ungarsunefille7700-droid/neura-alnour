import { useState, useEffect, createContext, useContext } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import PrayerNotificationManager from "@/components/PrayerNotificationManager";

// Context
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";

// Pages
import LandingPage from "@/pages/LandingPage";
import AuthPage from "@/pages/AuthPage";
import AuthCallback from "@/pages/AuthCallback";
import ChatPage from "@/pages/ChatPage";
import QuranPage from "@/pages/QuranPage";
import PrayerTimesPage from "@/pages/PrayerTimesPage";
import DuasPage from "@/pages/DuasPage";
import QuizPage from "@/pages/QuizPage";
import RamadanPage from "@/pages/RamadanPage";
import SubscriptionPage from "@/pages/SubscriptionPage";
import SettingsPage from "@/pages/SettingsPage";
import QiblahPage from "@/pages/QiblahPage";
import MosquesPage from "@/pages/MosquesPage";
import LearnPage from "@/pages/LearnPage";
import SupportPage from "@/pages/SupportPage";
import DeveloperPage from "@/pages/DeveloperPage";
import LanguageTutorPage from "@/pages/LanguageTutorPage";
import IslamLearningPage from "@/pages/IslamLearningPage";
import MushafPage from "@/pages/MushafPage";
import RemindersPage from "@/pages/RemindersPage";
import MultiplayerQuizPage from "@/pages/MultiplayerQuizPage";
import FounderAdminPage from "@/pages/FounderAdminPage";
import GamificationPage from "@/pages/GamificationPage";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  
  // Skip if user passed from AuthCallback
  if (location.state?.user) {
    return children;
  }
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl">{t('common.loading')}</div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/auth" replace />;
  }
  
  return children;
};

// App Router - handles OAuth callback detection
function AppRouter() {
  const location = useLocation();
  
  // Check URL fragment for session_id (Google OAuth callback)
  // This must be synchronous to prevent race conditions
  if (location.hash?.includes('session_id=')) {
    return <AuthCallback />;
  }
  
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
      <Route path="/chat/:conversationId" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
      <Route path="/quran" element={<QuranPage />} />
      <Route path="/quran/:surahNumber" element={<QuranPage />} />
      <Route path="/mushaf" element={<MushafPage />} />
      <Route path="/prayer-times" element={<PrayerTimesPage />} />
      <Route path="/duas" element={<DuasPage />} />
      <Route path="/quiz" element={<QuizPage />} />
      <Route path="/quiz/multiplayer" element={<ProtectedRoute><MultiplayerQuizPage /></ProtectedRoute>} />
      <Route path="/ramadan" element={<RamadanPage />} />
      <Route path="/subscription" element={<SubscriptionPage />} />
      <Route path="/subscription/success" element={<SubscriptionPage />} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/qiblah" element={<QiblahPage />} />
      <Route path="/mosques" element={<MosquesPage />} />
      <Route path="/learn" element={<LearnPage />} />
      <Route path="/support" element={<SupportPage />} />
      <Route path="/developer" element={<ProtectedRoute><DeveloperPage /></ProtectedRoute>} />
      <Route path="/language-tutor" element={<ProtectedRoute><LanguageTutorPage /></ProtectedRoute>} />
      <Route path="/islam-learning" element={<IslamLearningPage />} />
      <Route path="/reminders" element={<RemindersPage />} />
      <Route path="/founder-admin" element={<ProtectedRoute><FounderAdminPage /></ProtectedRoute>} />
      <Route path="/rewards" element={<ProtectedRoute><GamificationPage /></ProtectedRoute>} />
    </Routes>
  );
}

function AppContent() {
  const { theme } = useTheme();

  useEffect(() => {
    // Wake the Render backend as soon as the application opens so Google OAuth
    // does not have to wait for a cold server after the external redirect.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    fetch(`${API}/health`, {
      cache: 'no-store',
      signal: controller.signal,
      keepalive: true,
    }).catch(() => {}).finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  
  return (
    <div className="min-h-screen bg-background page-enter">
      <PrayerNotificationManager />
      <AppErrorBoundary>
        <AppRouter />
      </AppErrorBoundary>
      <Toaster position="top-right" richColors />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
