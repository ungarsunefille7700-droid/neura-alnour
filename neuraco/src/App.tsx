import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  FolderClosed,
  FolderOpen,
  GitFork,
  Home,
  KeyRound,
  Languages,
  LockKeyhole,
  LogOut,
  Mail,
  PanelLeft,
  Plus,
  Search,
  Send,
  ServerCog,
  ShieldCheck,
  UserRound
} from 'lucide-react';
import type {
  NeuraCoAccessibilitySettings,
  NeuraCoAppInfo,
  NeuraCoAppLockState,
  NeuraCoLoginCredentials,
  NeuraCoRegistration,
  NeuraCoProjectSnapshot,
  NeuraCoSession,
  NeuraCoSelfCheck
} from '../electron/ipc-contract';
import SecuritySettingsPanel, { AppLockScreen } from './SecuritySettingsPanel';
import AccountPanel from './AccountPanel';
const WorkspacePage = lazy(() => import('./WorkspacePage'));
const AdminPanel = lazy(() => import('./AdminPanel'));

type Locale = 'fr' | 'en';
type WorkspaceView = 'home' | 'project' | 'security' | 'accessibility' | 'account' | 'admin';
type HomeChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
};

const GENERAL_CHAT_PROJECT_ID = '000000000000000000000001';
const SESSION_RESTORE_TIMEOUT_MS = 15 * 1000;

