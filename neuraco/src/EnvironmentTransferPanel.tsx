import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CheckCircle2,
  Cloud,
  Container,
  Laptop,
  LoaderCircle,
  Network,
  RefreshCw,
  Server,
  ShieldAlert,
  TerminalSquare,
  XCircle
} from 'lucide-react';
import type {
  NeuraCoEnvironmentCapability,
  NeuraCoEnvironmentDiscovery,
  NeuraCoEnvironmentKind,
  NeuraCoEnvironmentTarget,
  NeuraCoEnvironmentTransferPreview,
  NeuraCoEnvironmentTransferRecord
} from '../electron/ipc-contract';
import EnvironmentPreparationSection from './EnvironmentPreparationSection';
import RemoteConnectionsSection from './RemoteConnectionsSection';

interface EnvironmentTransferPanelProps {
  onStatus: (message: string) => void;
}

interface TargetDraft {
  localPath: string;
  worktreePath: string;
  container: string;
  distribution: string;
  sshHost: string;
  remoteProjectPath: string;
  cloudWorkspaceId: string;
}

const KINDS: Array<{
  id: NeuraCoEnvironmentKind;
  label: string;
  icon: typeof Laptop;
}> = [
  { id: 'local', label: 'Local', icon: Laptop },
  { id: 'worktree', label: 'Worktree', icon: Network },
  { id: 'docker', label: 'Docker', icon: Container },
  { id: 'wsl2', label: 'WSL2', icon: TerminalSquare },
  { id: 'ssh', label: 'SSH', icon: Server },
  { id: 'cloud', label: 'Cloud', icon: Cloud }
];

const EMPTY_DRAFT: TargetDraft = {
  localPath: '',
  worktreePath: '',
  container: '',
  distribution: '',
  sshHost: '',
  remoteProjectPath: '',
  cloudWorkspaceId: 'default'
};

const targetFromDraft = (
  kind: NeuraCoEnvironmentKind,
  draft: TargetDraft
): NeuraCoEnvironmentTarget => {
  if (kind === 'local') return { kind, projectPath: draft.localPath };
  if (kind === 'worktree') return { kind, worktreePath: draft.worktreePath };
  if (kind === 'docker') {
    return {
      kind,
      container: draft.container,
      projectPath: draft.remoteProjectPath
    };
  }
  if (kind === 'wsl2') {
    return {
      kind,
      distribution: draft.distribution,
      projectPath: draft.remoteProjectPath
    };
  }
  if (kind === 'ssh') {
    return {
      kind,
      sshHost: draft.sshHost,
      projectPath: draft.remoteProjectPath
    };
  }
  return { kind, cloudWorkspaceId: draft.cloudWorkspaceId || 'default' };
};

