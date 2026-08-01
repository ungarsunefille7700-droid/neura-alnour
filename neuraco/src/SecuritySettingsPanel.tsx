import { useEffect, useState } from 'react';
import {
  Fingerprint,
  Laptop,
  LockKeyhole,
  LogOut,
  MonitorCheck,
  RefreshCw,
  ShieldCheck,
  Smartphone
} from 'lucide-react';
import type {
  NeuraCoAppLockState,
  NeuraCoConnectedDevice
} from '../electron/ipc-contract';

interface SecuritySettingsPanelProps {
  state: NeuraCoAppLockState;
  onState: (state: NeuraCoAppLockState) => void;
}

const helloLabels: Record<
  NeuraCoAppLockState['windowsHelloAvailability'],
  string
> = {
  available: 'Disponible',
  not_configured: 'Non configuré dans Windows',
  not_supported: 'Non pris en charge',
  disabled_by_policy: 'Désactivé par la politique Windows',
  busy: 'Temporairement occupé',
  unknown: 'Disponibilité inconnue'
};

const errorText = (error: unknown): string => (
  error instanceof Error ? error.message : 'L’opération de sécurité a échoué.'
);

export const AppLockScreen = ({
  state,
  onState,
  onLogout
}: SecuritySettingsPanelProps & { onLogout: () => Promise<void> }) => {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const unlockPin = async () => {
    if (!window.neuraco || !pin) return;
    setBusy(true);
    setError('');
    try {
      onState(await window.neuraco.unlockAppWithPin(pin));
      setPin('');
    } catch (unlockError) {
      setError(errorText(unlockError));
    } finally {
      setBusy(false);
    }
  };

  const unlockHello = async () => {
    if (!window.neuraco) return;
    setBusy(true);
    setError('');
    try {
      onState(await window.neuraco.unlockAppWithWindowsHello());
    } catch (unlockError) {
      setError(errorText(unlockError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-lock-shell">
      <section className="app-lock-dialog" aria-labelledby="app-lock-title">
        <div className="app-lock-icon"><LockKeyhole size={28} aria-hidden="true" /></div>
        <p className="section-label">NeuraCo sécurisé</p>
        <h1 id="app-lock-title">Application verrouillée</h1>
        <p>
          {state.reason === 'idle'
            ? 'NeuraCo a été verrouillé après une période d’inactivité.'
            : state.reason === 'remote'
              ? 'Cet appareil a été déconnecté à distance.'
              : 'Confirmez votre identité pour reprendre votre travail.'}
        </p>

        {state.pinEnabled && (
          <form
            className="app-lock-form"
            onSubmit={(event) => {
              event.preventDefault();
              void unlockPin();
            }}
          >
            <label htmlFor="app-lock-pin">Code PIN</label>
            <input
              id="app-lock-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{4,12}"
              minLength={4}
              maxLength={12}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <button className="button button-primary" type="submit" disabled={busy || !pin}>
              <ShieldCheck size={17} aria-hidden="true" />
              Déverrouiller
            </button>
          </form>
        )}

        {state.windowsHelloEnabled && (
          <button
            className="button button-secondary button-full"
            type="button"
            onClick={() => void unlockHello()}
            disabled={busy}
          >
            <Fingerprint size={18} aria-hidden="true" />
            Utiliser Windows Hello
          </button>
        )}

        {error && <p className="auth-error" role="alert">{error}</p>}
        {state.retryAt && (
          <p className="app-lock-retry">
            Protection temporaire active après plusieurs tentatives incorrectes.
          </p>
        )}
        <button
          className="app-lock-signout"
          type="button"
          onClick={() => void onLogout()}
          disabled={busy}
        >
          <LogOut size={16} aria-hidden="true" />
          Se déconnecter
        </button>
      </section>
    </main>
  );
};

const SecuritySettingsPanel = ({
  state,
  onState
}: SecuritySettingsPanelProps) => {
  const [devices, setDevices] = useState<NeuraCoConnectedDevice[]>([]);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const run = async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (operationError) {
      setError(errorText(operationError));
    } finally {
      setBusy('');
    }
  };

  const refreshDevices = async () => {
    if (!window.neuraco) return;
    setDevices(await window.neuraco.listConnectedDevices());
  };

  useEffect(() => {
    void run('devices', refreshDevices);
  }, []);

  const savePin = async () => {
    if (!window.neuraco) return;
    if (newPin !== confirmPin) throw new Error('Les deux nouveaux codes PIN diffèrent.');
    const next = await window.neuraco.setAppLockPin(
      newPin,
      state.pinEnabled ? currentPin : undefined
    );
    onState(next);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setMessage(state.pinEnabled ? 'Code PIN modifié.' : 'Code PIN activé.');
  };

  const updateSettings = async (
    patch: Partial<Pick<
      NeuraCoAppLockState,
      'lockOnStartup' | 'idleTimeoutMinutes' | 'maskSensitiveNotifications'
    >>
  ) => {
    if (!window.neuraco) return;
    onState(await window.neuraco.updateAppLockSettings({
      lockOnStartup: patch.lockOnStartup ?? state.lockOnStartup,
      idleTimeoutMinutes: patch.idleTimeoutMinutes ?? state.idleTimeoutMinutes,
      maskSensitiveNotifications:
        patch.maskSensitiveNotifications ?? state.maskSensitiveNotifications
    }));
    setMessage('Paramètres de verrouillage enregistrés.');
  };

  return (
    <>
      <section className="settings-group security-control-group">
        <div className="security-section-heading">
          <div>
            <h2>Verrouillage de l’application</h2>
            <p>
              Le code PIN est dérivé par scrypt puis conservé dans un fichier chiffré
              par Windows. Il n’est jamais stocké en clair.
            </p>
          </div>
          {state.configured && (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void run('lock', async () => {
                onState(await window.neuraco!.lockApp());
              })}
              disabled={Boolean(busy)}
            >
              <LockKeyhole size={16} aria-hidden="true" />
              Verrouiller
            </button>
          )}
        </div>

        <div className="security-pin-grid">
          {state.pinEnabled && (
            <label>
              <span>Code PIN actuel</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={currentPin}
                onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, ''))}
                maxLength={12}
              />
            </label>
          )}
          <label>
            <span>{state.pinEnabled ? 'Nouveau code PIN' : 'Créer un code PIN'}</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={newPin}
              onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))}
              minLength={4}
              maxLength={12}
              placeholder="4 à 12 chiffres"
            />
          </label>
          <label>
            <span>Confirmer le code PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={confirmPin}
              onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))}
              minLength={4}
              maxLength={12}
            />
          </label>
          <button
            className="button button-primary"
            type="button"
            onClick={() => void run('pin', savePin)}
            disabled={Boolean(busy) || newPin.length < 4 || confirmPin.length < 4}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            {state.pinEnabled ? 'Modifier le PIN' : 'Activer le PIN'}
          </button>
          {state.pinEnabled && (
            <button
              className="button button-danger"
              type="button"
              onClick={() => void run('remove-pin', async () => {
                onState(await window.neuraco!.removeAppLockPin(currentPin));
                setCurrentPin('');
                setMessage('Code PIN supprimé.');
              })}
              disabled={Boolean(busy) || !currentPin}
            >
              Retirer le PIN
            </button>
          )}
        </div>

        <div className="security-setting-list">
          <label className="security-setting-row">
            <span>
              <strong>Windows Hello</strong>
              <small>{helloLabels[state.windowsHelloAvailability]}</small>
            </span>
            <button
              className={`security-toggle ${state.windowsHelloEnabled ? 'is-on' : ''}`}
              type="button"
              role="switch"
              aria-checked={state.windowsHelloEnabled}
              disabled={Boolean(busy) || (
                !state.windowsHelloEnabled
                && state.windowsHelloAvailability !== 'available'
              )}
              onClick={() => void run('hello', async () => {
                onState(
                  await window.neuraco!.setWindowsHelloEnabled(
                    !state.windowsHelloEnabled
                  )
                );
                setMessage(
                  state.windowsHelloEnabled
                    ? 'Windows Hello désactivé.'
                    : 'Windows Hello activé après vérification.'
                );
              })}
            >
              <span />
            </button>
          </label>

          <label className="security-setting-row">
            <span>
              <strong>Verrouiller au démarrage</strong>
              <small>Demande le PIN ou Windows Hello à chaque ouverture.</small>
            </span>
            <button
              className={`security-toggle ${state.lockOnStartup ? 'is-on' : ''}`}
              type="button"
              role="switch"
              aria-checked={state.lockOnStartup}
              disabled={Boolean(busy)}
              onClick={() => void run('startup', () => updateSettings({
                lockOnStartup: !state.lockOnStartup
              }))}
            >
              <span />
            </button>
          </label>

          <label className="security-setting-row">
            <span>
              <strong>Verrouillage après inactivité</strong>
              <small>Mesuré par Windows, sans enregistrer votre activité.</small>
            </span>
            <select
              value={state.idleTimeoutMinutes}
              disabled={Boolean(busy)}
              onChange={(event) => void run(
                'idle',
                () => updateSettings({ idleTimeoutMinutes: Number(event.target.value) })
              )}
            >
              <option value={0}>Désactivé</option>
              <option value={1}>1 minute</option>
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 heure</option>
            </select>
          </label>

          <label className="security-setting-row">
            <span>
              <strong>Masquer les notifications sensibles</strong>
              <small>Windows affiche un message générique, jamais le contenu privé.</small>
            </span>
            <button
              className={`security-toggle ${
                state.maskSensitiveNotifications ? 'is-on' : ''
              }`}
              type="button"
              role="switch"
              aria-checked={state.maskSensitiveNotifications}
              disabled={Boolean(busy)}
              onClick={() => void run('notifications', () => updateSettings({
                maskSensitiveNotifications: !state.maskSensitiveNotifications
              }))}
            >
              <span />
            </button>
          </label>
        </div>
      </section>

      <section className="settings-group">
        <div className="security-section-heading">
          <div>
            <h2>Appareils connectés</h2>
            <p>
              La révocation coupe la session NeuraCo de l’appareil lors de son
              prochain contrôle sécurisé.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Actualiser les appareils"
            aria-label="Actualiser les appareils"
            onClick={() => void run('devices', refreshDevices)}
            disabled={Boolean(busy)}
          >
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="security-device-list">
          {devices.length === 0 && busy !== 'devices' && (
            <p className="security-empty">Aucun appareil connecté trouvé.</p>
          )}
          {devices.map((device) => (
            <article className="security-device" key={device.deviceId}>
              <div className="security-device-icon">
                {device.deviceName.toLowerCase().includes('phone')
                  ? <Smartphone size={19} aria-hidden="true" />
                  : <Laptop size={19} aria-hidden="true" />}
              </div>
              <div>
                <strong>
                  {device.deviceName}
                  {device.current && <span>Appareil actuel</span>}
                </strong>
                <small>
                  NeuraCo {device.appVersion} · Dernière activité{' '}
                  {new Date(device.lastSeenAt).toLocaleString('fr-FR')}
                </small>
              </div>
              <span className={`device-status ${
                device.revokedAt ? 'is-revoked' : device.online ? 'is-online' : ''
              }`}>
                {device.revokedAt ? 'Révoqué' : device.online ? 'En ligne' : 'Hors ligne'}
              </span>
              {!device.revokedAt && (
                <button
                  className="button button-danger"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void run(`revoke-${device.deviceId}`, async () => {
                    setDevices(
                      await window.neuraco!.revokeConnectedDevice(device.deviceId)
                    );
                  })}
                >
                  {device.current ? 'Déconnecter' : 'Révoquer'}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      {message && <p className="security-feedback is-success">{message}</p>}
      {error && <p className="security-feedback is-error" role="alert">{error}</p>}
    </>
  );
};

export default SecuritySettingsPanel;
