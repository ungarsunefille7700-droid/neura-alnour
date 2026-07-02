import { useState, useEffect, createContext, useContext } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";

// Context
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";

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

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  // Skip if user passed from AuthCallback
  if (location.state?.user) {
    return children;
  }
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl">Chargement...</div>
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
      <Route path="/islam-learning" element={<ProtectedRoute><IslamLearningPage /></ProtectedRoute>} />
      <Route path="/reminders" element={<RemindersPage />} />
    </Routes>
  );
}

function AppContent() {
  const { theme } = useTheme();
  
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  
  return (
    <div className="min-h-screen bg-background">
      <AppRouter />
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
