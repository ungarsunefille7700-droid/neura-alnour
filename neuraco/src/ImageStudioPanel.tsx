import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Coins,
  CopyPlus,
  Download,
  Eraser,
  Grid3X3,
  History,
  ImagePlus,
  LayoutTemplate,
  LoaderCircle,
  ScanSearch,
  Scaling,
  Shapes,
  ShieldCheck,
  Upload,
  WandSparkles
} from 'lucide-react';
import type {
  NeuraCoImageStudioJob,
  NeuraCoImageStudioOperation
} from '../electron/ipc-contract';
import {
  formatImageBytes,
  prepareImageAttachment,
  resizePreparedImage,
  type NeuraCoPreparedImage
} from './image-attachments';

interface ImageStudioPanelProps {
  onStatus: (message: string) => void;
}

const OPERATIONS: Array<{
  id: NeuraCoImageStudioOperation;
  label: string;
  icon: typeof ImagePlus;
}> = [
  { id: 'generate', label: 'Générer', icon: ImagePlus },
  { id: 'edit', label: 'Modifier', icon: WandSparkles },
  { id: 'mockup', label: 'Maquette', icon: LayoutTemplate },
  { id: 'icon', label: 'Icône', icon: Shapes },
  { id: 'texture', label: 'Texture', icon: Grid3X3 },
  { id: 'reference', label: 'Référence', icon: ScanSearch },
  { id: 'remove_background', label: 'Détourer', icon: Eraser },
  { id: 'resize', label: 'Dimensions', icon: Scaling },
  { id: 'variants', label: 'Variantes', icon: CopyPlus }
];

const SOURCE_REQUIRED = new Set<NeuraCoImageStudioOperation>([
  'edit',
  'remove_background',
  'resize'
]);

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

const usageText = (job: NeuraCoImageStudioJob): string => {
  const parts = [`${job.usage.creditsConsumed.toFixed(2)} crédit(s)`];
  if (typeof job.usage.costUsd === 'number') {
    parts.push(`${job.usage.costUsd.toFixed(4)} $ fournisseur`);
  }
  if (typeof job.usage.totalTokens === 'number') {
    parts.push(`${job.usage.totalTokens} tokens`);
  }
  return parts.join(' · ');
};

