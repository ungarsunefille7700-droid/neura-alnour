import { useMemo, useState } from 'react';
import {
  Bot,
  Download,
  Eye,
  FileOutput,
  ShieldCheck
} from 'lucide-react';
import type {
  NeuraCoNativeDocumentDraft,
  NeuraCoNativeDocumentFormat,
  NeuraCoNativeDocumentPreview,
  NeuraCoProject
} from '../electron/ipc-contract';

interface NativeDocumentCreatorProps {
  project: NeuraCoProject;
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
}

const FORMATS: Array<[NeuraCoNativeDocumentFormat, string]> = [
  ['docx', 'Word (.docx)'],
  ['pdf', 'PDF (.pdf)'],
  ['pptx', 'PowerPoint (.pptx)'],
  ['xlsx', 'Excel (.xlsx)'],
  ['csv', 'CSV (.csv)'],
  ['markdown', 'Markdown (.md)'],
  ['html', 'HTML (.html)'],
  ['json', 'JSON (.json)']
];

const contentLanguage = (
  format: NeuraCoNativeDocumentFormat
): string => {
  if (format === 'json') return 'json';
  if (format === 'html') return 'html';
  if (format === 'csv' || format === 'xlsx') return 'csv';
  return 'markdown';
};

const extractContent = (
  response: string,
  language: string
): string => {
  const preferred = response.match(
    new RegExp(`\\\`\\\`\\\`${language}\\s*([\\s\\S]*?)\\\`\\\`\\\``, 'i')
  );
  if (preferred?.[1]?.trim()) return preferred[1].trim();
  const anyFence = response.match(/```[a-z0-9_-]*\s*([\s\S]*?)```/i);
  return anyFence?.[1]?.trim() || response.trim();
};

