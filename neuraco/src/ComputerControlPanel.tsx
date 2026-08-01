import {
  AppWindow,
  Camera,
  Crosshair,
  LoaderCircle,
  MousePointerClick,
  OctagonX,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  Type,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  NeuraCoComputerActionPlan,
  NeuraCoComputerActionType,
  NeuraCoComputerCapture,
  NeuraCoComputerElement,
  NeuraCoComputerInspection,
  NeuraCoComputerWindow
} from '../electron/ipc-contract';

interface ComputerControlPanelProps {
  emergencyStopped: boolean;
  onEmergencyStop: () => Promise<void>;
  onStatus: (message: string) => void;
}

const messageFrom = (error: unknown): string => (
  error instanceof Error ? error.message : 'Contrôle PC impossible.'
);

export default function ComputerControlPanel({
  emergencyStopped,
  onEmergencyStop,
  onStatus
}: ComputerControlPanelProps) {
  const [windows, setWindows] = useState<NeuraCoComputerWindow[]>([]);
  const [windowId, setWindowId] = useState('');
  const [inspection, setInspection] = useState<NeuraCoComputerInspection | null>(null);
  const [capture, setCapture] = useState<NeuraCoComputerCapture | null>(null);
  const [selected, setSelected] = useState<NeuraCoComputerElement | null>(null);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<NeuraCoComputerActionType>('focus');
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<NeuraCoComputerActionPlan | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [activity, setActivity] = useState<string[]>([]);

  const run = async <T,>(label: string, operation: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError('');
    try {
      const result = await operation();
      onStatus(label);
      return result;
    } catch (caught) {
      const message = messageFrom(caught);
      setError(message);
      onStatus(message);
      return undefined;
    } finally {
      setBusy('');
    }
  };

  const refreshWindows = async () => {
    if (!window.neuraco) return;
    const next = await run('Fenêtres autorisées actualisées', () => (
      window.neuraco!.listComputerWindows()
    ));
    if (!next) return;
    setWindows(next);
    if (!next.some((item) => item.id === windowId)) {
      setWindowId(next[0]?.id || '');
      setInspection(null);
      setCapture(null);
      setSelected(null);
      setPlan(null);
    }
  };

  useEffect(() => {
    void refreshWindows();
    // The desktop bridge and active workspace remain stable while the panel is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inspect = async () => {
    if (!window.neuraco || !windowId || emergencyStopped) return;
    const result = await run('Fenêtre inspectée en lecture seule', () => (
      Promise.all([
        window.neuraco!.inspectComputerWindow(windowId),
        window.neuraco!.captureComputerWindow(windowId)
      ])
    ));
    if (!result) return;
    setInspection(result[0]);
    setCapture(result[1]);
    setSelected(null);
    setPlan(null);
    setActivity((current) => [
      `Inspection: ${result[0].elements.length} élément(s) UI Automation`,
      ...current
    ].slice(0, 30));
  };

  const actionableElements = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (inspection?.elements || []).filter((element) => (
      element.actionable
      && !element.password
      && (
        !needle
        || element.name.toLowerCase().includes(needle)
        || element.automationId.toLowerCase().includes(needle)
        || element.controlType.toLowerCase().includes(needle)
      )
    ));
  }, [inspection, query]);

  const prepare = async () => {
    if (!window.neuraco || !selected || emergencyStopped) return;
    const next = await run('Plan de contrôle PC préparé', () => (
      window.neuraco!.planComputerAction({
        windowId,
        elementRuntimeId: selected.runtimeId,
        action,
        text: action === 'type' ? text : undefined
      })
    ));
    if (next) {
      setPlan(next);
      setActivity((current) => [`Plan: ${next.explanation}`, ...current].slice(0, 30));
    }
  };

  const cancel = async () => {
    if (!window.neuraco || !plan) return;
    await window.neuraco.cancelComputerPlan(plan.id);
    setActivity((current) => [`Plan annulé: ${plan.explanation}`, ...current].slice(0, 30));
    setPlan(null);
  };

  const execute = async () => {
    if (!window.neuraco || !plan || emergencyStopped) return;
    const result = await run('Action UI Automation exécutée', () => (
      window.neuraco!.executeComputerPlan(plan.id)
    ));
    if (!result) return;
    setActivity((current) => [
      `Exécuté: ${plan.explanation}`,
      ...current
    ].slice(0, 30));
    setPlan({ ...plan, status: 'completed' });
    const refreshed = await window.neuraco.captureComputerWindow(windowId).catch(() => null);
    if (refreshed) setCapture(refreshed);
  };

  const activeWindow = inspection?.window
    || windows.find((candidate) => candidate.id === windowId);
  const pointerStyle = plan && capture && activeWindow
    ? {
        left: `${((plan.pointer.x - activeWindow.bounds.x) / capture.width) * 100}%`,
        top: `${((plan.pointer.y - activeWindow.bounds.y) / capture.height) * 100}%`
      }
    : undefined;

  return (
    <div className="computer-control-panel">
      <header className="computer-control-header">
        <span>
          <ShieldAlert size={17} />
          <strong>Contrôle PC expérimental</strong>
          <small>Windows UI Automation · liste blanche · confirmation obligatoire</small>
        </span>
        <button
          type="button"
          className="computer-emergency-stop"
          onClick={() => void onEmergencyStop()}
          disabled={emergencyStopped}
        >
          <OctagonX size={15} />
          {emergencyStopped ? 'Arrêt actif' : 'Arrêt d’urgence'}
        </button>
      </header>

      {error && <div className="computer-control-error">{error}</div>}
      {emergencyStopped && (
        <div className="computer-control-stopped">
          Toutes les actions PC sont suspendues. Examinez la situation avant de reprendre.
        </div>
      )}

      <div className="computer-control-toolbar">
        <label>
          <AppWindow size={14} />
          <select
            aria-label="Fenêtre Windows autorisée"
            value={windowId}
            onChange={(event) => {
              setWindowId(event.target.value);
              setInspection(null);
              setCapture(null);
              setSelected(null);
              setPlan(null);
            }}
          >
            {windows.length === 0 && <option value="">Aucune fenêtre autorisée détectée</option>}
            {windows.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title} · {candidate.processName}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void refreshWindows()} disabled={Boolean(busy)}>
          <RefreshCw size={14} /> Actualiser
        </button>
        <button
          type="button"
          onClick={() => void inspect()}
          disabled={!windowId || Boolean(busy) || emergencyStopped}
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : <ScanSearch size={14} />}
          Inspecter et capturer
        </button>
      </div>

      <div className="computer-control-body">
        <section className="computer-capture-stage">
          {capture ? (
            <div className="computer-capture-image">
              <img src={capture.dataUrl} alt={`Capture de ${activeWindow?.title || 'la fenêtre'}`} />
              {pointerStyle && (
                <span className="computer-action-pointer" style={pointerStyle}>
                  <Crosshair size={24} />
                </span>
              )}
            </div>
          ) : (
            <div className="computer-capture-empty">
              <Camera size={32} />
              <strong>Capture locale de la fenêtre</strong>
              <p>Sélectionnez une application autorisée puis lancez l’inspection.</p>
            </div>
          )}
          {activeWindow && (
            <footer>
              <span>{activeWindow.title}</span>
              <span>
                {activeWindow.bounds.width} × {activeWindow.bounds.height}
                {' · PID '}{activeWindow.processId}
              </span>
            </footer>
          )}
        </section>

        <aside className="computer-control-side">
          <section>
            <header><Crosshair size={14} /><strong>Éléments actionnables</strong></header>
            <input
              aria-label="Rechercher un élément UI Automation"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nom, type ou AutomationId"
            />
            <div className="computer-elements">
              {actionableElements.slice(0, 100).map((element) => (
                <button
                  type="button"
                  key={element.runtimeId}
                  className={selected?.runtimeId === element.runtimeId ? 'is-active' : ''}
                  onClick={() => {
                    setSelected(element);
                    setAction(/Edit|ComboBox/i.test(element.controlType) ? 'type' : 'focus');
                    setPlan(null);
                  }}
                >
                  <span>{element.name || element.controlType}</span>
                  <small>{element.controlType} · {element.automationId || 'sans AutomationId'}</small>
                </button>
              ))}
              {inspection && actionableElements.length === 0 && (
                <small>Aucun élément actionnable ne correspond au filtre.</small>
              )}
            </div>
          </section>

          {selected && (
            <section className="computer-action-builder">
              <header><MousePointerClick size={14} /><strong>Action prévue</strong></header>
              <div className="computer-selected-element">
                <b>{selected.name || selected.controlType}</b>
                <small>
                  {selected.controlType} · {Math.round(selected.bounds.x)}, {Math.round(selected.bounds.y)}
                </small>
              </div>
              <label>
                Action
                <select
                  value={action}
                  onChange={(event) => setAction(
                    event.target.value as NeuraCoComputerActionType
                  )}
                >
                  <option value="focus">Donner le focus</option>
                  <option value="click">Cliquer</option>
                  {/Edit|ComboBox/i.test(selected.controlType) && (
                    <option value="type">Saisir du texte</option>
                  )}
                </select>
              </label>
              {action === 'type' && (
                <label>
                  <span><Type size={12} /> Texte</span>
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={4000}
                    placeholder="Texte visible qui sera saisi après confirmation"
                  />
                </label>
              )}
              <button
                type="button"
                onClick={() => void prepare()}
                disabled={Boolean(busy) || emergencyStopped || (action === 'type' && !text)}
              >
                <Crosshair size={14} /> Prévisualiser l’action
              </button>
            </section>
          )}

          {plan && (
            <section className={`computer-action-plan is-${plan.status}`}>
              <header><ShieldAlert size={14} /><strong>Confirmation requise</strong></header>
              <p>{plan.explanation}</p>
              <dl>
                <dt>Application</dt><dd>{plan.window.title}</dd>
                <dt>Élément</dt><dd>{plan.element.name || plan.element.controlType}</dd>
                <dt>Pointeur</dt><dd>{plan.pointer.x}, {plan.pointer.y}</dd>
                <dt>Expiration</dt><dd>{new Date(plan.expiresAt).toLocaleTimeString()}</dd>
              </dl>
              {plan.status === 'pending' ? (
                <div>
                  <button type="button" onClick={() => void cancel()}>
                    <X size={14} /> Annuler
                  </button>
                  <button
                    type="button"
                    onClick={() => void execute()}
                    disabled={Boolean(busy) || emergencyStopped}
                  >
                    <MousePointerClick size={14} /> Confirmer dans Windows
                  </button>
                </div>
              ) : (
                <small>Action exécutée et journalisée.</small>
              )}
            </section>
          )}

          {activity.length > 0 && (
            <section>
              <header><ScanSearch size={14} /><strong>Journal local</strong></header>
              <div className="computer-activity">
                {activity.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
