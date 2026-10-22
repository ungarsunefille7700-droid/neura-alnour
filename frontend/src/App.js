import { Suspense, lazy, useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import PrayerNotificationManager from "@/components/PrayerNotificationManager";
import { prewarmBackend } from "@/utils/backendWarmup";

// Context
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";

// Pages
import LandingPage from "@/pages/LandingPage";
import AuthPage from "@/pages/AuthPage";
import AuthCallback from "@/pages/AuthCallback";
const ChatPage = lazy(() => import("@/pages/ChatPage"));
const QuranPage = lazy(() => import("@/pages/QuranPage"));
const PrayerTimesPage = lazy(() => import("@/pages/PrayerTimesPage"));
const DuasPage = lazy(() => import("@/pages/DuasPage"));
const QuizPage = lazy(() => import("@/pages/QuizPage"));
const RamadanPage = lazy(() => import("@/pages/RamadanPage"));
const SubscriptionPage = lazy(() => import("@/pages/SubscriptionPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const QiblahPage = lazy(() => import("@/pages/QiblahPage"));
const MosquesPage = lazy(() => import("@/pages/MosquesPage"));
const LearnPage = lazy(() => import("@/pages/LearnPage"));
const SupportPage = lazy(() => import("@/pages/SupportPage"));
const LegalPage = lazy(() => import("@/pages/LegalPage"));
const LanguageTutorPage = lazy(() => import("@/pages/LanguageTutorPage"));
const IslamLearningPage = lazy(() => import("@/pages/IslamLearningPage"));
const MushafPage = lazy(() => import("@/pages/MushafPage"));
const RemindersPage = lazy(() => import("@/pages/RemindersPage"));
const MultiplayerQuizPage = lazy(() => import("@/pages/MultiplayerQuizPage"));
const FounderAdminPage = lazy(() => import("@/pages/FounderAdminPage"));
const GamificationPage = lazy(() => import("@/pages/GamificationPage"));
const NeuraCoConnectPage = lazy(() => import("@/pages/NeuraCoConnectPage"));
import ProtectedRoute from "@/components/ProtectedRoute";

// Each page is loaded the first time it is opened: the home page no longer downloads
// the code of the 20 other pages.
function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background" data-testid="page-loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

// An unknown address shows a way back instead of a blank page.
function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-4 text-center" data-testid="not-found">
      <h1 className="text-2xl font-semibold">Page introuvable</h1>
      <p className="text-muted-foreground">Cette page n'existe pas ou a été déplacée.</p>
      <a href="/" className="rounded-full bg-primary px-5 py-2 text-primary-foreground">Retour à l'accueil</a>
    </div>
  );
}

// App Router - handles OAuth callback detection
function AppRouter() {
  const location = useLocation();
  
  // Check URL fragment for session_id (Google OAuth callback)
  // This must be synchronous to prevent race conditions
  if (location.hash?.includes('session_id=')) {
    return <AuthCallback />;
  }
  
  return (
    <Suspense fallback={<PageLoading />}>
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
      <Route path="/mentions-legales" element={<LegalPage />} />
      <Route path="/confidentialite" element={<LegalPage />} />
      <Route path="/cgu" element={<LegalPage />} />
      <Route path="/cgv" element={<LegalPage />} />
      <Route path="/cookies" element={<LegalPage />} />
      <Route path="/developer" element={<Navigate to="/chat" replace />} />
      <Route path="/language-tutor" element={<ProtectedRoute><LanguageTutorPage /></ProtectedRoute>} />
      <Route path="/islam-learning" element={<IslamLearningPage />} />
      <Route path="/reminders" element={<RemindersPage />} />
      <Route path="/founder-admin" element={<ProtectedRoute><FounderAdminPage /></ProtectedRoute>} />
      <Route path="/rewards" element={<ProtectedRoute><GamificationPage /></ProtectedRoute>} />
      <Route path="/neuraco/connect" element={<NeuraCoConnectPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
  );
}

function AppContent() {
  const { theme } = useTheme();

  useEffect(() => {
    // Keep this request alive during the external Google redirect. Aborting it
    // on unmount leaves a sleeping Render instance cold for the callback.
    prewarmBackend();
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