export default function NativeDocumentCreator({
  project,
  emergencyStopped,
  onStatus
}: NativeDocumentCreatorProps) {
  const [draft, setDraft] = useState<NeuraCoNativeDocumentDraft>({
    title: 'Rapport NeuraCo',
    description: '',
    format: 'docx',
    content: '# Rapport\n\nDécrivez ou générez le contenu du document.',
    author: 'NeuraCo'
  });
  const [request, setRequest] = useState('');
  const [preview, setPreview] = useState<NeuraCoNativeDocumentPreview>();
  const [previewKey, setPreviewKey] = useState('');
  const [busy, setBusy] = useState(false);
  const draftKey = useMemo(() => JSON.stringify(draft), [draft]);

  const patch = (next: Partial<NeuraCoNativeDocumentDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
  };

  const createPreview = async (value = draft) => {
    if (!window.neuraco) return;
    setBusy(true);
    try {
      const next = await window.neuraco.previewNativeDocument(value);
      setPreview(next);
      setPreviewKey(JSON.stringify(value));
      onStatus(`Aperçu ${next.format.toUpperCase()} validé.`);
    } catch (error) {
      setPreview(undefined);
      setPreviewKey('');
      onStatus(error instanceof Error ? error.message : 'Aperçu impossible.');
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!window.neuraco || !request.trim() || emergencyStopped || busy) return;
    setBusy(true);
    try {
      const language = contentLanguage(draft.format);
      const formatRules = draft.format === 'pptx'
        ? 'Sépare chaque diapositive par une ligne --- et commence chaque diapositive par # Titre.'
        : draft.format === 'xlsx' || draft.format === 'csv'
          ? 'Retourne un tableau CSV complet avec une ligne d’en-tête.'
          : draft.format === 'json'
            ? 'Retourne un JSON strictement valide.'
            : draft.format === 'html'
              ? 'Retourne un document HTML autonome sans réseau, CDN ni script externe.'
              : 'Retourne un document structuré en Markdown avec titres, paragraphes et listes.';
      const response = await window.neuraco.sendAgentMessage({
        content:
          `Crée un vrai document source destiné à un export ${draft.format.toUpperCase()}. `
          + `${formatRules} Retourne uniquement le contenu dans un bloc \`\`\`${language}\`\`\`. `
          + 'N’invente pas les données manquantes : signale clairement toute information non vérifiée. '
          + `Demande : ${request.trim()}`,
        requestId: crypto.randomUUID(),
        sessionId: `native-document-${project.id}`,
        projectId: project.id,
        projectName: project.name,
        mode: 'question',
        model: 'auto',
        files: [],
        images: []
      });
      const nextDraft = {
        ...draft,
        content: extractContent(response.message, language)
      };
      setDraft(nextDraft);
      setPreview(undefined);
      setPreviewKey('');
      onStatus(`Source ${draft.format.toUpperCase()} générée avec ${response.modelDisplay}. Prévisualisez-la avant l’export.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Génération impossible.');
    } finally {
      setBusy(false);
    }
  };

  const exportDocument = async () => {
    if (
      !window.neuraco
      || !preview
      || previewKey !== draftKey
      || busy
      || emergencyStopped
    ) return;
    setBusy(true);
    try {
      const result = await window.neuraco.exportNativeDocument(
        draft,
        preview.previewId
      );
      if (result) {
        onStatus(
          `${result.format.toUpperCase()} natif exporté : ${result.path} `
          + `(${result.size} octets, SHA-256 vérifié).`
        );
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Export impossible.');
    } finally {
      setBusy(false);
    }
  };

  const previewCurrent = preview && previewKey === draftKey ? preview : undefined;

  return (
    <section className="native-document-creator">
      <header>
        <div>
          <FileOutput size={16} />
          <div>
            <h3>Documents natifs</h3>
            <p>DOCX, PDF, PPTX, XLSX, CSV, Markdown, HTML et JSON réels.</p>
          </div>
        </div>
        <span><ShieldCheck size={13} /> Aperçu obligatoire</span>
      </header>
      <div className="native-document-layout">
        <div className="native-document-form">
          <div className="native-document-row">
            <label>
              <span>Format</span>
              <select
                value={draft.format}
                disabled={busy}
                onChange={(event) => patch({
                  format: event.target.value as NeuraCoNativeDocumentFormat
                })}
              >
                {FORMATS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Titre</span>
              <input
                value={draft.title}
                disabled={busy}
                onChange={(event) => patch({ title: event.target.value })}
              />
            </label>
          </div>
          <label>
            <span>Description</span>
            <input
              value={draft.description}
              disabled={busy}
              placeholder="Objet du livrable"
              onChange={(event) => patch({ description: event.target.value })}
            />
          </label>
          <label>
            <span>Demande à l’agent</span>
            <div className="native-agent-request">
              <input
                value={request}
                disabled={busy || emergencyStopped}
                placeholder="Analyse ces informations et prépare un rapport…"
                onChange={(event) => setRequest(event.target.value)}
              />
              <button
                type="button"
                disabled={busy || emergencyStopped || !request.trim()}
                onClick={() => void generate()}
              >
                <Bot size={14} /> Générer
              </button>
            </div>
          </label>
          <label>
            <span>Source du document</span>
            <textarea
              value={draft.content}
              disabled={busy}
              spellCheck
              onChange={(event) => patch({ content: event.target.value })}
            />
          </label>
          <div className="native-document-actions">
            <button
              type="button"
              disabled={busy || !draft.title.trim() || !draft.content.trim()}
              onClick={() => void createPreview()}
            >
              <Eye size={14} /> Prévisualiser
            </button>
            <button
              type="button"
              disabled={busy || emergencyStopped || !previewCurrent}
              onClick={() => void exportDocument()}
            >
              <Download size={14} /> Exporter {draft.format.toUpperCase()}
            </button>
          </div>
        </div>
        <div className="native-document-preview">
          {previewCurrent ? (
            <>
              <div>
                <strong>{previewCurrent.format.toUpperCase()}</strong>
                <span>
                  {previewCurrent.itemCount} élément(s) · {previewCurrent.mimeType}
                </span>
              </div>
              <iframe
                title={`Aperçu ${draft.title}`}
                sandbox=""
                srcDoc={previewCurrent.previewHtml}
              />
            </>
          ) : (
            <div className="native-document-empty">
              Prévisualisez la dernière version avant de pouvoir l’exporter.
            </div>
          )}
        </div>
      </div>
      <small>
        Les images natives restent créées dans l’onglet Images uniquement lorsque
        le fournisseur sélectionné les prend réellement en charge.
      </small>
    </section>
  );
}