const targetLabel = (record: NeuraCoEnvironmentTransferRecord): string => {
  const target = record.target;
  return target.worktreePath
    || target.projectPath
    || target.container
    || target.distribution
    || target.sshHost
    || target.cloudWorkspaceId
    || target.kind;
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

export default function EnvironmentTransferPanel({
  onStatus
}: EnvironmentTransferPanelProps) {
  const [kind, setKind] = useState<NeuraCoEnvironmentKind>('local');
  const [draft, setDraft] = useState<TargetDraft>(EMPTY_DRAFT);
  const [discovery, setDiscovery] = useState<NeuraCoEnvironmentDiscovery>();
  const [preview, setPreview] = useState<NeuraCoEnvironmentTransferPreview>();
  const [records, setRecords] = useState<NeuraCoEnvironmentTransferRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const capability = useMemo(
    () => discovery?.capabilities.find((item) => item.kind === kind),
    [discovery, kind]
  );
  const selectedTarget = useMemo(
    () => targetFromDraft(kind, draft),
    [kind, draft]
  );

  const updateDraft = (next: Partial<TargetDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setPreview(undefined);
    setError(undefined);
  };

  const applyDiscoveredTargets = (
    loaded: NeuraCoEnvironmentDiscovery,
    current: TargetDraft
  ): TargetDraft => {
    const capabilityFor = (id: NeuraCoEnvironmentKind) => (
      loaded.capabilities.find((item) => item.kind === id)
    );
    return {
      ...current,
      localPath: current.localPath || capabilityFor('local')?.targets[0]?.id || '',
      worktreePath: current.worktreePath
        || capabilityFor('worktree')?.targets[0]?.id
        || '',
      container: current.container || capabilityFor('docker')?.targets[0]?.id || '',
      distribution: current.distribution
        || capabilityFor('wsl2')?.targets[0]?.id
        || '',
      cloudWorkspaceId: current.cloudWorkspaceId
        || capabilityFor('cloud')?.targets[0]?.id
        || 'default'
    };
  };

  const refresh = async () => {
    if (!window.neuraco || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const [loadedDiscovery, loadedRecords] = await Promise.all([
        window.neuraco.discoverEnvironments(),
        window.neuraco.listEnvironmentTransfers()
      ]);
      setDiscovery(loadedDiscovery);
      setRecords(loadedRecords);
      setDraft((current) => applyDiscoveredTargets(loadedDiscovery, current));
      setPreview(undefined);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Détection des environnements impossible.'
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const runPreview = async () => {
    if (!window.neuraco || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await window.neuraco.previewEnvironmentTransfer(selectedTarget));
    } catch (previewError) {
      setPreview(undefined);
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Prévisualisation du transfert impossible.'
      );
    } finally {
      setBusy(false);
    }
  };

  const executeTransfer = async () => {
    if (!window.neuraco || !preview?.compatible || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const record = await window.neuraco.executeEnvironmentTransfer(preview.target);
      setRecords((current) => [
        record,
        ...current.filter((item) => item.id !== record.id)
      ]);
      setPreview(undefined);
      onStatus(`Session transférée vers ${record.target.kind}.`);
    } catch (transferError) {
      setError(
        transferError instanceof Error
          ? transferError.message
          : 'Transfert de la session impossible.'
      );
    } finally {
      setBusy(false);
    }
  };

  const renderTargetFields = () => {
    if (kind === 'local') {
      return (
        <label>
          Dossier du projet local
          <input
            aria-label="Dossier du projet local"
            value={draft.localPath}
            onChange={(event) => updateDraft({ localPath: event.target.value })}
            placeholder="C:\projets\mon-projet"
          />
        </label>
      );
    }
    if (kind === 'worktree') {
      return (
        <label>
          Worktree Git
          <select
            aria-label="Worktree Git"
            value={draft.worktreePath}
            onChange={(event) => updateDraft({ worktreePath: event.target.value })}
          >
            <option value="">Sélectionner un worktree</option>
            {(capability?.targets || []).map((target) => (
              <option key={target.id} value={target.id}>
                {target.label} — {target.detail || target.id}
              </option>
            ))}
          </select>
        </label>
      );
    }
    if (kind === 'docker') {
      return (
        <>
          <label>
            Conteneur Docker
            <select
              aria-label="Conteneur Docker"
              value={draft.container}
              onChange={(event) => updateDraft({ container: event.target.value })}
            >
              <option value="">Sélectionner un conteneur</option>
              {(capability?.targets || []).map((target) => (
                <option key={target.id} value={target.id}>{target.label}</option>
              ))}
            </select>
          </label>
          <RemotePathField draft={draft} updateDraft={updateDraft} />
        </>
      );
    }
    if (kind === 'wsl2') {
      return (
        <>
          <label>
            Distribution WSL2
            <select
              aria-label="Distribution WSL2"
              value={draft.distribution}
              onChange={(event) => updateDraft({ distribution: event.target.value })}
            >
              <option value="">Sélectionner une distribution</option>
              {(capability?.targets || []).map((target) => (
                <option key={target.id} value={target.id}>{target.label}</option>
              ))}
            </select>
          </label>
          <RemotePathField draft={draft} updateDraft={updateDraft} />
        </>
      );
    }
    if (kind === 'ssh') {
      return (
        <>
          <label>
            Hôte SSH
            <input
              aria-label="Hôte SSH"
              value={draft.sshHost}
              onChange={(event) => updateDraft({ sshHost: event.target.value })}
              placeholder="utilisateur@serveur"
            />
          </label>
          <RemotePathField draft={draft} updateDraft={updateDraft} />
        </>
      );
    }
    return (
      <label>
        Espace Cloud NeuraCo
        <input
          aria-label="Espace Cloud NeuraCo"
          value={draft.cloudWorkspaceId}
          onChange={(event) => updateDraft({ cloudWorkspaceId: event.target.value })}
          placeholder="default"
        />
      </label>
    );
  };

  return (
    <div className="environment-transfer-view">
      <header className="environment-transfer-heading">
        <div>
          <Box size={20} />
          <span>
            <strong>Transfert d’environnement</strong>
            <small>
              Déplacez une session vérifiée sans copier les secrets du projet.
            </small>
          </span>
        </div>
        <button
          type="button"
          title="Détecter à nouveau les environnements"
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw className={busy ? 'is-spinning' : ''} size={16} />
          Actualiser
        </button>
      </header>

      {error && <div className="environment-transfer-error">{error}</div>}

      <RemoteConnectionsSection onStatus={onStatus} />

      <div className="environment-transfer-layout">
        <section className="environment-transfer-config">
          <div className="environment-kind-picker" aria-label="Type d’environnement">
            {KINDS.map(({ id, label, icon: Icon }) => {
              const item = discovery?.capabilities.find((entry) => entry.kind === id);
              return (
                <button
                  key={id}
                  type="button"
                  className={kind === id ? 'is-active' : ''}
                  onClick={() => {
                    setKind(id);
                    setPreview(undefined);
                    setError(undefined);
                  }}
                  title={item?.reason || label}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  <i className={item?.available ? 'is-ready' : 'is-unavailable'} />
                </button>
              );
            })}
          </div>

          <div className="environment-target-fields">
            <div className="environment-capability-line">
              {capability?.available ? (
                <><CheckCircle2 size={15} /> Environnement détecté</>
              ) : (
                <><XCircle size={15} /> {capability?.reason || 'Non détecté'}</>
              )}
            </div>
            {renderTargetFields()}
            <div className="environment-transfer-actions">
              <button
                type="button"
                onClick={() => void runPreview()}
                disabled={busy || !capability?.available}
              >
                {busy
                  ? <LoaderCircle className="is-spinning" size={15} />
                  : <ShieldAlert size={15} />}
                Vérifier la compatibilité
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={() => void executeTransfer()}
                disabled={busy || !preview?.compatible}
              >
                Transférer la session
              </button>
            </div>
          </div>

          {preview && <TransferPreview preview={preview} />}
          <EnvironmentPreparationSection
            target={selectedTarget}
            onStatus={onStatus}
          />
        </section>

        <aside className="environment-transfer-history">
          <header>
            <strong>Transferts terminés</strong>
            <span>{records.length}</span>
          </header>
          {records.length === 0 ? (
            <div className="environment-transfer-empty">
              <Network size={24} />
              <p>Aucun transfert enregistré pour ce projet.</p>
            </div>
          ) : records.map((record) => (
            <article key={record.id}>
              <span className="environment-record-icon">
                <CheckCircle2 size={15} />
              </span>
              <div>
                <strong>{record.target.kind.toUpperCase()}</strong>
                <span title={targetLabel(record)}>{targetLabel(record)}</span>
                <small>{formatDate(record.createdAt)}</small>
              </div>
            </article>
          ))}
        </aside>
      </div>
    </div>
  );
}

function RemotePathField({
  draft,
  updateDraft
}: {
  draft: TargetDraft;
  updateDraft: (next: Partial<TargetDraft>) => void;
}) {
  return (
    <label>
      Chemin du projet dans la cible
      <input
        aria-label="Chemin du projet dans la cible"
        value={draft.remoteProjectPath}
        onChange={(event) => updateDraft({ remoteProjectPath: event.target.value })}
        placeholder="/workspace/projet"
      />
    </label>
  );
}

function TransferPreview({
  preview
}: {
  preview: NeuraCoEnvironmentTransferPreview;
}) {
  const preserved = [
    ['Messages', preview.preserved.conversationMessages],
    ['Objectifs', preview.preserved.goals],
    ['Agents', preview.preserved.agents],
    ['Tâches', preview.preserved.tasks],
    ['Changements', preview.preserved.changes],
    ['Résultats', preview.preserved.results]
  ];
  return (
    <section
      className={`environment-transfer-preview ${
        preview.compatible ? 'is-compatible' : 'is-blocked'
      }`}
      aria-label="Résultat de compatibilité"
    >
      <header>
        {preview.compatible
          ? <CheckCircle2 size={18} />
          : <XCircle size={18} />}
        <div>
          <strong>
            {preview.compatible ? 'Cible compatible' : 'Transfert bloqué'}
          </strong>
          <span>Contrôle effectué le {formatDate(preview.checkedAt)}</span>
        </div>
      </header>
      <div className="environment-preserved-grid">
        {preserved.map(([label, value]) => (
          <span key={String(label)}>
            <strong>{value}</strong>
            <small>{label}</small>
          </span>
        ))}
      </div>
      {preview.unavailableFiles.length > 0 && (
        <div className="environment-missing-list">
          <strong>Fichiers indisponibles</strong>
          {preview.unavailableFiles.map((file) => <code key={file}>{file}</code>)}
        </div>
      )}
      {preview.unavailableTools.length > 0 && (
        <div className="environment-missing-list">
          <strong>Outils indisponibles</strong>
          {preview.unavailableTools.map((tool) => <code key={tool}>{tool}</code>)}
        </div>
      )}
      <ul>
        {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
      </ul>
    </section>
  );
}
