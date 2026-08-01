import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bot,
  Code2,
  Download,
  FileClock,
  GitCompare,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import type {
  NeuraCoArtifact,
  NeuraCoArtifactComparison,
  NeuraCoArtifactSummary,
  NeuraCoProjectSnapshot
} from '../electron/ipc-contract';
import NativeDocumentCreator from './NativeDocumentCreator';

interface ArtifactsPanelProps {
  snapshot: NeuraCoProjectSnapshot;
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
}

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ');

const securePreview = (html: string): string => {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
  }
  return `<!doctype html><html><head>${csp}<meta charset="utf-8"></head><body>${html}</body></html>`;
};

const extractHtml = (response: string): string => {
  const fenced = response.match(/```html\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  const doctype = response.search(/<!doctype\s+html/i);
  if (doctype >= 0) return response.slice(doctype).trim();
  const html = response.search(/<html[\s>]/i);
  if (html >= 0) return response.slice(html).trim();
  throw new Error('L’agent n’a pas retourné une page HTML complète exploitable.');
};

export default function ArtifactsPanel({
  snapshot,
  emergencyStopped,
  onStatus
}: ArtifactsPanelProps) {
  const [items, setItems] = useState<NeuraCoArtifactSummary[]>([]);
  const [artifact, setArtifact] = useState<NeuraCoArtifact>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [newTitle, setNewTitle] = useState('Tableau de bord du projet');
  const [newDescription, setNewDescription] = useState('');
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [versionSummary, setVersionSummary] = useState('');
  const [previewKey, setPreviewKey] = useState(0);
  const [fromVersion, setFromVersion] = useState('');
  const [toVersion, setToVersion] = useState('');
  const [comparison, setComparison] = useState<NeuraCoArtifactComparison>();

  const open = useCallback(async (artifactId: string) => {
    if (!window.neuraco) return;
    setLoading(true);
    try {
      const next = await window.neuraco.getArtifact(artifactId);
      setArtifact(next);
      setTitle(next.title);
      setHtml(next.html);
      setVersionSummary('');
      setComparison(undefined);
      setFromVersion(next.versions[1]?.id || next.versions[0]?.id || '');
      setToVersion(next.versions[0]?.id || '');
      setPreviewKey((current) => current + 1);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Artefact indisponible.');
    } finally {
      setLoading(false);
    }
  }, [onStatus]);

  const refresh = useCallback(async (preferredId?: string) => {
    if (!window.neuraco) return;
    setLoading(true);
    try {
      const next = await window.neuraco.listArtifacts();
      setItems(next);
      const selected = preferredId
        || (artifact && next.some((item) => item.id === artifact.id)
          ? artifact.id
          : next[0]?.id);
      if (selected) await open(selected);
      else setArtifact(undefined);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Artefacts indisponibles.');
    } finally {
      setLoading(false);
    }
  }, [artifact, onStatus, open]);

  useEffect(() => {
    void refresh();
    // Loading is intentionally scoped to the project change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.project.id]);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!window.neuraco || !prompt.trim() || emergencyStopped || busy) return;
    setBusy(true);
    try {
      const response = await window.neuraco.sendAgentMessage({
        content:
          'Crée un artefact HTML interactif autonome pour la demande suivante. '
          + 'Retourne un seul document HTML complet dans un bloc ```html```. '
          + 'Utilise uniquement HTML, CSS et JavaScript intégrés. '
          + 'Aucun CDN, aucune requête réseau, aucun formulaire externe, aucun secret. '
          + `Demande : ${prompt.trim()}`,
        requestId: crypto.randomUUID(),
        sessionId: `artifact-${snapshot.project.id}`,
        projectId: snapshot.project.id,
        projectName: snapshot.project.name,
        mode: 'question',
        model: 'auto',
        files: [],
        images: []
      });
      const created = await window.neuraco.createArtifact({
        title: newTitle.trim(),
        description: newDescription.trim(),
        html: extractHtml(response.message),
        summary: `Généré par ${response.modelDisplay}`
      });
      setPrompt('');
      await refresh(created.id);
      onStatus(`Artefact créé avec ${response.modelDisplay}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Génération impossible.');
    } finally {
      setBusy(false);
    }
  };

  const saveVersion = async () => {
    if (!window.neuraco || !artifact || !html.trim() || busy || emergencyStopped) return;
    setBusy(true);
    try {
      const updated = await window.neuraco.updateArtifact(artifact.id, {
        html,
        summary: versionSummary.trim() || 'Modification manuelle',
        sources: artifact.sources
      });
      setArtifact(updated);
      setItems((current) => current.map((item) => (
        item.id === updated.id ? updated : item
      )));
      setVersionSummary('');
      setPreviewKey((current) => current + 1);
      setFromVersion(updated.versions[1]?.id || updated.versions[0].id);
      setToVersion(updated.versions[0].id);
      onStatus(`Version ${updated.versionCount} enregistrée.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!window.neuraco || !artifact || !title.trim() || busy || emergencyStopped) return;
    setBusy(true);
    try {
      const updated = await window.neuraco.renameArtifact(artifact.id, title);
      setItems((current) => current.map((item) => (
        item.id === updated.id ? updated : item
      )));
      setArtifact((current) => current ? { ...current, ...updated } : current);
      onStatus('Artefact renommé.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Renommage impossible.');
    } finally {
      setBusy(false);
    }
  };

  const compare = async () => {
    if (!window.neuraco || !artifact || !fromVersion || !toVersion || busy) return;
    setBusy(true);
    try {
      setComparison(await window.neuraco.compareArtifactVersions(
        artifact.id,
        fromVersion,
        toVersion
      ));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Comparaison impossible.');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (versionId: string) => {
    if (!window.neuraco || !artifact || busy || emergencyStopped) return;
    setBusy(true);
    try {
      const restored = await window.neuraco.restoreArtifactVersion(
        artifact.id,
        versionId
      );
      setArtifact(restored);
      setHtml(restored.html);
      setItems((current) => current.map((item) => (
        item.id === restored.id ? restored : item
      )));
      setPreviewKey((current) => current + 1);
      onStatus('Ancienne version restaurée dans une nouvelle version.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Restauration impossible.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.neuraco || !artifact || busy || emergencyStopped) return;
    setBusy(true);
    try {
      const next = await window.neuraco.deleteArtifact(artifact.id);
      setItems(next);
      setArtifact(undefined);
      if (next[0]) await open(next[0].id);
      onStatus('Artefact retiré de la liste active.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Suppression impossible.');
    } finally {
      setBusy(false);
    }
  };

  const exportArtifact = async () => {
    if (!window.neuraco || !artifact || busy) return;
    setBusy(true);
    try {
      const exported = await window.neuraco.exportArtifact(artifact.id);
      if (exported) onStatus(`Artefact exporté vers ${exported}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Export impossible.');
    } finally {
      setBusy(false);
    }
  };

  const currentVersion = useMemo(
    () => artifact?.versions.find((item) => item.id === artifact.currentVersionId),
    [artifact]
  );

  return (
    <section className="artifacts-panel" aria-label="Artefacts interactifs">
      <header>
        <div>
          <span className="panel-heading-icon"><Archive size={18} /></span>
          <div>
            <h2>Artefacts</h2>
            <p>Pages interactives isolées et versionnées pour {snapshot.project.name}</p>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Actualiser les artefacts"
          onClick={() => void refresh(artifact?.id)}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </header>

      <NativeDocumentCreator
        project={snapshot.project}
        emergencyStopped={emergencyStopped}
        onStatus={onStatus}
      />

      <div className="artifacts-layout">
        <aside className="artifact-sidebar">
          <form onSubmit={generate}>
            <h3><Bot size={15} /> Créer avec l’agent</h3>
            <label>
              <span>Titre</span>
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Description</span>
              <input
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
              />
            </label>
            <label>
              <span>Demande</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Crée un tableau de bord des tests du projet…"
                required
              />
            </label>
            <button
              type="submit"
              className="button button-primary"
              disabled={!prompt.trim() || busy || emergencyStopped}
            >
              <Play size={14} /> {busy ? 'Génération…' : 'Générer'}
            </button>
          </form>

          <nav aria-label="Liste des artefacts">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={artifact?.id === item.id ? 'is-active' : ''}
                onClick={() => void open(item.id)}
              >
                <Code2 size={14} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.versionCount} version(s)</small>
                </span>
              </button>
            ))}
            {!loading && items.length === 0 && (
              <div className="empty-panel">Aucun artefact pour ce projet.</div>
            )}
          </nav>
        </aside>

        <main className="artifact-detail">
          {!artifact && (
            <div className="empty-panel">
              Générez un artefact autonome ou sélectionnez une page existante.
            </div>
          )}
          {artifact && (
            <>
              <header>
                <div className="artifact-title-edit">
                  <input value={title} onChange={(event) => setTitle(event.target.value)} />
                  <button
                    type="button"
                    className="icon-button"
                    title="Renommer"
                    onClick={() => void rename()}
                    disabled={busy || emergencyStopped}
                  >
                    <Save size={15} />
                  </button>
                </div>
                <div>
                  <button
                    type="button"
                    title="Recharger l’aperçu"
                    onClick={() => setPreviewKey((current) => current + 1)}
                  >
                    <RefreshCw size={14} /> Actualiser
                  </button>
                  <button
                    type="button"
                    title="Exporter une copie HTML sécurisée"
                    onClick={() => void exportArtifact()}
                    disabled={busy}
                  >
                    <Download size={14} /> Exporter
                  </button>
                  <button
                    type="button"
                    className="danger"
                    title="Retirer de la liste active"
                    onClick={() => void remove()}
                    disabled={busy || emergencyStopped}
                  >
                    <Trash2 size={14} /> Supprimer
                  </button>
                </div>
              </header>

              <div className="artifact-security">
                <ShieldCheck size={14} />
                Aperçu isolé : aucun réseau, fichier local, formulaire externe ou publication.
                {artifact.sources.some((source) => source.access === 'mutating') && (
                  <strong>Connecteur modifiant des données : désactivé.</strong>
                )}
              </div>

              <div className="artifact-workbench">
                <div className="artifact-preview">
                  <iframe
                    key={previewKey}
                    title={`Aperçu de ${artifact.title}`}
                    sandbox="allow-scripts"
                    srcDoc={securePreview(html)}
                  />
                </div>
                <div className="artifact-source-editor">
                  <label>
                    <span>Source HTML</span>
                    <textarea value={html} onChange={(event) => setHtml(event.target.value)} />
                  </label>
                  <div>
                    <input
                      value={versionSummary}
                      onChange={(event) => setVersionSummary(event.target.value)}
                      placeholder="Résumé de cette version"
                    />
                    <button
                      type="button"
                      onClick={() => void saveVersion()}
                      disabled={busy || emergencyStopped || !html.trim()}
                    >
                      <Save size={14} /> Enregistrer une version
                    </button>
                  </div>
                </div>
              </div>

              <section className="artifact-history">
                <header>
                  <h3><FileClock size={15} /> Historique</h3>
                  <div>
                    <select
                      aria-label="Version de départ"
                      value={fromVersion}
                      onChange={(event) => setFromVersion(event.target.value)}
                    >
                      {artifact.versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          Version {version.number}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Version d’arrivée"
                      value={toVersion}
                      onChange={(event) => setToVersion(event.target.value)}
                    >
                      {artifact.versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          Version {version.number}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void compare()}
                      disabled={busy || !fromVersion || !toVersion}
                    >
                      <GitCompare size={14} /> Comparer
                    </button>
                  </div>
                </header>
                <div className="artifact-version-list">
                  {artifact.versions.map((version) => (
                    <div key={version.id}>
                      <span>
                        <strong>
                          Version {version.number}
                          {currentVersion?.id === version.id ? ' · actuelle' : ''}
                        </strong>
                        <small>
                          {new Date(version.createdAt).toLocaleString()} · {version.summary}
                        </small>
                      </span>
                      {currentVersion?.id !== version.id && (
                        <button
                          type="button"
                          title={`Restaurer la version ${version.number}`}
                          onClick={() => void restore(version.id)}
                          disabled={busy || emergencyStopped}
                        >
                          <RotateCcw size={13} /> Restaurer
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {comparison && (
                  <div className="artifact-diff">
                    <p>
                      +{comparison.addedLines} / -{comparison.removedLines}
                      {comparison.truncated ? ' · aperçu tronqué' : ''}
                    </p>
                    <pre>{comparison.diff || 'Aucune différence.'}</pre>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