const restoreSessionBeforeDeadline = async (
  restore: () => Promise<NeuraCoSession>
): Promise<NeuraCoSession> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      restore(),
      new Promise<NeuraCoSession>((resolve) => {
        timeout = setTimeout(() => resolve({
          status: 'error',
          error: 'La restauration de session a expiré. Vérifiez votre connexion puis réessayez.'
        }), SESSION_RESTORE_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error
        ? error.message
        : 'Impossible de restaurer la session NeuraCo.'
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const DEFAULT_ACCESSIBILITY: NeuraCoAccessibilitySettings = {
  theme: 'system',
  zoomPercent: 100,
  reducedMotion: false,
  highContrast: false
};

const copy = {
  fr: {
    appSubtitle: 'Agent local Windows',
    home: 'Accueil',
    accessibility: 'Accessibilit\u00e9',
    administration: 'Administration',
    accessibilityTitle: 'Accessibilit\u00e9 et affichage',
    accessibilityIntro:
      'Adaptez NeuraCo \u00e0 votre vue, \u00e0 votre clavier et aux pr\u00e9f\u00e9rences Windows.',
    appearance: 'Apparence',
    theme: 'Th\u00e8me',
    themeHelp: 'Suit Windows ou force le mode clair ou sombre.',
    themeSystem: 'Syst\u00e8me',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    zoom: 'Mise \u00e0 l\u2019\u00e9chelle',
    zoomHelp: 'Agrandit toute l\u2019interface, y compris les panneaux \u00e0 taille fixe.',
    reducedMotion: 'R\u00e9duire les animations',
    reducedMotionHelp: 'D\u00e9sactive les transitions et mouvements non essentiels.',
    highContrast: 'Contraste renforc\u00e9',
    highContrastHelp: 'Renforce les bordures, le texte et l\u2019indicateur de focus.',
    keyboardTitle: 'Navigation clavier',
    keyboardHelp:
      'Tab parcourt les contr\u00f4les. Ctrl + ou Ctrl - ajuste le zoom et Ctrl 0 le r\u00e9initialise.',
    skipToContent: 'Aller au contenu principal',
    accessibilitySaved: 'R\u00e9glages appliqu\u00e9s',
    accessibilityError: 'Impossible d\u2019enregistrer les r\u00e9glages d\u2019accessibilit\u00e9.',
    security: 'Sécurité',
    account: 'Compte',
    search: 'Rechercher',
    localSpace: 'Espace local',
    foundation: 'Socle NeuraCo',
    noProject: 'Aucun projet ouvert',
    readyTitle: 'NeuraCo est prêt',
    readyText:
      'NeuraCo est installé, isolé et relié à votre compte Neura Al Nour. Ouvrez un dossier local pour travailler avec l’agent, l’éditeur et le terminal sécurisé.',
    completed: 'Configuration terminée',
    authReady: 'Compte et abonnement vérifiés côté serveur',
    desktopReady: 'Application Windows x64 installable',
    securityReady: 'Interface isolée du système par défaut',
    nextTitle: 'Espace projet disponible',
    nextText:
      'Utilisez “Ouvrir un projet” dans la barre latérale. Les secrets et fichiers sensibles restent exclus du contexte IA.',
    composerPlaceholder: 'Écrivez votre demande...',
    fullAccess: 'Accès protégé',
    securityTitle: 'Sécurité',
    securityIntro:
      'Les protections ci-dessous sont contrôlées directement dans le processus Electron.',
    runCheck: 'Vérifier maintenant',
    checking: 'Vérification...',
    verified: 'Vérifié',
    notChecked: 'Non vérifié',
    contextIsolation: 'Isolation du contexte',
    contextIsolationHelp: 'Sépare l’interface du processus principal Electron.',
    nodeDisabled: 'Accès Node.js désactivé',
    nodeDisabledHelp: 'Le rendu ne peut pas appeler directement le système.',
    sandbox: 'Bac à sable Electron',
    sandboxHelp: 'Limite les capacités du processus d’interface.',
    navigation: 'Navigation externe contrôlée',
    navigationHelp: 'Bloque les ouvertures et redirections non autorisées.',
    appInfo: 'Application',
    version: 'Version',
    platform: 'Système',
    architecture: 'Architecture',
    installed: 'Application installée',
    development: 'Mode développement',
    accountTitle: 'Compte',
    plan: 'Abonnement',
    email: 'Adresse e-mail',
    sessionStorage: 'Protection de session',
    encrypted: 'Chiffrée par Windows',
    browserPreview: 'Aperçu navigateur',
    language: 'Langue',
    signOut: 'Se déconnecter',
    connecting: 'Connexion sécurisée...',
    retrySession: 'Réessayer la connexion',
    signInTitle: 'Connectez-vous à NeuraCo',
    signInText:
      'Utilisez votre compte Neura Al Nour. Le serveur vérifie votre abonnement avant tout accès.',
    password: 'Mot de passe',
    twoFactorCode: 'Code de double authentification',
    forgotPassword: 'Mot de passe oublié ?',
    backToLogin: 'Retour à la connexion',
    resetTitle: 'Réinitialiser le mot de passe',
    resetRequest: 'Recevoir un code',
    resetCode: 'Code reçu par e-mail',
    newPassword: 'Nouveau mot de passe',
    resetConfirm: 'Enregistrer le nouveau mot de passe',
    resetSent: 'Si le compte existe, un code a été envoyé.',
    resetDone: 'Mot de passe modifié. Vous pouvez vous connecter.',
    signIn: 'Se connecter',
    google: 'Continuer avec Google',
    or: 'ou',
    createAccount: 'Créer un compte',
    createAccountTitle: 'Créez votre compte',
    createAccountText: 'Commencez avec Google ou votre adresse e-mail.',
    fullName: 'Nom complet',
    confirmPassword: 'Confirmer le mot de passe',
    passwordMismatch: 'Les mots de passe ne correspondent pas.',
    alreadyRegistered: 'Vous avez déjà un compte ?',
    newToNeuraCo: 'Nouveau sur NeuraCo ?',
    noAccess: 'Accès NeuraCo non actif',
    noAccessText:
      'Un abonnement Plus ou supérieur actif est nécessaire pour utiliser NeuraCo.',
    viewPlans: 'Voir les abonnements',
    previewUser: 'Aperçu local'
  },
  en: {
    appSubtitle: 'Local Windows agent',
    home: 'Home',
    accessibility: 'Accessibility',
    administration: 'Administration',
    accessibilityTitle: 'Accessibility and display',
    accessibilityIntro:
      'Adapt NeuraCo to your vision, keyboard and Windows preferences.',
    appearance: 'Appearance',
    theme: 'Theme',
    themeHelp: 'Follow Windows or force light or dark mode.',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    zoom: 'Interface scale',
    zoomHelp: 'Scales the entire interface, including fixed-size panels.',
    reducedMotion: 'Reduce motion',
    reducedMotionHelp: 'Disables non-essential transitions and movement.',
    highContrast: 'High contrast',
    highContrastHelp: 'Strengthens borders, text and the keyboard focus indicator.',
    keyboardTitle: 'Keyboard navigation',
    keyboardHelp:
      'Tab moves through controls. Ctrl + or Ctrl - changes zoom and Ctrl 0 resets it.',
    skipToContent: 'Skip to main content',
    accessibilitySaved: 'Settings applied',
    accessibilityError: 'Unable to save accessibility settings.',
    security: 'Security',
    account: 'Account',
    search: 'Search',
    localSpace: 'Local workspace',
    foundation: 'NeuraCo foundation',
    noProject: 'No project open',
    readyTitle: 'NeuraCo is ready',
    readyText:
      'NeuraCo is installed, isolated and connected to your Neura Al Nour account. Open a local folder to use the agent, editor and secure terminal.',
    completed: 'Setup complete',
    authReady: 'Account and subscription verified by the server',
    desktopReady: 'Installable Windows x64 application',
    securityReady: 'Interface isolated from the system by default',
    nextTitle: 'Project workspace available',
    nextText:
      'Use “Open a project” in the sidebar. Secrets and sensitive files remain excluded from AI context.',
    composerPlaceholder: 'Write your request...',
    fullAccess: 'Protected access',
    securityTitle: 'Security',
    securityIntro:
      'The protections below are checked directly inside the Electron process.',
    runCheck: 'Check now',
    checking: 'Checking...',
    verified: 'Verified',
    notChecked: 'Not checked',
    contextIsolation: 'Context isolation',
    contextIsolationHelp: 'Separates the interface from the Electron main process.',
    nodeDisabled: 'Node.js access disabled',
    nodeDisabledHelp: 'The renderer cannot call the operating system directly.',
    sandbox: 'Electron sandbox',
    sandboxHelp: 'Restricts the interface process capabilities.',
    navigation: 'Controlled external navigation',
    navigationHelp: 'Blocks unauthorized windows and redirects.',
    appInfo: 'Application',
    version: 'Version',
    platform: 'System',
    architecture: 'Architecture',
    installed: 'Installed application',
    development: 'Development mode',
    accountTitle: 'Account',
    plan: 'Plan',
    email: 'Email address',
    sessionStorage: 'Session protection',
    encrypted: 'Encrypted by Windows',
    browserPreview: 'Browser preview',
    language: 'Language',
    signOut: 'Sign out',
    connecting: 'Secure sign-in...',
    retrySession: 'Retry connection',
    signInTitle: 'Sign in to NeuraCo',
    signInText:
      'Use your Neura Al Nour account. The server checks your plan before granting access.',
    password: 'Password',
    twoFactorCode: 'Two-factor authentication code',
    forgotPassword: 'Forgot password?',
    backToLogin: 'Back to sign in',
    resetTitle: 'Reset your password',
    resetRequest: 'Receive a code',
    resetCode: 'Code received by email',
    newPassword: 'New password',
    resetConfirm: 'Save new password',
    resetSent: 'If the account exists, a code was sent.',
    resetDone: 'Password changed. You can sign in.',
    signIn: 'Sign in',
    google: 'Continue with Google',
    or: 'or',
    createAccount: 'Create an account',
    createAccountTitle: 'Create your account',
    createAccountText: 'Continue with Google or use your email address.',
    fullName: 'Full name',
    confirmPassword: 'Confirm password',
    passwordMismatch: 'The passwords do not match.',
    alreadyRegistered: 'Already have an account?',
    newToNeuraCo: 'New to NeuraCo?',
    noAccess: 'NeuraCo access inactive',
    noAccessText:
      'An active Plus or higher plan is required to use NeuraCo.',
    viewPlans: 'View plans',
    previewUser: 'Local preview'
  }
} as const;

const browserInfo: NeuraCoAppInfo = {
  name: 'NeuraCo',
  version: '1.0.1',
  platform: 'web',
  architecture: '-',
  packaged: false
};

interface AuthScreenProps {
  locale: Locale;
  session: NeuraCoSession | null;
  busy: boolean;
  onLocaleChange: (locale: Locale) => void;
  onLogin: (credentials: NeuraCoLoginCredentials) => Promise<void>;
  onRegister: (registration: NeuraCoRegistration) => Promise<void>;
  onGoogle: () => Promise<void>;
  onLogout: () => Promise<void>;
  onRetrySession: () => Promise<void>;
}

const AuthScreen = ({
  locale,
  session,
  busy,
  onLocaleChange,
  onLogin,
  onRegister,
  onGoogle,
  onLogout,
  onRetrySession
}: AuthScreenProps) => {
  const text = copy[locale];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetNotice, setResetNotice] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const denied = session?.status === 'denied';

  const requestReset = async () => {
    if (!window.neuraco || !email.trim()) return;
    setResetBusy(true);
    setResetError('');
    setResetNotice('');
    try {
      await window.neuraco.requestPasswordReset(email.trim());
      setResetSent(true);
      setResetNotice(text.resetSent);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'Action impossible.');
    } finally {
      setResetBusy(false);
    }
  };

  const confirmReset = async () => {
    if (!window.neuraco) return;
    setResetBusy(true);
    setResetError('');
    setResetNotice('');
    try {
      await window.neuraco.confirmPasswordReset(
        email.trim(),
        resetToken.trim(),
        newPassword
      );
      setResetNotice(text.resetDone);
      setPassword('');
      setResetToken('');
      setNewPassword('');
      setResetSent(false);
      setResetMode(false);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'Action impossible.');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <header className="auth-header">
        <div className="brand-lockup">
          <img src="./neuraco-logo.png" alt="" />
          <div>
            <strong>NeuraCo</strong>
            <span>{text.appSubtitle}</span>
          </div>
        </div>
        <div className="language-switch" aria-label={text.language}>
          <Languages size={16} aria-hidden="true" />
          <button
            type="button"
            className={locale === 'fr' ? 'is-active' : ''}
            onClick={() => onLocaleChange('fr')}
          >
            FR
          </button>
          <button
            type="button"
            className={locale === 'en' ? 'is-active' : ''}
            onClick={() => onLocaleChange('en')}
          >
            EN
          </button>
        </div>
      </header>

      <section className="auth-dialog">
        <img src="./neuraco-logo.png" alt="NeuraCo" className="auth-logo" />
        {!session ? (
          <>
            <h1>{text.connecting}</h1>
            <div className="auth-loader" aria-label={text.connecting} />
          </>
        ) : denied ? (
          <>
            <p className="section-label">{session.entitlement?.plan || 'Free'}</p>
            <h1>{text.noAccess}</h1>
            <p>{text.noAccessText}</p>
            <div className="auth-actions">
              <a
                href="https://neura-alnour.vercel.app/subscription"
                target="_blank"
                rel="noreferrer"
                className="button button-primary"
              >
                {text.viewPlans}
              </a>
              <button className="button button-secondary" type="button" onClick={onLogout}>
                {text.signOut}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>
              {resetMode
                ? text.resetTitle
                : authMode === 'register'
                  ? text.createAccountTitle
                  : text.signInTitle}
            </h1>
            <p>
              {resetMode
                ? text.resetSent
                : authMode === 'register'
                  ? text.createAccountText
                  : text.signInText}
            </p>
            {!resetMode && (
              <p className="auth-mode-switch">
                <span>
                  {authMode === 'register' ? text.alreadyRegistered : text.newToNeuraCo}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode(authMode === 'register' ? 'login' : 'register');
                    setFormError('');
                    setConfirmPassword('');
                  }}
                >
                  {authMode === 'register' ? text.signIn : text.createAccount}
                </button>
              </p>
            )}
            {!resetMode && (
              <>
                <button
                  className="button button-google button-full auth-google-primary"
                  type="button"
                  onClick={() => void onGoogle()}
                  disabled={busy}
                >
                  <span className="google-mark" aria-hidden="true">G</span>
                  {text.google}
                </button>
                <div className="auth-divider"><span>{text.or}</span></div>
              </>
            )}
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                setFormError('');
                if (resetMode) {
                  void (resetSent ? confirmReset() : requestReset());
                  return;
                }
                if (authMode === 'register') {
                  if (password !== confirmPassword) {
                    setFormError(text.passwordMismatch);
                    return;
                  }
                  void onRegister({ name, email, password });
                  return;
                }
                void onLogin({ email, password, twoFactorCode });
              }}
            >
              {!resetMode && authMode === 'register' && (
                <label>
                  <span>{text.fullName}</span>
                  <span className="input-shell">
                    <UserRound size={17} aria-hidden="true" />
                    <input
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      minLength={2}
                      maxLength={120}
                      required
                    />
                  </span>
                </label>
              )}
              <label>
                <span>{text.email}</span>
                <span className="input-shell">
                  <Mail size={17} aria-hidden="true" />
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </span>
              </label>
              {!resetMode && (
                <label>
                  <span>{text.password}</span>
                  <span className="input-shell">
                    <KeyRound size={17} aria-hidden="true" />
                    <input
                      type="password"
                      autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      minLength={authMode === 'register' ? 8 : 6}
                      required
                    />
                  </span>
                </label>
              )}
              {!resetMode && authMode === 'register' && (
                <label>
                  <span>{text.confirmPassword}</span>
                  <span className="input-shell">
                    <KeyRound size={17} aria-hidden="true" />
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      minLength={8}
                      required
                    />
                  </span>
                </label>
              )}
              {!resetMode && authMode === 'login' && session.requiresTwoFactor && (
                <label>
                  <span>{text.twoFactorCode}</span>
                  <span className="input-shell">
                    <ShieldCheck size={17} aria-hidden="true" />
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={twoFactorCode}
                      onChange={(event) => setTwoFactorCode(event.target.value)}
                      minLength={6}
                      required
                    />
                  </span>
                </label>
              )}
              {resetMode && resetSent && (
                <>
                  <label>
                    <span>{text.resetCode}</span>
                    <span className="input-shell">
                      <Mail size={17} aria-hidden="true" />
                      <input
                        value={resetToken}
                        onChange={(event) => setResetToken(event.target.value)}
                        minLength={8}
                        required
                      />
                    </span>
                  </label>
                  <label>
                    <span>{text.newPassword}</span>
                    <span className="input-shell">
                      <KeyRound size={17} aria-hidden="true" />
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        minLength={8}
                        required
                      />
                    </span>
                  </label>
                </>
              )}
              {!resetMode && session.status === 'error' && (
                <>
                  <p className="auth-error" role="alert">{session.error}</p>
                  <button
                    className="button button-secondary button-full"
                    type="button"
                    onClick={() => void onRetrySession()}
                    disabled={busy}
                  >
                    {text.retrySession}
                  </button>
                </>
              )}
              {formError && <p className="auth-error" role="alert">{formError}</p>}
              {resetError && <p className="auth-error" role="alert">{resetError}</p>}
              {resetNotice && <p className="auth-notice" role="status">{resetNotice}</p>}
              <button
                className="button button-primary button-full"
                type="submit"
                disabled={busy || resetBusy}
              >
                {resetMode
                  ? (resetSent ? text.resetConfirm : text.resetRequest)
                  : (busy
                    ? text.connecting
                    : authMode === 'register'
                      ? text.createAccount
                      : text.signIn)}
              </button>
              {(resetMode || authMode === 'login') && (
                <button
                  className="auth-link-button"
                  type="button"
                  onClick={() => {
                    setResetMode(!resetMode);
                    setResetError('');
                    setResetNotice('');
                    setFormError('');
                  }}
                >
                  {resetMode ? text.backToLogin : text.forgotPassword}
                </button>
              )}
            </form>
          </>
        )}
      </section>
    </main>
  );
};

