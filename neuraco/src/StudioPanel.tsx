import {
  Box,
  CheckCircle2,
  CircleStop,
  FileCode2,
  Gamepad2,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  XCircle
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  NeuraCoProjectSnapshot,
  NeuraCoStudioAnalysis,
  NeuraCoStudioEvent,
  NeuraCoStudioOperation,
  NeuraCoStudioOperationResult,
  NeuraCoStudioToolId
} from '../electron/ipc-contract';

interface StudioPanelProps {
  snapshot: NeuraCoProjectSnapshot;
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
}

const TOOL_LABELS: Record<NeuraCoStudioToolId, string> = {
  fivem: 'FiveM',
  blender: 'Blender',
  '3dsmax': '3ds Max'
};

const OPERATIONS: Record<NeuraCoStudioToolId, Array<{
  value: NeuraCoStudioOperation;
  label: string;
  export: boolean;
}>> = {
  fivem: [
    { value: 'fivem_validate', label: 'Valider les ressources', export: false }
  ],
  blender: [
    { value: 'blender_inspect', label: 'Inspecter la scène', export: false },
    { value: 'blender_validate', label: 'Valider la scène', export: false },
    { value: 'blender_export_gltf', label: 'Exporter en GLB', export: true }
  ],
  '3dsmax': [
    { value: 'max_inspect', label: 'Inspecter la scène', export: false },
    { value: 'max_validate', label: 'Valider la scène', export: false },
    { value: 'max_export_fbx', label: 'Exporter en FBX', export: true }
  ]
};

const eventClass = (event: NeuraCoStudioEvent) => (
  event.type === 'failed'
    ? 'is-error'
    : event.type === 'completed'
      ? 'is-success'
      : ''
);

