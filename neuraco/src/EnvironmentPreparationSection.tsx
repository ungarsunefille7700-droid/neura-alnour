import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  FileWarning,
  LoaderCircle,
  Play,
  Save,
  ShieldCheck,
  TerminalSquare,
  XCircle
} from 'lucide-react';
import type {
  NeuraCoEnvironmentPreparationConfig,
  NeuraCoEnvironmentPreparationExecution,
  NeuraCoEnvironmentPreparationPreview,
  NeuraCoEnvironmentTarget
} from '../electron/ipc-contract';

interface EnvironmentPreparationSectionProps {
  target: NeuraCoEnvironmentTarget;
  onStatus: (message: string) => void;
}

const EMPTY_CONFIG: NeuraCoEnvironmentPreparationConfig = {
  projectId: '',
  script: '',
  enabled: false,
  runOnWorktree: true,
  runOnTransfer: true,
  timeoutSeconds: 300,
  updatedAt: ''
};

const formatDate = (value: string): string => {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export default function EnvironmentPreparationSection({
  target,
  onStatus
}: EnvironmentPreparationSectionProps) {
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [executions, setExecutions] = useState<
    NeuraCoEnvironmentPreparationExecution[]
  >([]);
  const [preview, setPreview] = useState<NeuraCoEnvironmentPreparationPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    if (!window.neuraco || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const [loadedConfig, loadedExecutions] = await Promise.all([
        window.neuraco.getEnvironmentPreparation(),
        window.neuraco.listEnvironmentPreparationHistory(20)
      ]);
      setConfig(loadedConfig);
      setExecutions(loadedExecutions);
      setPreview(undefined);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Configuration de préparation indisponible.'
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setPreview(undefined);
  }, [
    target.kind,
    target.projectPath,
    target.worktreePath,
    target.container,
    target.distribution,
    target.sshHost,
    target.cloudWorkspaceId
  ]);

  const save = async () => {
    if (!window.neuraco || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await window.neuraco.updateEnvironmentPreparation({
        script: config.script,
        enabled: config.enabled,
        runOnWorktree: config.runOnWorktree,
        runOnTransfer: config.runOnTransfer,
        timeoutSeconds: config.timeoutSeconds
      });
      setConfig(saved);
      setPreview(undefined);
      onStatus('Script de préparation enregistré.');
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Enregistrement du script impossible.'
      );
    } finally {
      setBusy(false);
    }
  };

  const inspect = async () => {
    if (!window.neuraco || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await window.neuraco.previewEnvironmentPreparation(target));
    } catch (inspectError) {
      setPreview(undefined);
      setError(
        inspectError instanceof Error
          ? inspectError.message
          : 'Analyse du script impossible.'
      );
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!window.neuraco || !preview?.compatible || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const execution = await window.neuraco.runEnvironmentPreparation(target);
      setExecutions((current) => [
        execution,
        ...current.filter((item) => item.id !== execution.id)
      ]);
      setConfig(await window.neuraco.getEnvironmentPreparation());
      setPreview(undefined);
      onStatus(
        execution.status === 'completed'
          ? 'Préparation de l’environnement terminée.'
          : 'Le script de préparation a échoué.'
      );
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : 'Exécution du script impossible.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="environment-preparation-section">
      <header>
        <div>
          <TerminalSquare size={18} />
          <span>
            <strong>Préparation sécurisée</strong>
            <small>
              Dépendances, configuration de test, compilation et vérification d’outils.
            </small>
          </span>
        </div>
        <span className={config.enabled ? 'is-enabled' : 'is-disabled'}>
          {config.enabled ? 'Activée' : 'Désactivée'}
        </span>
      </header>

      {error && <div className="environment-preparation-error">{error}</div>}

      <label className="environment-preparation-script">
        Script affiché avant la première exécution
        <textarea
          aria-label="Script de préparation"
          value={config.script}
          onChange={(event) => {
            setConfig((current) => ({ ...current, script: event.target.value }));
            setPreview(undefined);
          }}
          placeholder={'npm ci\nnpm test\nnpm run build'}
          spellCheck={false}
        />
      </label>

      <div className="environment-preparation-options">
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => setConfig((current) => ({
              ...current,
              enabled: event.target.checked
            }))}
          />
          Activer le script
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.runOnWorktree}
            onChange={(event) => setConfig((current) => ({
              ...current,
              runOnWorktree: event.target.checked
            }))}
          />
          Après création d’un worktree
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.runOnTransfer}
            onChange={(event) => setConfig((current) => ({
              ...current,
              runOnTransfer: event.target.checked
            }))}
          />
          Après un transfert
        </label>
        <label className="environment-timeout">
          <Clock3 size={14} />
          Délai
          <input
            type="number"
            min={30}
            max={600}
            step={30}
            value={config.timeoutSeconds}
            onChange={(event) => setConfig((current) => ({
              ...current,
              timeoutSeconds: Number(event.target.value)
            }))}
            aria-label="Délai du script en secondes"
          />
          s
        </label>
      </div>

      <div className="environment-preparation-security">
        <ShieldCheck size={16} />
        <span>
          Les variables sensibles sont retirées. Les fichiers `.env`, clés privées et
          commandes destructrices sont bloqués.
        </span>
      </div>

      <div className="environment-preparation-actions">
        <button type="button" onClick={() => void save()} disabled={busy}>
          <Save size={15} /> Enregistrer
        </button>
        <button
          type="button"
          onClick={() => void inspect()}
          disabled={busy || !config.enabled || !config.script.trim()}
        >
          {busy
            ? <LoaderCircle className="is-spinning" size={15} />
            : <FileWarning size={15} />}
          Examiner pour cette cible
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={() => void run()}
          disabled={busy || !preview?.compatible}
        >
          <Play size={15} /> Autoriser et exécuter
        </button>
      </div>

      {preview && (
        <section
          className={`environment-preparation-preview ${
            preview.compatible ? 'is-compatible' : 'is-blocked'
          }`}
          aria-label="Prévisualisation du script de préparation"
        >
          <header>
            {preview.compatible
              ? <CheckCircle2 size={17} />
              : <XCircle size={17} />}
            <span>
              <strong>
                {preview.compatible ? 'Prêt pour autorisation' : 'Exécution bloquée'}
              </strong>
              <small>
                {preview.shell || 'Shell indisponible'}
                {preview.firstExecution ? ' · première exécution' : ' · déjà exécuté'}
              </small>
            </span>
          </header>
          <pre>{preview.script}</pre>
          {preview.blockedReasons.map((reason) => (
            <p className="is-blocking" key={reason}>{reason}</p>
          ))}
          {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </section>
      )}

      <div className="environment-preparation-history">
        <header>
          <strong>Historique d’exécution</strong>
          <span>{executions.length}</span>
        </header>
        {executions.length === 0 ? (
          <p>Aucune préparation exécutée.</p>
        ) : executions.map((execution) => (
          <details key={execution.id}>
            <summary>
              <span
                className={
                  execution.status === 'completed' ? 'is-success' : 'is-failed'
                }
              >
                {execution.status === 'completed'
                  ? <CheckCircle2 size={14} />
                  : <XCircle size={14} />}
              </span>
              <strong>{execution.target.kind.toUpperCase()}</strong>
              <span>{formatDate(execution.createdAt)}</span>
              <small>{execution.durationMs} ms · code {execution.exitCode}</small>
            </summary>
            {execution.stdout && <pre>{execution.stdout}</pre>}
            {execution.stderr && <pre className="is-error">{execution.stderr}</pre>}
          </details>
        ))}
      </div>
    </section>
  );
}