interface ActionableErrorDetails {
  message: string;
  reason: string;
  correction: string;
  credits: string;
  changes: string;
}

const ActionableError = ({ error }: { error: ActionableErrorDetails }) => (
  <section className="global-error actionable-error" role="alert" aria-live="assertive">
    <strong>{error.message}</strong>
    <dl>
      <div><dt>Pourquoi</dt><dd>{error.reason}</dd></div>
      <div><dt>Comment corriger</dt><dd>{error.correction}</dd></div>
      <div><dt>Cr\u00e9dits consomm\u00e9s</dt><dd>{error.credits}</dd></div>
      <div><dt>Changements appliqu\u00e9s</dt><dd>{error.changes}</dd></div>
    </dl>
  </section>
);

interface SidebarProps {
  locale: Locale;
  view: WorkspaceView;
  session: NeuraCoSession | null;
  projectSnapshot: NeuraCoProjectSnapshot | null;
  desktopAvailable: boolean;
  onViewChange: (view: WorkspaceView) => void;
  onOpenProject: () => Promise<void>;
  onCreateProject: () => void;
  onCloneProject: () => void;
  onLocaleChange: (locale: Locale) => void;
  onLogout: () => void;
}

const Sidebar = ({
  locale,
  view,
  session,
  projectSnapshot,
  desktopAvailable,
  onViewChange,
  onOpenProject,
  onCreateProject,
  onCloneProject,
  onLocaleChange,
  onLogout
}: SidebarProps) => {
  const text = copy[locale];
  const name = session?.user?.name || text.previewUser;
  const plan = session?.entitlement?.plan || text.browserPreview;
  const initial = name.trim().charAt(0).toUpperCase() || 'N';

  return (
    <aside className="sidebar" aria-label="Navigation NeuraCo">
      <div className="sidebar-brand">
        <img src="./neuraco-logo.png" alt="" />
        <strong>NeuraCo</strong>
        <ChevronDown size={15} aria-hidden="true" />
      </div>

      <button className="sidebar-search" type="button" disabled>
        <Search size={17} aria-hidden="true" />
        <span>{text.search}</span>
      </button>

      <nav className="primary-nav" aria-label="Navigation principale">
        <button
          type="button"
          className={view === 'home' ? 'is-active' : ''}
          aria-current={view === 'home' ? 'page' : undefined}
          onClick={() => onViewChange('home')}
          title={text.home}
        >
          <Home size={18} aria-hidden="true" />
          <span>{text.home}</span>
        </button>
        <button
          type="button"
          className={view === 'security' ? 'is-active' : ''}
          aria-current={view === 'security' ? 'page' : undefined}
          onClick={() => onViewChange('security')}
          title={text.security}
        >
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{text.security}</span>
        </button>
        <button
          type="button"
          className={view === 'account' ? 'is-active' : ''}
          aria-current={view === 'account' ? 'page' : undefined}
          onClick={() => onViewChange('account')}
          title={text.account}
        >
          <UserRound size={18} aria-hidden="true" />
          <span>{text.account}</span>
        </button>
        <button
          type="button"
          className={view === 'accessibility' ? 'is-active' : ''}
          aria-current={view === 'accessibility' ? 'page' : undefined}
          onClick={() => onViewChange('accessibility')}
          title={text.accessibility}
        >
          <Accessibility size={18} aria-hidden="true" />
          <span>{text.accessibility}</span>
        </button>
        {session?.user?.is_vip && (
          <button
            type="button"
            className={view === 'admin' ? 'is-active' : ''}
            aria-current={view === 'admin' ? 'page' : undefined}
            onClick={() => onViewChange('admin')}
            title={text.administration}
          >
            <ServerCog size={18} aria-hidden="true" />
            <span>{text.administration}</span>
          </button>
        )}
      </nav>

      <div className="sidebar-section">
        <span>{text.localSpace}</span>
        {projectSnapshot ? (
          <button
            className={`workspace-item ${view === 'project' ? 'is-active' : ''}`}
            type="button"
            onClick={() => onViewChange('project')}
            title={projectSnapshot.project.rootPath}
          >
            <FolderOpen size={17} aria-hidden="true" />
            <span>
              <strong>{projectSnapshot.project.name}</strong>
              <small>{projectSnapshot.indexedFiles} fichiers indexés</small>
            </span>
          </button>
        ) : (
          <button
            className="workspace-item"
            type="button"
            onClick={() => void onOpenProject()}
            disabled={!desktopAvailable}
            title={desktopAvailable ? 'Ouvrir un dossier local' : text.browserPreview}
          >
            <FolderClosed size={17} aria-hidden="true" />
            <span>
              <strong>Ouvrir un projet</strong>
              <small>{text.noProject}</small>
            </span>
          </button>
        )}
        {projectSnapshot && (
          <button
            className="open-project-button"
            type="button"
            onClick={() => void onOpenProject()}
          >
            <Plus size={14} aria-hidden="true" />
            Changer de projet
          </button>
        )}
        <button
          className="open-project-button"
          type="button"
          onClick={onCreateProject}
          disabled={!desktopAvailable}
        >
          <Plus size={14} aria-hidden="true" />
          {'Cr\u00e9er un nouveau projet'}
        </button>
        <button
          className="open-project-button"
          type="button"
          onClick={onCloneProject}
          disabled={!desktopAvailable}
        >
          <GitFork size={14} aria-hidden="true" />
          {'Cloner un d\u00e9p\u00f4t Git'}
        </button>
      </div>

      <div className="sidebar-account">
        <div className="account-avatar">{initial}</div>
        <button type="button" onClick={() => onViewChange('account')}>
          <strong>{name}</strong>
          <span>{plan}</span>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onLogout}
          title={text.signOut}
          disabled={!session?.user}
        >
          <LogOut size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="sidebar-language" aria-label={text.language}>
        <Languages size={15} aria-hidden="true" />
        <button
          type="button"
          className={locale === 'fr' ? 'is-active' : ''}
          onClick={() => onLocaleChange('fr')}
        >
          FR
        </button>
        <button
          type="button"
          className={locale === 'en' ? 'is-active' : ''}
          onClick={() => onLocaleChange('en')}
        >
          EN
        </button>
      </div>
    </aside>
  );
};

