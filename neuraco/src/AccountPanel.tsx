import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  HardDrive,
  KeyRound,
  Link2,
  LogOut,
  MailCheck,
  MonitorSmartphone,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import type {
  NeuraCoAccountDashboard,
  NeuraCoPrivacySettings,
  NeuraCoSession,
  NeuraCoTechnicalErrorEntry,
  NeuraCoTwoFactorSetup
} from '../electron/ipc-contract';

interface AccountPanelProps {
  locale: 'fr' | 'en';
  session: NeuraCoSession;
  onLogout: () => Promise<void>;
}

const dateLabel = (value?: string): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
};

const bytesLabel = (value: number): string => {
  if (value < 1024) return `${value} o`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} Ko`;
  return `${(value / 1024 ** 2).toFixed(1)} Mo`;
};

const moneyLabel = (amount?: number, currency = 'eur'): string => (
  typeof amount !== 'number'
    ? '—'
    : new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency.toUpperCase()
      }).format(amount)
);

const copy = {
  fr: {
    title: 'Compte',
    intro: 'Abonnement, sécurité, sessions et données de votre compte.',
    loading: 'Chargement du compte…',
    retry: 'Réessayer',
    profile: 'Profil et abonnement',
    email: 'Adresse e-mail',
    plan: 'Plan',
    balance: 'Solde de crédits',
    consumption: 'Consommation mensuelle',
    verified: 'Adresse vérifiée',
    unverified: 'Adresse non vérifiée',
    sendCode: 'Envoyer un code',
    verificationCode: 'Code reçu par e-mail',
    verify: 'Vérifier',
    sessions: 'Sessions actives',
    revoke: 'Déconnecter',
    current: 'Cet appareil',
    revokeOthers: 'Déconnecter les autres appareils',
    twoFactor: 'Double authentification',
    twoFactorEnabled: 'La double authentification est active.',
    twoFactorDisabled: 'Ajoutez une application d’authentification à votre compte.',
    configure: 'Configurer',
    secret: 'Clé de configuration',
    authenticatorCode: 'Code à 6 chiffres',
    enable: 'Activer',
    disable: 'Désactiver',
    recovery: 'Codes de récupération à conserver hors de NeuraCo',
    password: 'Réinitialisation du mot de passe',
    sendReset: 'Envoyer un code de réinitialisation',
    resetCode: 'Code de réinitialisation',
    newPassword: 'Nouveau mot de passe',
    reset: 'Modifier le mot de passe',
    invoices: 'Factures et paiements',
    noInvoices: 'Aucun paiement enregistré.',
    storage: 'Stockage',
    cloudFiles: 'Fichiers développeur dans le cloud',
    connections: 'Connexions et appareils',
    google: 'Connexion Google',
    relayDevices: 'Appareils NeuraCo autorisés',
    connected: 'Connectée',
    notConnected: 'Non connectée',
    keys: 'Clés personnelles',
    noKeys: 'Aucune clé personnelle enregistrée sur le serveur.',
    privacy: 'Confidentialité',
    analytics: 'Mesures techniques et performances',
    productEmails: 'E-mails produit',
    securityEmails: 'Alertes de sécurité',
    notificationEmails: 'Notifications NeuraCo par e-mail',
    saved: 'Modifications enregistrées.',
    privacyIntro: 'Les catégories restent séparées : aucune mesure technique ne contient votre code, vos messages, vos chemins de fichiers, vos secrets ou vos données de paiement.',
    technicalTelemetry: 'Télémétrie technique',
    technicalTelemetryDetail: 'Version, plateforme, réussite et durée approximative uniquement. Désactivable avec le réglage ci-dessous.',
    errorLogs: 'Journaux d’erreur locaux',
    errorLogsDetail: 'Conservés sur cet appareil sans message, pile, code source, chemin ni secret.',
    clearErrorLogs: 'Effacer les erreurs locales',
    userContent: 'Contenu utilisateur',
    userContentDetail: 'Conversations et fichiers cloud séparés de la télémétrie et utilisés seulement pour les fonctions demandées.',
    billingData: 'Facturation',
    billingDataDetail: 'Écritures séparées du contenu. En cas de suppression, elles sont conservées uniquement sous forme pseudonymisée lorsque la loi ou la comptabilité l’exige.',
    deleteAccount: 'Supprimer le compte et les données cloud',
    deleteWarning: 'Action définitive : conversations, mémoires, projets cloud, progression et sessions seront supprimés. Les écritures de facturation seront pseudonymisées.',
    confirmEmail: 'Saisissez exactement votre adresse e-mail',
    currentPassword: 'Mot de passe actuel',
    googleReauth: 'Pour un compte Google, reconnectez-vous juste avant cette action.',
    deleteTwoFactor: 'Code 2FA',
    deletePermanently: 'Supprimer définitivement',
    signOut: 'Se déconnecter'
  },
  en: {
    title: 'Account',
    intro: 'Subscription, security, sessions and account data.',
    loading: 'Loading account…',
    retry: 'Retry',
    profile: 'Profile and subscription',
    email: 'Email address',
    plan: 'Plan',
    balance: 'Credit balance',
    consumption: 'Monthly usage',
    verified: 'Email verified',
    unverified: 'Email not verified',
    sendCode: 'Send a code',
    verificationCode: 'Code received by email',
    verify: 'Verify',
    sessions: 'Active sessions',
    revoke: 'Sign out',
    current: 'This device',
    revokeOthers: 'Sign out other devices',
    twoFactor: 'Two-factor authentication',
    twoFactorEnabled: 'Two-factor authentication is enabled.',
    twoFactorDisabled: 'Add an authenticator application to your account.',
    configure: 'Configure',
    secret: 'Setup key',
    authenticatorCode: '6-digit code',
    enable: 'Enable',
    disable: 'Disable',
    recovery: 'Recovery codes to store outside NeuraCo',
    password: 'Password reset',
    sendReset: 'Send password reset code',
    resetCode: 'Reset code',
    newPassword: 'New password',
    reset: 'Change password',
    invoices: 'Invoices and payments',
    noInvoices: 'No payment recorded.',
    storage: 'Storage',
    cloudFiles: 'Developer files in cloud storage',
    connections: 'Connections and devices',
    google: 'Google sign-in',
    relayDevices: 'Authorized NeuraCo devices',
    connected: 'Connected',
    notConnected: 'Not connected',
    keys: 'Personal keys',
    noKeys: 'No personal key stored on the server.',
    privacy: 'Privacy',
    analytics: 'Technical and performance metrics',
    productEmails: 'Product emails',
    securityEmails: 'Security alerts',
    notificationEmails: 'NeuraCo notifications by email',
    saved: 'Changes saved.',
    privacyIntro: 'Categories remain separate: technical metrics never contain your code, messages, file paths, secrets or payment data.',
    technicalTelemetry: 'Technical telemetry',
    technicalTelemetryDetail: 'Version, platform, success and coarse duration only. Can be disabled below.',
    errorLogs: 'Local error logs',
    errorLogsDetail: 'Stored on this device without message, stack, source code, path or secret.',
    clearErrorLogs: 'Clear local errors',
    userContent: 'User content',
    userContentDetail: 'Cloud conversations and files are separated from telemetry and used only for requested features.',
    billingData: 'Billing',
    billingDataDetail: 'Records are separated from content. When deleting an account, required records are retained only in pseudonymized form.',
    deleteAccount: 'Delete account and cloud data',
    deleteWarning: 'Permanent action: conversations, memories, cloud projects, progress and sessions will be deleted. Billing records will be pseudonymized.',
    confirmEmail: 'Enter your exact email address',
    currentPassword: 'Current password',
    googleReauth: 'For a Google account, sign in again immediately before this action.',
    deleteTwoFactor: '2FA code',
    deletePermanently: 'Delete permanently',
    signOut: 'Sign out'
  }
} as const;

const AccountPanel = ({ locale, session, onLogout }: AccountPanelProps) => {
  const text = copy[locale];
  const [account, setAccount] = useState<NeuraCoAccountDashboard | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [twoFactorSetup, setTwoFactorSetup] = useState<NeuraCoTwoFactorSetup | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [technicalErrors, setTechnicalErrors] = useState<NeuraCoTechnicalErrorEntry[]>([]);
  const [deletionEmail, setDeletionEmail] = useState('');
  const [deletionPassword, setDeletionPassword] = useState('');
  const [deletionTwoFactor, setDeletionTwoFactor] = useState('');

  const load = useCallback(async () => {
    if (!window.neuraco) return;
    setBusy('load');
    setError('');
    try {
      const [dashboard, localErrors] = await Promise.all([
        window.neuraco.getAccount(),
        window.neuraco.listTechnicalErrors()
      ]);
      setAccount(dashboard);
      setTechnicalErrors(localErrors);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Compte indisponible.');
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Action impossible.');
    } finally {
      setBusy('');
    }
  };

  const savePrivacy = (settings: NeuraCoPrivacySettings) => {
    if (!window.neuraco || !account) return;
    void action('privacy', async () => {
      const privacy = await window.neuraco!.updatePrivacySettings(settings);
      setAccount({ ...account, privacy });
      setNotice(text.saved);
    });
  };

  if (!account) {
    return (
      <div className="settings-page account-page">
        <header className="settings-heading">
          <div><h1>{text.title}</h1><p>{text.intro}</p></div>
        </header>
        {error ? (
          <div className="account-feedback is-error" role="alert">
            <span>{error}</span>
            <button className="button button-secondary" type="button" onClick={() => void load()}>
              <RefreshCw size={16} aria-hidden="true" /> {text.retry}
            </button>
          </div>
        ) : (
          <div className="workspace-loading">{text.loading}</div>
        )}
      </div>
    );
  }

  const monthly = account.usage?.windows?.monthly;

  return (
    <div className="settings-page account-page">
      <header className="settings-heading">
        <div>
          <h1>{text.title}</h1>
          <p>{account.profile.name || session.user?.name} · {text.intro}</p>
        </div>
      </header>

      {(error || notice) && (
        <div className={`account-feedback ${error ? 'is-error' : 'is-success'}`} role="status">
          {error || notice}
        </div>
      )}

      <section className="settings-group">
        <h2>{text.profile}</h2>
        <div className="information-list">
          <div><span>{text.email}</span><strong>{account.profile.email}</strong></div>
          <div><span>{text.plan}</span><strong>{account.usage?.plan.label || account.profile.subscription}</strong></div>
          <div><span>{text.balance}</span><strong>{account.usage?.purchased.available ?? 0}</strong></div>
          <div>
            <span>{text.consumption}</span>
            <strong>{monthly ? `${monthly.used} / ${monthly.limit}` : '—'}</strong>
          </div>
        </div>
        <div className="account-inline-action">
          <span className={`status-badge ${account.profile.email_verified ? 'is-valid' : ''}`}>
            {account.profile.email_verified ? <CheckCircle2 size={15} /> : <MailCheck size={15} />}
            {account.profile.email_verified ? text.verified : text.unverified}
          </span>
          {!account.profile.email_verified && (
            <>
              <button
                className="button button-secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void action('verification-request', async () => {
                  await window.neuraco!.requestEmailVerification();
                  setNotice(text.sendCode);
                })}
              >
                {text.sendCode}
              </button>
              <input
                value={verificationToken}
                onChange={(event) => setVerificationToken(event.target.value)}
                placeholder={text.verificationCode}
              />
              <button
                className="button button-primary"
                type="button"
                disabled={verificationToken.length < 8 || Boolean(busy)}
                onClick={() => void action('verification-confirm', async () => {
                  await window.neuraco!.confirmEmailVerification(verificationToken);
                  setVerificationToken('');
                  await load();
                })}
              >
                {text.verify}
              </button>
            </>
          )}
        </div>
      </section>

      <section className="settings-group">
        <div className="account-section-heading">
          <div>
            <h2><MonitorSmartphone size={18} /> {text.sessions}</h2>
            <p>{account.sessions.length} session(s)</p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            disabled={account.sessions.length <= 1 || Boolean(busy)}
            onClick={() => void action('sessions', async () => {
              await window.neuraco!.revokeOtherAccountSessions();
              await load();
            })}
          >
            {text.revokeOthers}
          </button>
        </div>
        <div className="account-session-list">
          {account.sessions.map((activeSession) => (
            <div key={activeSession.id} className="account-session-row">
              <div>
                <strong>{activeSession.device_name}</strong>
                <span>
                  {activeSession.current ? `${text.current} · ` : ''}
                  {activeSession.ip_hint || 'IP masquée'} · {dateLabel(activeSession.last_seen_at)}
                </span>
              </div>
              <button
                className="button button-secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void action(`session-${activeSession.id}`, async () => {
                  const result = await window.neuraco!.revokeAccountSession(activeSession.id);
                  if (result.current) {
                    await onLogout();
                    return;
                  }
                  await load();
                })}
              >
                <LogOut size={15} /> {text.revoke}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h2><ShieldCheck size={18} /> {text.twoFactor}</h2>
        <p className="account-description">
          {account.profile.two_factor_enabled ? text.twoFactorEnabled : text.twoFactorDisabled}
        </p>
        {!account.profile.two_factor_enabled && !twoFactorSetup && (
          <button
            className="button button-secondary"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void action('2fa-setup', async () => {
              setTwoFactorSetup(await window.neuraco!.setupTwoFactor());
            })}
          >
            <KeyRound size={16} /> {text.configure}
          </button>
        )}
        {twoFactorSetup && !account.profile.two_factor_enabled && (
          <div className="account-security-form">
            <label>
              <span>{text.secret}</span>
              <input readOnly value={twoFactorSetup.secret} />
            </label>
            <label>
              <span>{text.authenticatorCode}</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
              />
            </label>
            <button
              className="button button-primary"
              type="button"
              disabled={twoFactorCode.replace(/\s/g, '').length !== 6 || Boolean(busy)}
              onClick={() => void action('2fa-enable', async () => {
                const result = await window.neuraco!.enableTwoFactor(twoFactorCode);
                setRecoveryCodes(result.recovery_codes);
                setTwoFactorSetup(null);
                setTwoFactorCode('');
                await load();
              })}
            >
              {text.enable}
            </button>
          </div>
        )}
        {account.profile.two_factor_enabled && (
          <div className="account-security-form is-inline">
            <label>
              <span>{text.authenticatorCode}</span>
              <input
                autoComplete="one-time-code"
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
              />
            </label>
            <button
              className="button button-danger"
              type="button"
              disabled={twoFactorCode.length < 6 || Boolean(busy)}
              onClick={() => void action('2fa-disable', async () => {
                await window.neuraco!.disableTwoFactor(twoFactorCode);
                setTwoFactorCode('');
                await load();
              })}
            >
              {text.disable}
            </button>
          </div>
        )}
        {recoveryCodes.length > 0 && (
          <div className="account-recovery-codes">
            <strong>{text.recovery}</strong>
            <code>{recoveryCodes.join('\n')}</code>
          </div>
        )}
      </section>

      {!account.connections.google && (
        <section className="settings-group">
          <h2><KeyRound size={18} /> {text.password}</h2>
          <div className="account-security-form">
            <button
              className="button button-secondary"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void action('reset-request', async () => {
                await window.neuraco!.requestPasswordReset(account.profile.email);
                setNotice(text.sendReset);
              })}
            >
              {text.sendReset}
            </button>
            <label>
              <span>{text.resetCode}</span>
              <input value={resetToken} onChange={(event) => setResetToken(event.target.value)} />
            </label>
            <label>
              <span>{text.newPassword}</span>
              <input
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <button
              className="button button-primary"
              type="button"
              disabled={resetToken.length < 8 || newPassword.length < 8 || Boolean(busy)}
              onClick={() => void action('reset-confirm', async () => {
                await window.neuraco!.confirmPasswordReset(
                  account.profile.email,
                  resetToken,
                  newPassword
                );
                await onLogout();
              })}
            >
              {text.reset}
            </button>
          </div>
        </section>
      )}

      <section className="settings-group account-data-grid">
        <div>
          <h2><ReceiptText size={18} /> {text.invoices}</h2>
          {account.invoices.length === 0 ? (
            <p className="account-description">{text.noInvoices}</p>
          ) : (
            <div className="account-compact-list">
              {account.invoices.map((invoice) => (
                <div key={invoice.id}>
                  <span>{invoice.plan || invoice.kind} · {dateLabel(invoice.created_at)}</span>
                  <strong>{moneyLabel(invoice.amount, invoice.currency)} · {invoice.status}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2><HardDrive size={18} /> {text.storage}</h2>
          <div className="account-compact-list">
            <div>
              <span>{text.cloudFiles}</span>
              <strong>{account.storage.cloud_files} · {bytesLabel(account.storage.cloud_bytes)}</strong>
            </div>
          </div>
        </div>
        <div>
          <h2><Link2 size={18} /> {text.connections}</h2>
          <div className="account-compact-list">
            <div>
              <span>{text.google}</span>
              <strong>{account.connections.google ? text.connected : text.notConnected}</strong>
            </div>
            <div>
              <span>{text.relayDevices}</span>
              <strong>{account.connections.relay_devices}</strong>
            </div>
          </div>
        </div>
        <div>
          <h2><KeyRound size={18} /> {text.keys}</h2>
          <p className="account-description">
            {account.personal_keys.length === 0
              ? text.noKeys
              : account.personal_keys.map((key) => `${key.provider} · ${key.fingerprint}`).join(', ')}
          </p>
        </div>
      </section>

      <section className="settings-group">
        <h2>{text.privacy}</h2>
        <p className="account-description">{text.privacyIntro}</p>
        <div className="account-privacy-categories">
          <article>
            <strong>{text.technicalTelemetry}</strong>
            <span>{text.technicalTelemetryDetail}</span>
          </article>
          <article>
            <strong>{text.errorLogs}</strong>
            <span>{text.errorLogsDetail}</span>
            <button
              className="button button-secondary"
              type="button"
              disabled={technicalErrors.length === 0 || Boolean(busy)}
              onClick={() => void action('clear-errors', async () => {
                await window.neuraco!.clearTechnicalErrors();
                setTechnicalErrors([]);
              })}
            >
              {text.clearErrorLogs} ({technicalErrors.length})
            </button>
          </article>
          <article>
            <strong>{text.userContent}</strong>
            <span>{text.userContentDetail}</span>
          </article>
          <article>
            <strong>{text.billingData}</strong>
            <span>{text.billingDataDetail}</span>
          </article>
        </div>
        <div className="account-toggle-list">
          {([
            ['analytics_enabled', text.analytics],
            ['product_emails_enabled', text.productEmails],
            ['security_emails_enabled', text.securityEmails],
            ['desktop_notifications_email_enabled', text.notificationEmails]
          ] as const).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={account.privacy[key]}
                disabled={busy === 'privacy'}
                onChange={(event) => savePrivacy({
                  ...account.privacy,
                  [key]: event.target.checked
                })}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="settings-group account-danger-zone">
        <h2><Trash2 size={18} /> {text.deleteAccount}</h2>
        <p className="account-description">{text.deleteWarning}</p>
        {account.connections.google && (
          <p className="account-description">{text.googleReauth}</p>
        )}
        <div className="account-security-form">
          <label>
            <span>{text.confirmEmail}</span>
            <input
              type="email"
              autoComplete="off"
              value={deletionEmail}
              onChange={(event) => setDeletionEmail(event.target.value)}
            />
          </label>
          {!account.connections.google && (
            <label>
              <span>{text.currentPassword}</span>
              <input
                type="password"
                autoComplete="current-password"
                value={deletionPassword}
                onChange={(event) => setDeletionPassword(event.target.value)}
              />
            </label>
          )}
          {account.profile.two_factor_enabled && (
            <label>
              <span>{text.deleteTwoFactor}</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={deletionTwoFactor}
                onChange={(event) => setDeletionTwoFactor(event.target.value)}
              />
            </label>
          )}
          <button
            className="button button-danger"
            type="button"
            disabled={
              Boolean(busy)
              || deletionEmail.trim().toLowerCase() !== account.profile.email.toLowerCase()
              || (!account.connections.google && deletionPassword.length < 6)
              || (account.profile.two_factor_enabled && deletionTwoFactor.length < 6)
            }
            onClick={() => void action('delete-account', async () => {
              await window.neuraco!.deleteAccount({
                confirmationEmail: deletionEmail,
                password: deletionPassword || undefined,
                twoFactorCode: deletionTwoFactor || undefined
              });
              await onLogout();
            })}
          >
            <Trash2 size={16} aria-hidden="true" /> {text.deletePermanently}
          </button>
        </div>
      </section>

      <button
        className="button button-danger account-sign-out"
        type="button"
        onClick={() => void onLogout()}
      >
        <LogOut size={17} aria-hidden="true" /> {text.signOut}
      </button>
    </div>
  );
};

export default AccountPanel;