export default function StudioPanel({
  snapshot,
  emergencyStopped,
  onStatus
}: StudioPanelProps) {
  const [analysis, setAnalysis] = useState<NeuraCoStudioAnalysis | null>(null);
  const [tool, setTool] = useState<NeuraCoStudioToolId>('fivem');
  const [operation, setOperation] = useState<NeuraCoStudioOperation>('fivem_validate');
  const [targetPath, setTargetPath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [events, setEvents] = useState<NeuraCoStudioEvent[]>([]);
  const [result, setResult] = useState<NeuraCoStudioOperationResult | null>(null);
  const [busy, setBusy] = useState('');
  const [runningTaskId, setRunningTaskId] = useState('');
  const [error, setError] = useState('');

  const selectedTool = analysis?.tools.find((item) => item.id === tool);
  const targetFiles = useMemo(() => (
    tool === 'blender'
      ? analysis?.blender.files || []
      : tool === '3dsmax'
        ? analysis?.max3d.files || []
        : []
  ), [analysis, tool]);
  const operationDefinition = OPERATIONS[tool].find((item) => item.value === operation);

  const analyze = async () => {
    if (!window.neuraco || emergencyStopped) return;
    setBusy('Analyse du projet');
    setError('');
    try {
      const next = await window.neuraco.analyzeStudioProject();
      setAnalysis(next);
      const firstDetected: NeuraCoStudioToolId = next.fiveM.detected
        ? 'fivem'
        : next.blender.detected
          ? 'blender'
          : next.max3d.detected
            ? '3dsmax'
            : 'fivem';
      setTool(firstDetected);
      setOperation(OPERATIONS[firstDetected][0].value);
      const files = firstDetected === 'blender'
        ? next.blender.files
        : firstDetected === '3dsmax'
          ? next.max3d.files
          : [];
      setTargetPath(files[0] || '');
      onStatus(`Studio analysé: ${next.scannedFiles} fichiers`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Analyse Studio impossible.';
      setError(message);
      onStatus(message);
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    void analyze();
    const unsubscribe = window.neuraco?.onStudioEvent((event) => {
      setEvents((current) => [event, ...current].slice(0, 160));
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
        setRunningTaskId('');
      }
    });
    return unsubscribe;
    // The active project is stable for the lifetime of this workspace page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectTool = (next: NeuraCoStudioToolId) => {
    setTool(next);
    const firstOperation = OPERATIONS[next][0].value;
    setOperation(firstOperation);
    const files = next === 'blender'
      ? analysis?.blender.files || []
      : next === '3dsmax'
        ? analysis?.max3d.files || []
        : [];
    setTargetPath(files[0] || '');
    setOutputPath('');
    setResult(null);
    setError('');
  };

  const run = async () => {
    if (!window.neuraco || emergencyStopped || runningTaskId) return;
    const taskId = crypto.randomUUID();
    setRunningTaskId(taskId);
    setError('');
    setResult(null);
    try {
      const completed = await window.neuraco.runStudioOperation({
        taskId,
        operation,
        targetPath: tool === 'fivem' ? undefined : targetPath,
        outputPath: operationDefinition?.export ? outputPath || undefined : undefined
      });
      setResult(completed);
      onStatus(completed.summary);
      await analyze();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Opération Studio impossible.';
      setError(message);
      onStatus(message);
    } finally {
      setRunningTaskId('');
    }
  };

  const cancel = async () => {
    if (!window.neuraco || !runningTaskId) return;
    await window.neuraco.cancelStudioOperation(runningTaskId);
    setRunningTaskId('');
    onStatus('Opération Studio interrompue');
  };

  const requiresTarget = tool !== 'fivem';
  const canRun = (
    Boolean(analysis)
    && !emergencyStopped
    && !runningTaskId
    && (!requiresTarget || (Boolean(targetPath) && Boolean(selectedTool?.installed)))
    && (!operationDefinition?.export || Boolean(outputPath.trim()))
  );

  return (
    <div className="studio-panel">
      <header className="studio-header">
        <div>
          <Box size={18} />
          <span>
            <strong>Studio structuré</strong>
            <small>FiveM · API Python Blender · MAXScript 3ds Max</small>
          </span>
        </div>
        <button
          type="button"
          disabled={Boolean(busy) || emergencyStopped}
          onClick={() => void analyze()}
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
          Analyser
        </button>
      </header>

      {error && <div className="studio-error"><XCircle size={14} />{error}</div>}

      <div className="studio-body">
        <aside className="studio-tools">
          {(analysis?.tools || []).map((item) => (
            <button
              type="button"
              key={item.id}
              className={tool === item.id ? 'is-active' : ''}
              onClick={() => selectTool(item.id)}
            >
              {item.id === 'fivem' ? <Gamepad2 size={17} /> : <Box size={17} />}
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.installed
                    ? item.version
                      ? `Détecté · ${item.version}`
                      : 'Détecté'
                    : item.id === 'fivem'
                      ? 'Analyse fichiers disponible'
                      : 'Non détecté'}
                </small>
              </span>
              {item.installed || item.id === 'fivem'
                ? <CheckCircle2 size={14} />
                : <TriangleAlert size={14} />}
            </button>
          ))}
          {!analysis && (
            <div className="studio-loading">
              <LoaderCircle className="spin" size={18} />
              Analyse en cours…
            </div>
          )}
        </aside>

        <main className="studio-detail">
          <section className="studio-summary">
            <header>
              <div>
                {tool === 'fivem' ? <Gamepad2 size={18} /> : <Box size={18} />}
                <span>
                  <h2>{TOOL_LABELS[tool]}</h2>
                  <p>{selectedTool?.integration || 'Intégration structurée locale'}</p>
                </span>
              </div>
              <span className="studio-scan-count">
                {analysis?.scannedFiles || 0} fichiers · {analysis?.durationMs || 0} ms
              </span>
            </header>

            {tool === 'fivem' && (
              <div className="studio-manifests">
                {analysis?.fiveM.manifests.map((manifest) => (
                  <article key={manifest.path}>
                    <div>
                      <FileCode2 size={15} />
                      <strong>{manifest.path}</strong>
                      <span>{manifest.fxVersion || 'fx_version absent'}</span>
                    </div>
                    <p>
                      {manifest.scripts.length} fichier(s) · {manifest.dependencies.length} dépendance(s)
                    </p>
                    {manifest.missingFiles.length > 0 && (
                      <small>{manifest.missingFiles.length} référence(s) introuvable(s)</small>
                    )}
                  </article>
                ))}
                {analysis && !analysis.fiveM.detected && (
                  <p className="studio-empty">
                    Aucun `fxmanifest.lua` ou `__resource.lua` détecté dans ce projet.
                  </p>
                )}
              </div>
            )}

            {tool !== 'fivem' && (
              <div className="studio-scenes">
                <label>
                  <span>Scène du projet</span>
                  <select
                    value={targetPath}
                    onChange={(event) => setTargetPath(event.target.value)}
                  >
                    {targetFiles.map((file) => <option key={file}>{file}</option>)}
                  </select>
                </label>
                {targetFiles.length === 0 && (
                  <p className="studio-empty">
                    Aucun fichier {tool === 'blender' ? '.blend' : '.max'} détecté.
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="studio-operation">
            <header>
              <strong>Opération contrôlée</strong>
              <span><ShieldCheck size={13} /> Scripts prédéfinis, aucun code arbitraire</span>
            </header>
            <div className="studio-operation-form">
              <label>
                <span>Action</span>
                <select
                  value={operation}
                  onChange={(event) => {
                    const next = event.target.value as NeuraCoStudioOperation;
                    setOperation(next);
                    if (next === 'blender_export_gltf' && targetPath) {
                      setOutputPath(`${targetPath.replace(/\.blend$/i, '')}.glb`);
                    }
                    if (next === 'max_export_fbx' && targetPath) {
                      setOutputPath(`${targetPath.replace(/\.max$/i, '')}.fbx`);
                    }
                  }}
                >
                  {OPERATIONS[tool].map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              {operationDefinition?.export && (
                <label>
                  <span>Sortie dans le projet</span>
                  <input
                    value={outputPath}
                    onChange={(event) => setOutputPath(event.target.value)}
                    placeholder={tool === 'blender' ? 'exports/modele.glb' : 'exports/scene.fbx'}
                  />
                </label>
              )}
              {runningTaskId ? (
                <button type="button" className="studio-cancel" onClick={() => void cancel()}>
                  <CircleStop size={15} /> Arrêter
                </button>
              ) : (
                <button type="button" disabled={!canRun} onClick={() => void run()}>
                  <Play size={15} /> Exécuter
                </button>
              )}
            </div>
          </section>

          <div className="studio-results">
            <section>
              <header><strong>Problèmes détectés</strong></header>
              <div className="studio-issues">
                {(analysis?.issues.filter((issue) => issue.tool === tool) || []).map(
                  (issue, index) => (
                    <div key={`${issue.path}-${index}`} className={`is-${issue.severity}`}>
                      {issue.severity === 'error'
                        ? <XCircle size={13} />
                        : <TriangleAlert size={13} />}
                      <span>
                        <strong>{issue.path || TOOL_LABELS[tool]}</strong>
                        <small>{issue.message}</small>
                      </span>
                    </div>
                  )
                )}
                {analysis && analysis.issues.filter((issue) => issue.tool === tool).length === 0 && (
                  <p className="studio-empty">Aucun problème statique détecté.</p>
                )}
              </div>
            </section>

            <section>
              <header><strong>Journal d’exécution</strong></header>
              <div className="studio-events">
                {events.map((event, index) => (
                  <div key={`${event.taskId}-${event.timestamp}-${index}`} className={eventClass(event)}>
                    <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                    <span>{event.message}</span>
                  </div>
                ))}
                {events.length === 0 && <p className="studio-empty">Aucune opération lancée.</p>}
              </div>
            </section>
          </div>

          {result && (
            <section className={`studio-report ${result.ok ? 'is-success' : 'is-error'}`}>
              <header>
                {result.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                <strong>{result.summary}</strong>
                <span>{result.durationMs} ms</span>
              </header>
              <pre>{result.output || 'Rapport vide.'}</pre>
            </section>
          )}
        </main>
      </div>

      <footer className="studio-footer">
        <span>{snapshot.project.name}</span>
        <span>Les scènes originales ne sont jamais écrasées par une inspection.</span>
        <span>{runningTaskId ? `Tâche ${runningTaskId.slice(0, 8)}` : 'Prêt'}</span>
      </footer>
    </div>
  );
}
