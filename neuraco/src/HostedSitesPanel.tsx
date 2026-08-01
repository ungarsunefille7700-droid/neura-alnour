import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  FileCode2,
  Globe2,
  LoaderCircle,
  MonitorPlay,
  RefreshCw,
  ShieldCheck,
  Square
} from 'lucide-react';
import type {
  NeuraCoHostedSiteDeployment,
  NeuraCoHostedSiteKind,
  NeuraCoHostedSitePreview,
  NeuraCoHostedSiteProviderStatus,
  NeuraCoHostedSiteVisibility
} from '../electron/ipc-contract';

interface HostedSitesPanelProps {
  emergencyStopped: boolean;
  onOpenPreview: (address: string) => Promise<void>;
  onStatus: (message: string) => void;
}

const SITE_KINDS: Array<{ value: NeuraCoHostedSiteKind; label: string }> = [
  { value: 'site', label: 'Site' },
  { value: 'dashboard', label: 'Tableau de bord' },
  { value: 'internal_tool', label: 'Outil interne' },
  { value: 'gallery', label: 'Galerie' },
  { value: 'web_app', label: 'Application Web légère' },
  { value: 'web_game', label: 'Jeu Web simple' },
  { value: 'revision_space', label: 'Espace de révision' }
];

const splitValues = (value: string): string[] => (
  value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
);

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
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