export default function ImageStudioPanel({ onStatus }: ImageStudioPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [operation, setOperation] = useState<NeuraCoImageStudioOperation>('generate');
  const [prompt, setPrompt] = useState('');
  const [variants, setVariants] = useState(1);
  const [source, setSource] = useState<NeuraCoPreparedImage>();
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [jobs, setJobs] = useState<NeuraCoImageStudioJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [error, setError] = useState<string>();

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || jobs[0],
    [jobs, selectedJobId]
  );

  const loadJobs = async () => {
    if (!window.neuraco) return;
    const next = await window.neuraco.listImageStudioJobs(60);
    setJobs(next);
    setSelectedJobId((current) => (
      current && next.some((job) => job.id === current)
        ? current
        : next[0]?.id
    ));
  };

  useEffect(() => {
    void loadJobs().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Historique image indisponible.');
    });
  }, []);

  useEffect(() => {
    if (!window.neuraco || !selectedJob) {
      setPreviews({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      selectedJob.outputs.map(async (output) => {
        const preview = await window.neuraco!.getImageStudioPreview(output.id);
        return [output.id, preview.dataUrl] as const;
      })
    ).then((entries) => {
      if (!cancelled) setPreviews(Object.fromEntries(entries));
    }).catch((previewError) => {
      if (!cancelled) {
        setError(
          previewError instanceof Error
            ? previewError.message
            : 'Aperçu image indisponible.'
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedJob?.id]);

  const selectSource = async (file: File | undefined) => {
    if (!file) return;
    setSourceBusy(true);
    setError(undefined);
    try {
      const prepared = await prepareImageAttachment(file);
      setSource(prepared);
      if (operation === 'resize') {
        setWidth(prepared.width);
        setHeight(prepared.height);
      }
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : 'Image source invalide.');
    } finally {
      setSourceBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const create = async () => {
    if (!window.neuraco || busy) return;
    if (SOURCE_REQUIRED.has(operation) && !source) {
      setError('Ajoutez une image source pour cette opération.');
      return;
    }
    if (
      !prompt.trim()
      && operation !== 'remove_background'
      && operation !== 'resize'
    ) {
      setError('Décrivez précisément le résultat attendu.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const localOutput = operation === 'resize' && source
        ? await resizePreparedImage(source, width, height)
        : undefined;
      const job = await window.neuraco.createImageStudioJob({
        requestId: crypto.randomUUID(),
        operation,
        prompt: prompt.trim(),
        variants: operation === 'resize' ? 1 : variants,
        source,
        localOutput: localOutput
          ? {
              mimeType: localOutput.mimeType,
              dataBase64: localOutput.dataBase64,
              width: localOutput.width,
              height: localOutput.height
            }
          : undefined
      });
      await loadJobs();
      setSelectedJobId(job.id);
      onStatus(
        `${job.outputs.length} résultat(s) créé(s). L’image originale est conservée.`
      );
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Création image impossible.');
    } finally {
      setBusy(false);
    }
  };

  const exportOutput = async (outputId: string) => {
    if (!window.neuraco) return;
    setError(undefined);
    try {
      const destination = await window.neuraco.exportImageStudioOutput(outputId);
      if (destination) onStatus(`Copie exportée : ${destination}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Export image impossible.');
    }
  };

  return (
    <section className="image-studio-view" aria-label="Atelier Images NeuraCo">
      <header className="image-studio-heading">
        <div>
          <span><ImagePlus size={20} /></span>
          <div>
            <strong>Atelier Images</strong>
            <small>Génération, modification et copies locales sans écraser l’original</small>
          </div>
        </div>
        <span><ShieldCheck size={15} /> Original protégé</span>
      </header>

      {error && <div className="image-studio-error" role="alert">{error}</div>}

      <div className="image-studio-layout">
        <section className="image-studio-controls">
          <div className="image-studio-operations" aria-label="Type d’opération">
            {OPERATIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={operation === item.id ? 'is-active' : ''}
                  onClick={() => {
                    setOperation(item.id);
                    setError(undefined);
                    if (item.id === 'resize' && source) {
                      setWidth(source.width);
                      setHeight(source.height);
                    }
                  }}
                  title={item.label}
                >
                  <Icon size={15} /> {item.label}
                </button>
              );
            })}
          </div>

          <label className="image-studio-prompt">
            <span>Demande</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                operation === 'resize'
                  ? 'Description facultative de cette copie'
                  : 'Décrivez précisément le résultat visuel attendu…'
              }
              maxLength={4000}
            />
            <small>{prompt.length}/4000</small>
          </label>

          <div className="image-studio-source">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => void selectSource(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sourceBusy}
            >
              {sourceBusy
                ? <LoaderCircle className="spin" size={16} />
                : <Upload size={16} />}
              {source ? 'Changer la source' : 'Ajouter une source'}
            </button>
            {source && (
              <div>
                <img src={source.preview} alt="Image source conservée" />
                <span>
                  <strong>{source.name}</strong>
                  <small>
                    {source.width} × {source.height} · {formatImageBytes(source.size)}
                  </small>
                </span>
                <button
                  type="button"
                  className="is-icon"
                  onClick={() => setSource(undefined)}
                  title="Retirer la source"
                  aria-label="Retirer la source"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          {operation === 'resize' ? (
            <div className="image-studio-dimensions">
              <label>
                <span>Largeur</span>
                <input
                  type="number"
                  min={1}
                  max={20000}
                  value={width}
                  onChange={(event) => setWidth(Number(event.target.value))}
                />
              </label>
              <span>×</span>
              <label>
                <span>Hauteur</span>
                <input
                  type="number"
                  min={1}
                  max={20000}
                  value={height}
                  onChange={(event) => setHeight(Number(event.target.value))}
                />
              </label>
            </div>
          ) : (
            <label className="image-studio-variants">
              <span>Variantes</span>
              <input
                type="number"
                min={1}
                max={4}
                value={variants}
                onChange={(event) => setVariants(
                  Math.max(1, Math.min(4, Number(event.target.value) || 1))
                )}
              />
              <small>Chaque variante distante consomme séparément.</small>
            </label>
          )}

          <button
            type="button"
            className="image-studio-create"
            onClick={() => void create()}
            disabled={busy || sourceBusy}
          >
            {busy
              ? <LoaderCircle className="spin" size={17} />
              : operation === 'resize'
                ? <Scaling size={17} />
                : <WandSparkles size={17} />}
            {busy
              ? 'Traitement en cours…'
              : operation === 'resize'
                ? 'Créer la copie'
                : 'Générer avec autorisation'}
          </button>
        </section>

        <section className="image-studio-results">
          <header>
            <div>
              <WandSparkles size={18} />
              <strong>Résultats</strong>
            </div>
            {selectedJob && <small>{formatDate(selectedJob.createdAt)}</small>}
          </header>

          {!selectedJob ? (
            <div className="image-studio-empty">
              <ImagePlus size={30} />
              <p>Aucun résultat enregistré pour ce projet.</p>
            </div>
          ) : (
            <>
              <div className="image-studio-gallery">
                {selectedJob.outputs.map((output) => (
                  <article key={output.id}>
                    <div className="image-studio-preview">
                      {previews[output.id]
                        ? <img src={previews[output.id]} alt={`Résultat ${output.variant}`} />
                        : <LoaderCircle className="spin" size={24} />}
                    </div>
                    <footer>
                      <span>
                        <strong>Variante {output.variant}</strong>
                        <small>
                          {output.width && output.height
                            ? `${output.width} × ${output.height} · `
                            : ''}
                          {formatImageBytes(output.size)}
                        </small>
                      </span>
                      <button
                        type="button"
                        onClick={() => void exportOutput(output.id)}
                        title="Exporter une copie"
                      >
                        <Download size={15} /> Exporter
                      </button>
                    </footer>
                  </article>
                ))}
              </div>

              <div className="image-studio-metadata">
                <span>
                  <WandSparkles size={15} />
                  <strong>{selectedJob.modelDisplay}</strong>
                  <small>{selectedJob.provider} · {selectedJob.model}</small>
                </span>
                <span>
                  <Coins size={15} />
                  <strong>Consommation</strong>
                  <small>{usageText(selectedJob)}</small>
                </span>
                <span>
                  <ShieldCheck size={15} />
                  <strong>Droits et original</strong>
                  <small>{selectedJob.rights.message} Original conservé.</small>
                </span>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="image-studio-history">
        <header>
          <History size={17} />
          <strong>Historique du projet</strong>
          <span>{jobs.length}</span>
        </header>
        {jobs.length === 0 ? (
          <p>Aucune création enregistrée.</p>
        ) : (
          <div>
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={selectedJob?.id === job.id ? 'is-active' : ''}
                onClick={() => setSelectedJobId(job.id)}
              >
                <span>
                  <strong>
                    {OPERATIONS.find((item) => item.id === job.operation)?.label
                      || job.operation}
                  </strong>
                  <small>{job.outputs.length} résultat(s) · {job.modelDisplay}</small>
                </span>
                <small>{formatDate(job.createdAt)}</small>
              </button>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