const StatusRow = ({
  title,
  description,
  valid,
  checkedLabel,
  uncheckedLabel
}: {
  title: string;
  description: string;
  valid?: boolean;
  checkedLabel: string;
  uncheckedLabel: string;
}) => (
  <li className="settings-row">
    <div>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
    <span className={`status-badge ${valid ? 'is-valid' : ''}`}>
      {valid ? <Check size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
      {valid ? checkedLabel : uncheckedLabel}
    </span>
  </li>
);

function App() {
  const [locale, setLocale] = useState<Locale>('fr');
  const [view, setView] = useState<WorkspaceView>('home');
  const [appInfo, setAppInfo] = useState<NeuraCoAppInfo>(browserInfo);
  const [selfCheck, setSelfCheck] = useState<NeuraCoSelfCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [projectSnapshot, setProjectSnapshot] = useState<NeuraCoProjectSnapshot | null>(null);
  const [projectError, setProjectError] = useState<ActionableErrorDetails | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [createProjectBusy, setCreateProjectBusy] = useState(false);
  const [createProjectError, setCreateProjectError] = useState('');
  const [cloneProjectOpen, setCloneProjectOpen] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [cloneProjectBusy, setCloneProjectBusy] = useState(false);
  const [cloneProjectError, setCloneProjectError] = useState('');
  const [accessibility, setAccessibility] = useState<NeuraCoAccessibilitySettings>(
    DEFAULT_ACCESSIBILITY
  );
  const [accessibilityNotice, setAccessibilityNotice] = useState('');
  const desktopAvailable = Boolean(window.neuraco);
  const [session, setSession] = useState<NeuraCoSession | null>(
    desktopAvailable ? null : { status: 'authenticated' }
  );
  const [authBusy, setAuthBusy] = useState(false);
  const [homeInput, setHomeInput] = useState('');
  const [homeMessages, setHomeMessages] = useState<HomeChatMessage[]>([]);
  const [homeChatBusy, setHomeChatBusy] = useState(false);
  const [homeSessionId, setHomeSessionId] = useState<string | undefined>();
  const [appLockState, setAppLockState] = useState<NeuraCoAppLockState | null>(
    desktopAvailable ? null : {
      configured: false,
      locked: false,
      pinEnabled: false,
      windowsHelloEnabled: false,
      windowsHelloAvailability: 'not_supported',
      lockOnStartup: false,
      idleTimeoutMinutes: 0,
      maskSensitiveNotifications: true,
      storageAvailable: false,
      failedAttempts: 0
    }
  );
  const text = copy[locale];

  useEffect(() => {
    let active = true;
    window.neuraco?.getAppInfo().then((info) => {
      if (active) setAppInfo(info);
    }).catch(() => {
      if (active) setAppInfo(browserInfo);
    });
    const desktop = window.neuraco;
    if (desktop) restoreSessionBeforeDeadline(() => desktop.restoreSession()).then((restored) => {
      if (active) setSession(restored);
    }).catch(() => {
      if (active) {
        setSession({
          status: 'error',
          error: 'Impossible de restaurer la session NeuraCo.'
        });
      }
    });
    window.neuraco?.getAppLockState().then((state) => {
      if (active) setAppLockState(state);
    }).catch(() => {
      if (active) {
        setAppLockState({
          configured: false,
          locked: false,
          pinEnabled: false,
          windowsHelloEnabled: false,
          windowsHelloAvailability: 'unknown',
          lockOnStartup: false,
          idleTimeoutMinutes: 0,
          maskSensitiveNotifications: true,
          storageAvailable: false,
          failedAttempts: 0
        });
      }
    });
    window.neuraco?.getAccessibilitySettings?.().then((settings) => {
      if (active) setAccessibility(settings);
    }).catch(() => {
      if (active) setAccessibilityNotice(copy.fr.accessibilityError);
    });
    const unsubscribeLock = window.neuraco?.onAppLockEvent((state) => {
      if (active) setAppLockState(state);
    });
    const unsubscribeSession = window.neuraco?.onSessionEvent((nextSession) => {
      if (active) setSession(nextSession);
    });
    return () => {
      active = false;
      unsubscribeLock?.();
      unsubscribeSession?.();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = accessibility.theme === 'system'
        ? (colorScheme?.matches ? 'dark' : 'light')
        : accessibility.theme;
      root.dataset.theme = theme;
      root.dataset.highContrast = String(accessibility.highContrast);
      root.dataset.reducedMotion = String(accessibility.reducedMotion);
    };
    apply();
    colorScheme?.addEventListener?.('change', apply);
    return () => colorScheme?.removeEventListener?.('change', apply);
  }, [accessibility]);

  const updateAccessibility = async (
    update: Partial<NeuraCoAccessibilitySettings>
  ) => {
    const optimistic = { ...accessibility, ...update };
    setAccessibility(optimistic);
    setAccessibilityNotice(text.accessibilitySaved);
    if (!window.neuraco?.updateAccessibilitySettings) return;
    try {
      setAccessibility(await window.neuraco.updateAccessibilitySettings(update));
    } catch {
      setAccessibilityNotice(text.accessibilityError);
    }
  };

  useEffect(() => {
    const levels = [90, 100, 110, 125, 150];
    const handleZoomShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const currentIndex = levels.indexOf(accessibility.zoomPercent);
      let next: number | undefined;
      if (event.key === '0') next = 100;
      if (event.key === '+' || event.key === '=') {
        next = levels[Math.min(levels.length - 1, Math.max(0, currentIndex) + 1)];
      }
      if (event.key === '-') {
        next = levels[Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1)];
      }
      if (!next) return;
      event.preventDefault();
      void updateAccessibility({ zoomPercent: next });
    };
    window.addEventListener('keydown', handleZoomShortcut);
    return () => window.removeEventListener('keydown', handleZoomShortcut);
  }, [accessibility]);

  const protections = useMemo(
    () => [
      {
        title: text.contextIsolation,
        description: text.contextIsolationHelp,
        valid: selfCheck?.checks.contextIsolation
      },
      {
        title: text.nodeDisabled,
        description: text.nodeDisabledHelp,
        valid: selfCheck?.checks.nodeIntegrationDisabled
      },
      {
        title: text.sandbox,
        description: text.sandboxHelp,
        valid: selfCheck?.checks.sandboxEnabled
      },
      {
        title: text.navigation,
        description: text.navigationHelp,
        valid: selfCheck?.checks.navigationGuardEnabled
      }
    ],
    [selfCheck, text]
  );

  const runSelfCheck = async () => {
    if (!window.neuraco) return;
    setChecking(true);
    try {
      setSelfCheck(await window.neuraco.runSelfCheck());
    } finally {
      setChecking(false);
    }
  };

  const runAuthAction = async (action: () => Promise<NeuraCoSession>) => {
    setAuthBusy(true);
    try {
      const nextSession = await action();
      setSession(nextSession);
      if (nextSession.status === 'authenticated' && window.neuraco) {
        setAppLockState(await window.neuraco.getAppLockState());
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const openProject = async () => {
    if (!window.neuraco) return;
    setProjectError(null);
    try {
      const snapshot = await window.neuraco.openProject();
      if (snapshot) {
        setProjectSnapshot(snapshot);
        setView('project');
      }
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : 'Le système n’a fourni aucun détail technique.';
      setProjectError({
        message: 'Le projet n’a pas pu être ouvert.',
        reason,
        correction:
          'Vérifiez que le dossier existe et que Windows autorise sa lecture, puis réessayez.',
        credits: 'Aucun crédit IA',
        changes: 'Aucun fichier modifié'
      });
    }
  };

  const refreshProject = async () => {
    if (!window.neuraco) return;
    const snapshot = await window.neuraco.refreshProject();
    if (snapshot) setProjectSnapshot(snapshot);
  };

  const createProject = async () => {
    if (!window.neuraco || !newProjectName.trim() || createProjectBusy) return;
    setCreateProjectBusy(true);
    setCreateProjectError('');
    setProjectError(null);
    try {
      const snapshot = await window.neuraco.createProject(newProjectName.trim());
      if (snapshot) {
        setProjectSnapshot(snapshot);
        setView('project');
        setCreateProjectOpen(false);
        setNewProjectName('');
      }
    } catch (error) {
      setCreateProjectError(
        error instanceof Error ? error.message : 'Le projet n\u2019a pas pu \u00eatre cr\u00e9\u00e9.'
      );
    } finally {
      setCreateProjectBusy(false);
    }
  };

  const cloneProject = async () => {
    if (!window.neuraco || !repositoryUrl.trim() || cloneProjectBusy) return;
    setCloneProjectBusy(true);
    setCloneProjectError('');
    setProjectError(null);
    try {
      const snapshot = await window.neuraco.cloneProject(repositoryUrl.trim());
      if (snapshot) {
        setProjectSnapshot(snapshot);
        setView('project');
        setCloneProjectOpen(false);
        setRepositoryUrl('');
      }
    } catch (error) {
      setCloneProjectError(
        error instanceof Error ? error.message : 'Le d\u00e9p\u00f4t n\u2019a pas pu \u00eatre clon\u00e9.'
      );
    } finally {
      setCloneProjectBusy(false);
    }
  };

  const sendHomeMessage = async () => {
    const content = homeInput.trim();
    if (!window.neuraco || !content || homeChatBusy) return;

    const userMessage: HomeChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content
    };
    const conversationContext = homeMessages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-20)
      .map((message) => ({
        id: message.id,
        role: message.role as 'user' | 'assistant',
        content: message.content
      }));

    setHomeInput('');
    setHomeMessages((current) => [...current, userMessage]);
    setHomeChatBusy(true);
    try {
      const response = await window.neuraco.sendAgentMessage({
        content,
        sessionId: homeSessionId,
        requestId: crypto.randomUUID(),
        scope: 'general',
        projectId: GENERAL_CHAT_PROJECT_ID,
        projectName: locale === 'fr' ? 'Conversation générale' : 'General conversation',
        mode: 'question',
        model: 'auto',
        conversationContext,
        files: [],
        images: []
      });
      setHomeSessionId(response.sessionId);
      setHomeMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.message,
          model: `${response.modelDisplay} · ${response.provider}`
        }
      ]);
    } catch (error) {
      setHomeMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'system',
          content: error instanceof Error
            ? error.message
            : locale === 'fr'
              ? 'La réponse IA n’a pas pu être récupérée.'
              : 'The AI response could not be retrieved.'
        }
      ]);
    } finally {
      setHomeChatBusy(false);
    }
  };

  if (desktopAvailable && session?.status !== 'authenticated') {
    return (
      <AuthScreen
        locale={locale}
        session={session}
        busy={authBusy}
        onLocaleChange={setLocale}
        onLogin={(credentials) => runAuthAction(() => window.neuraco!.login(credentials))}
        onRegister={(registration) => runAuthAction(() => window.neuraco!.register(registration))}
        onGoogle={() => runAuthAction(() => window.neuraco!.loginWithGoogle())}
        onLogout={() => runAuthAction(() => window.neuraco!.logout())}
        onRetrySession={() => runAuthAction(
          () => restoreSessionBeforeDeadline(() => window.neuraco!.restoreSession())
        )}
      />
    );
  }

  if (desktopAvailable && !appLockState) {
    return (
      <main className="app-lock-shell">
        <section className="app-lock-dialog">
          <div className="auth-loader" aria-label="Chargement de la sécurité" />
          <h1>Chargement de la sécurité…</h1>
        </section>
      </main>
    );
  }

  if (desktopAvailable && appLockState?.locked) {
    return (
      <AppLockScreen
        state={appLockState}
        onState={setAppLockState}
        onLogout={() => runAuthAction(() => window.neuraco!.logout())}
      />
    );
  }

  const renderHome = () => (
    <div className="thread-view">
      {homeMessages.length > 0 ? (
        <div className="home-chat-thread" aria-live="polite">
          {homeMessages.map((message) => (
            <article key={message.id} className={`home-chat-message is-${message.role}`}>
              <header>
                <strong>
                  {message.role === 'user'
                    ? session?.user?.name || (locale === 'fr' ? 'Vous' : 'You')
                    : message.role === 'assistant'
                      ? 'NeuraCo'
                      : locale === 'fr' ? 'Système' : 'System'}
                </strong>
                {message.model && <span>{message.model}</span>}
              </header>
              <p>{message.content}</p>
            </article>
          ))}
          {homeChatBusy && (
            <div className="home-chat-thinking" role="status">
              {locale === 'fr' ? 'NeuraCo réfléchit…' : 'NeuraCo is thinking…'}
            </div>
          )}
        </div>
      ) : (
        <>
      <div className="thread-activity">
        <span className="activity-icon"><CheckCircle2 size={16} aria-hidden="true" /></span>
        <span>{text.completed}</span>
      </div>

      <section className="thread-message">
        <div className="message-author">
          <img src="./neuraco-logo.png" alt="" />
          <strong>NeuraCo</strong>
        </div>
        <h1>{text.readyTitle}</h1>
        <p>{text.readyText}</p>
        <ul className="completion-list">
          <li><CheckCircle2 size={17} aria-hidden="true" />{text.authReady}</li>
          <li><CheckCircle2 size={17} aria-hidden="true" />{text.desktopReady}</li>
          <li><CheckCircle2 size={17} aria-hidden="true" />{text.securityReady}</li>
        </ul>
      </section>

      <section className="next-step">
        <span>{text.nextTitle}</span>
        <p>{text.nextText}</p>
      </section>
        </>
      )}
    </div>
  );

  const renderSecurity = () => (
    <div className="settings-page">
      <header className="settings-heading">
        <div>
          <h1>{text.securityTitle}</h1>
          <p>{text.securityIntro}</p>
        </div>
        <button
          className="button button-primary"
          type="button"
          onClick={runSelfCheck}
          disabled={!desktopAvailable || checking}
        >
          <ShieldCheck size={17} aria-hidden="true" />
          {checking ? text.checking : text.runCheck}
        </button>
      </header>

      <section className="settings-group">
        <h2>{text.security}</h2>
        <ul className="settings-list">
          {protections.map((protection) => (
            <StatusRow
              key={protection.title}
              {...protection}
              checkedLabel={text.verified}
              uncheckedLabel={text.notChecked}
            />
          ))}
        </ul>
      </section>

      {appLockState && (
        <SecuritySettingsPanel
          state={appLockState}
          onState={setAppLockState}
        />
      )}

      <section className="settings-group">
        <h2>{text.appInfo}</h2>
        <div className="information-list">
          <div><span>{text.version}</span><strong>{appInfo.version}</strong></div>
          <div><span>{text.platform}</span><strong>{appInfo.platform}</strong></div>
          <div><span>{text.architecture}</span><strong>{appInfo.architecture}</strong></div>
          <div>
            <span>{appInfo.packaged ? text.installed : text.development}</span>
            <strong>{appInfo.packaged ? 'Oui' : 'Local'}</strong>
          </div>
        </div>
      </section>
    </div>
  );

  const renderAccount = () => (
    session?.status === 'authenticated'
      ? (
        <AccountPanel
          locale={locale}
          session={session}
          onLogout={() => runAuthAction(() => window.neuraco!.logout())}
        />
      )
      : null
  );

  const renderAccessibility = () => (
    <div className="settings-page accessibility-page">
      <header className="settings-heading">
        <div>
          <h1>{text.accessibilityTitle}</h1>
          <p>{text.accessibilityIntro}</p>
        </div>
      </header>

      <section className="settings-group" aria-labelledby="appearance-title">
        <h2 id="appearance-title">{text.appearance}</h2>
        <div className="accessibility-settings-list">
          <label className="accessibility-setting-row">
            <span><strong>{text.theme}</strong><small>{text.themeHelp}</small></span>
            <select
              aria-label={text.theme}
              value={accessibility.theme}
              onChange={(event) => void updateAccessibility({
                theme: event.target.value as NeuraCoAccessibilitySettings['theme']
              })}
            >
              <option value="system">{text.themeSystem}</option>
              <option value="light">{text.themeLight}</option>
              <option value="dark">{text.themeDark}</option>
            </select>
          </label>
          <label className="accessibility-setting-row">
            <span><strong>{text.zoom}</strong><small>{text.zoomHelp}</small></span>
            <select
              aria-label={text.zoom}
              value={accessibility.zoomPercent}
              onChange={(event) => void updateAccessibility({
                zoomPercent: Number(event.target.value)
              })}
            >
              {[90, 100, 110, 125, 150].map((level) => (
                <option key={level} value={level}>{level} %</option>
              ))}
            </select>
          </label>
          <label className="accessibility-setting-row">
            <span>
              <strong>{text.reducedMotion}</strong>
              <small>{text.reducedMotionHelp}</small>
            </span>
            <input
              className="setting-toggle"
              type="checkbox"
              checked={accessibility.reducedMotion}
              onChange={(event) => void updateAccessibility({
                reducedMotion: event.target.checked
              })}
            />
          </label>
          <label className="accessibility-setting-row">
            <span><strong>{text.highContrast}</strong><small>{text.highContrastHelp}</small></span>
            <input
              className="setting-toggle"
              type="checkbox"
              checked={accessibility.highContrast}
              onChange={(event) => void updateAccessibility({
                highContrast: event.target.checked
              })}
            />
          </label>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="keyboard-title">
        <h2 id="keyboard-title">{text.keyboardTitle}</h2>
        <p className="accessibility-keyboard-help">{text.keyboardHelp}</p>
      </section>
      {accessibilityNotice && (
        <p
          className={accessibilityNotice === text.accessibilityError
            ? 'account-feedback is-error'
            : 'account-feedback'}
          role={accessibilityNotice === text.accessibilityError ? 'alert' : 'status'}
        >
          {accessibilityNotice}
        </p>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{text.skipToContent}</a>
      <Sidebar
        locale={locale}
        view={view}
        session={session}
        projectSnapshot={projectSnapshot}
        desktopAvailable={desktopAvailable}
        onViewChange={setView}
        onOpenProject={openProject}
        onCreateProject={() => {
          setCreateProjectError('');
          setCreateProjectOpen(true);
        }}
        onCloneProject={() => {
          setCloneProjectError('');
          setCloneProjectOpen(true);
        }}
        onLocaleChange={setLocale}
        onLogout={() => {
          if (window.neuraco && session?.user) {
            void runAuthAction(() => window.neuraco!.logout());
          }
        }}
      />

      <main className="workspace" id="main-content" tabIndex={-1}>
        <header className="workspace-header">
          <div>
            <PanelLeft size={18} aria-hidden="true" />
            <FolderClosed size={17} aria-hidden="true" />
            <strong>
              {view === 'home'
                ? text.foundation
                : view === 'project'
                  ? projectSnapshot?.project.name || text.noProject
                : view === 'security'
                  ? text.security
                : view === 'accessibility'
                  ? text.accessibility
                : view === 'admin'
                  ? text.administration
                  : text.account}
            </strong>
          </div>
          <div className="workspace-status">
            <LockKeyhole size={15} aria-hidden="true" />
            {text.fullAccess}
          </div>
        </header>

        <div className={`workspace-scroll ${view === 'project' ? 'is-project' : ''}`}>
          {projectError && <ActionableError error={projectError} />}
          {view === 'home' && renderHome()}
          {view === 'project' && projectSnapshot && (
            <Suspense fallback={<div className="workspace-loading">Chargement de l’éditeur…</div>}>
              <WorkspacePage
                snapshot={projectSnapshot}
                onRefresh={refreshProject}
                onOpenProject={openProject}
              />
            </Suspense>
          )}
          {view === 'security' && renderSecurity()}
          {view === 'accessibility' && renderAccessibility()}
          {view === 'account' && renderAccount()}
          {view === 'admin' && session?.user?.is_vip && (
            <Suspense fallback={<div className="workspace-loading">Chargement de l’administration…</div>}>
              <AdminPanel />
            </Suspense>
          )}
        </div>

        {view === 'home' && (
          <footer className="composer-wrap">
            <form
              className={`composer ${!desktopAvailable ? 'is-disabled' : ''}`}
              aria-disabled={!desktopAvailable}
              onSubmit={(event) => {
                event.preventDefault();
                void sendHomeMessage();
              }}
            >
              <textarea
                value={homeInput}
                disabled={!desktopAvailable || homeChatBusy}
                aria-label={text.composerPlaceholder}
                placeholder={text.composerPlaceholder}
                onChange={(event) => setHomeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendHomeMessage();
                  }
                }}
              />
              <div className="composer-footer">
                <button
                  type="button"
                  className="icon-button"
                  disabled={!desktopAvailable || homeChatBusy}
                  title={locale === 'fr' ? 'Ouvrir un projet' : 'Open a project'}
                  onClick={() => void openProject()}
                >
                  <Plus size={20} aria-hidden="true" />
                </button>
                <span className="composer-mode">
                  <ShieldCheck size={15} aria-hidden="true" />
                  {text.fullAccess}
                </span>
                <span className="composer-version">v{appInfo.version}</span>
                <button
                  type="submit"
                  className="send-button"
                  disabled={!desktopAvailable || homeChatBusy || !homeInput.trim()}
                  title={locale === 'fr' ? 'Envoyer' : 'Send'}
                >
                  <Send size={18} aria-hidden="true" />
                </button>
              </div>
            </form>
          </footer>
        )}
      </main>
      {createProjectOpen && (
        <div className="project-create-backdrop" role="presentation">
          <section
            className="project-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-create-title"
          >
            <h2 id="project-create-title">{'Cr\u00e9er un nouveau projet'}</h2>
            <p>
              {'Donnez un nom au projet. Windows vous demandera ensuite dans quel dossier le cr\u00e9er.'}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createProject();
              }}
            >
              <label htmlFor="new-project-name">Nom du projet</label>
              <input
                id="new-project-name"
                value={newProjectName}
                maxLength={80}
                autoFocus
                disabled={createProjectBusy}
                placeholder="Mon application"
                onChange={(event) => setNewProjectName(event.target.value)}
              />
              {createProjectError && <p className="project-create-error" role="alert">{createProjectError}</p>}
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={createProjectBusy}
                  onClick={() => setCreateProjectOpen(false)}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={createProjectBusy || !newProjectName.trim()}
                >
                  {createProjectBusy ? 'Cr\u00e9ation\u2026' : 'Choisir le dossier parent'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {cloneProjectOpen && (
        <div className="project-create-backdrop" role="presentation">
          <section
            className="project-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-clone-title"
          >
            <h2 id="project-clone-title">{'Cloner un d\u00e9p\u00f4t Git'}</h2>
            <p>
              {'Collez une URL HTTPS GitHub, GitLab ou compatible. NeuraCo vous demandera ensuite le dossier parent.'}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void cloneProject();
              }}
            >
              <label htmlFor="repository-url">{'URL HTTPS du d\u00e9p\u00f4t'}</label>
              <input
                id="repository-url"
                type="url"
                value={repositoryUrl}
                autoFocus
                disabled={cloneProjectBusy}
                placeholder="https://github.com/organisation/projet.git"
                onChange={(event) => setRepositoryUrl(event.target.value)}
              />
              {cloneProjectError && <p className="project-create-error" role="alert">{cloneProjectError}</p>}
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={cloneProjectBusy}
                  onClick={() => setCloneProjectOpen(false)}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={cloneProjectBusy || !repositoryUrl.trim()}
                >
                  {cloneProjectBusy ? 'Clonage\u2026' : 'Choisir le dossier parent'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