export default function HostedSitesPanel({
  emergencyStopped,
  onOpenPreview,
  onStatus
}: HostedSitesPanelProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<NeuraCoHostedSiteKind>('site');
  const [sourceDirectory, setSourceDirectory] = useState('dist');
  const [visibility, setVisibility] = useState<NeuraCoHostedSiteVisibility>('local');
  const [environmentVariables, setEnvironmentVariables] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [preview, setPreview] = useState<NeuraCoHostedSitePreview>();
  const [deployments, setDeployments] = useState<NeuraCoHostedSiteDeployment[]>([]);
  const [provider, setProvider] = useState<NeuraCoHostedSiteProviderStatus>();
  const [activePreviewId, setActivePreviewId] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const canPublish = useMemo(
    () => visibility === 'public' && provider?.available === true,
    [provider, visibility]
  );

  const clearPreview = () => {
    setPreview(undefined);
    setError(undefined);
  };

  const refresh = async () => {
    if (!window.neuraco || busy) return;
    setBusy('refresh');
    setError(undefined);
    try {
      const [loadedDeployments, loadedProvider] = await Promise.all([
        window.neuraco.listHostedSiteDeployments(),
        window.neuraco.getHostedSiteProviderStatus()
      ]);
      setDeployments(loadedDeployments);
      setProvider(loadedProvider);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Impossible de charger les sites.'
      );
    } finally {
      setBusy(undefined);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const analyze = async () => {
    if (!window.neuraco || emergencyStopped || busy) return;
    setBusy('analyze');
    setError(undefined);
    try {
      const analyzed = await window.neuraco.previewHostedSite({
        name,
        kind,
        sourceDirectory,
        visibility,
        environmentVariables: splitValues(environmentVariables),
        authorizedPeople: [],
        hostingDurationDays: durationDays
          ? Number.parseInt(durationDays, 10)
          : undefined
      });
      setPreview(analyzed);
      onStatus(
        `${analyzed.files.length} fichier(s) vérifiés, `
        + `${formatBytes(analyzed.totalBytes)} à publier.`
      );
    } catch (previewError) {
      setPreview(undefined);
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Analyse du site impossible.'
      );
    } finally {
      setBusy(undefined);
    }
  };

  const startLocalPreview = async () => {
    if (!window.neuraco || !preview || emergencyStopped || busy) return;
    setBusy('local');
    setError(undefined);
    try {
      const session = await window.neuraco.startHostedSitePreview(preview.id);
      setActivePreviewId(preview.id);
      await onOpenPreview(session.address);
      onStatus(`Aperçu local ouvert : ${session.address}`);
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Aperçu local impossible.'
      );
    } finally {
      setBusy(undefined);
    }
  };

  const stopLocalPreview = async () => {
    if (!window.neuraco || !activePreviewId || busy) return;
    setBusy('stop');
    try {
      await window.neuraco.stopHostedSitePreview(activePreviewId);
      setActivePreviewId(undefined);
      onStatus('Serveur d’aperçu local arrêté.');
    } catch (stopError) {
      setError(
        stopError instanceof Error
          ? stopError.message
          : 'Arrêt de l’aperçu impossible.'
      );
    } finally {
      setBusy(undefined);
    }
  };

  const deploy = async () => {
    if (!window.neuraco || !preview || !canPublish || emergencyStopped || busy) return;
    setBusy('deploy');
    setError(undefined);
    try {
      const deployment = await window.neuraco.deployHostedSite(preview.id);
      setDeployments((current) => [
        deployment,
        ...current.filter((item) => item.id !== deployment.id)
      ]);
      setPreview(undefined);
      onStatus(`Site publié : ${deployment.address}`);
      await onOpenPreview(deployment.address);
    } catch (deploymentError) {
      setError(
        deploymentError instanceof Error
          ? deploymentError.message
          : 'Déploiement impossible.'
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="hosted-sites-view">
      <header className="hosted-sites-heading">
        <div>
          <Globe2 size={20} />
          <div>
            <strong>Sites et outils hébergés</strong>
            <span>
              Prévisualisation locale et publication contrôlée depuis les fichiers du projet.
            </span>
          </div>
        </div>
        <button
          type="button"
          title="Actualiser"
          disabled={Boolean(busy)}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} className={busy === 'refresh' ? 'is-spinning' : ''} />
        </button>
      </header>

      {error && <div className="hosted-sites-error">{error}</div>}

      <div className="hosted-sites-layout">
        <section className="hosted-sites-config">
          <header>
            <div>
              <FileCode2 size={17} />
              <strong>Préparer un site</strong>
            </div>
            <span className={provider?.available ? 'is-ready' : 'is-unavailable'}>
              {provider?.available
                ? `Vercel ${provider.version || 'disponible'}`
                : 'Publication Vercel indisponible'}
            </span>
          </header>

          <div className="hosted-sites-fields">
            <label>
              Nom
              <input
                value={name}
                placeholder="Portail client"
                onChange={(event) => {
                  setName(event.target.value);
                  clearPreview();
                }}
              />
            </label>
            <label>
              Type
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as NeuraCoHostedSiteKind);
                  clearPreview();
                }}
              >
                {SITE_KINDS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>
              Dossier à publier
              <input
                value={sourceDirectory}
                placeholder="dist, build ou out"
                onChange={(event) => {
                  setSourceDirectory(event.target.value);
                  clearPreview();
                }}
              />
            </label>
            <label>
              Durée d’hébergement
              <select
                value={durationDays}
                onChange={(event) => {
                  setDurationDays(event.target.value);
                  clearPreview();
                }}
              >
                <option value="">Jusqu’à suppression manuelle</option>
                <option value="7">7 jours</option>
                <option value="30">30 jours</option>
                <option value="90">90 jours</option>
                <option value="365">1 an</option>
              </select>
            </label>
          </div>

          <div className="hosted-visibility-picker" aria-label="Visibilité">
            <button
              type="button"
              className={visibility === 'local' ? 'is-active' : ''}
              onClick={() => {
                setVisibility('local');
                clearPreview();
              }}
            >
              <MonitorPlay size={16} />
              <span>Aperçu local</span>
              <small>Visible uniquement sur ce PC</small>
            </button>
            <button
              type="button"
              className={visibility === 'public' ? 'is-active' : ''}
              onClick={() => {
                setVisibility('public');
                clearPreview();
              }}
            >
              <CloudUpload size={16} />
              <span>Publication publique</span>
              <small>Confirmation Windows obligatoire</small>
            </button>
          </div>

          <div className="hosted-sites-text-fields">
            <label>
              Variables d’environnement requises
              <textarea
                value={environmentVariables}
                placeholder={'PUBLIC_API_URL\nANALYTICS_ID\n\nNoms uniquement, jamais les valeurs.'}
                onChange={(event) => {
                  setEnvironmentVariables(event.target.value);
                  clearPreview();
                }}
              />
            </label>
          </div>

          <div className="hosted-sites-security">
            <ShieldCheck size={17} />
            <p>
              Les fichiers <code>.env</code>, clés, certificats et identifiants sont exclus.
              Une modification après l’analyse annule automatiquement la publication.
            </p>
          </div>

          <button
            type="button"
            className="hosted-sites-analyze"
            disabled={!name.trim() || !sourceDirectory.trim() || Boolean(busy) || emergencyStopped}
            onClick={() => void analyze()}
          >
            {busy === 'analyze'
              ? <LoaderCircle size={16} className="is-spinning" />
              : <FileCode2 size={16} />}
            Analyser les fichiers
          </button>

          {preview && (
            <section className="hosted-site-preview-summary">
              <header>
                <CheckCircle2 size={18} />
                <div>
                  <strong>Récapitulatif avant action</strong>
                  <span>Valide jusqu’au {formatDate(preview.expiresAt)}</span>
                </div>
              </header>
              <dl>
                <div><dt>Adresse prévue</dt><dd>{preview.plannedAddress}</dd></div>
                <div><dt>Visibilité</dt><dd>{preview.visibility === 'public' ? 'Publique' : 'Locale'}</dd></div>
                <div><dt>Environnement</dt><dd>{preview.environmentVariables.join(', ') || 'Aucune variable'}</dd></div>
                <div><dt>Crédits</dt><dd>{preview.estimatedCredits} crédit IA estimé</dd></div>
                <div><dt>Durée</dt><dd>{preview.hostingDurationLabel}</dd></div>
                <div><dt>Accès</dt><dd>{preview.authorizedPeople.join(', ')}</dd></div>
                <div><dt>Technologie</dt><dd>{preview.framework}</dd></div>
                <div><dt>Volume</dt><dd>{formatBytes(preview.totalBytes)}</dd></div>
              </dl>
              <details open>
                <summary>Fichiers publiés ({preview.files.length})</summary>
                <div className="hosted-site-file-list">
                  {preview.files.map((file) => (
                    <span key={file.relativePath}>
                      <code>{file.relativePath}</code>
                      <small>{formatBytes(file.size)}</small>
                    </span>
                  ))}
                </div>
              </details>
              <footer>
                {activePreviewId === preview.id ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void stopLocalPreview()}
                  >
                    <Square size={15} /> Arrêter l’aperçu
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void startLocalPreview()}
                  >
                    <MonitorPlay size={15} /> Tester localement
                  </button>
                )}
                {preview.visibility === 'public' && (
                  <button
                    type="button"
                    className="is-primary"
                    disabled={!canPublish || Boolean(busy)}
                    onClick={() => void deploy()}
                  >
                    {busy === 'deploy'
                      ? <LoaderCircle size={15} className="is-spinning" />
                      : <CloudUpload size={15} />}
                    Confirmer la publication
                  </button>
                )}
              </footer>
            </section>
          )}
        </section>

        <aside className="hosted-sites-history">
          <header>
            <div>
              <CloudUpload size={17} />
              <strong>Déploiements</strong>
            </div>
            <span>{deployments.length}</span>
          </header>
          {deployments.length === 0 ? (
            <div className="hosted-sites-empty">
              <Globe2 size={28} />
              <p>Aucun site publié pour ce projet.</p>
            </div>
          ) : deployments.map((deployment) => (
            <article key={deployment.id}>
              <div>
                <strong>{deployment.name}</strong>
                <span>{formatDate(deployment.deployedAt)}</span>
              </div>
              <a
                href={deployment.address}
                onClick={(event) => {
                  event.preventDefault();
                  void onOpenPreview(deployment.address);
                }}
              >
                {deployment.address}
                <ExternalLink size={13} />
              </a>
              <small>
                {deployment.files.length} fichiers · {formatBytes(deployment.totalBytes)}
              </small>
            </article>
          ))}
        </aside>
      </div>
    </div>
  );
}
