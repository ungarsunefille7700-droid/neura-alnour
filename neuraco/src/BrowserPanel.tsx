import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronDown,
  CodeXml,
  Download,
  ExternalLink,
  Globe2,
  History,
  Laptop,
  LoaderCircle,
  Monitor,
  MousePointer2,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Save,
  ScanSearch,
  ShieldCheck,
  Smartphone,
  Square,
  Tablet,
  X
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NeuraCoApplication,
  NeuraCoApplicationProcess,
  NeuraCoBrowserAction,
  NeuraCoBrowserAnnotation,
  NeuraCoBrowserCapture,
  NeuraCoBrowserDiagnostics,
  NeuraCoBrowserDownload,
  NeuraCoBrowserElement,
  NeuraCoBrowserEvent,
  NeuraCoBrowserHistoryEntry,
  NeuraCoBrowserState,
  NeuraCoProjectSnapshot
} from '../electron/ipc-contract';
import { browserDownloadProgress, formatBrowserBytes } from './browser-downloads';
import {
  BROWSER_REFRESH_INTERVALS,
  normalizeBrowserRefreshInterval
} from './browser-refresh';

interface BrowserPanelProps {
  snapshot: NeuraCoProjectSnapshot;
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
}

type BrowserMode =
  | 'navigation'
  | 'selection'
  | 'annotation'
  | 'control'
  | 'verification'
  | 'responsive'
  | 'performance';

type DeviceMode = 'fluid' | 'desktop' | 'tablet' | 'mobile';

const EMPTY_STATE: NeuraCoBrowserState = {
  tabs: [],
  controlling: false,
  profile: 'isolated'
};

const MODES: Array<{ id: BrowserMode; label: string }> = [
  { id: 'navigation', label: 'Navigation' },
  { id: 'selection', label: 'Sélection' },
  { id: 'annotation', label: 'Annotation' },
  { id: 'control', label: 'Contrôle' },
  { id: 'verification', label: 'Vérification' },
  { id: 'responsive', label: 'Responsive' },
  { id: 'performance', label: 'Performance' }
];

const DEVICE_WIDTHS: Record<DeviceMode, number | undefined> = {
  fluid: undefined,
  desktop: 1280,
  tablet: 768,
  mobile: 390
};

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Action navigateur impossible.'
);

export default function BrowserPanel({
  snapshot,
  emergencyStopped,
  onStatus
}: BrowserPanelProps) {
  const [state, setState] = useState<NeuraCoBrowserState>(EMPTY_STATE);
  const [address, setAddress] = useState('http://localhost:3000');
  const [mode, setMode] = useState<BrowserMode>('navigation');
  const [device, setDevice] = useState<DeviceMode>('fluid');
  const [events, setEvents] = useState<NeuraCoBrowserEvent[]>([]);
  const [history, setHistory] = useState<NeuraCoBrowserHistoryEntry[]>([]);
  const [downloads, setDownloads] = useState<NeuraCoBrowserDownload[]>([]);
  const [annotations, setAnnotations] = useState<NeuraCoBrowserAnnotation[]>([]);
  const [applications, setApplications] = useState<NeuraCoApplication[]>([]);
  const [processes, setProcesses] = useState<NeuraCoApplicationProcess[]>([]);
  const [selected, setSelected] = useState<NeuraCoBrowserElement | null>(null);
  const [annotation, setAnnotation] = useState('');
  const [actionType, setActionType] = useState<NeuraCoBrowserAction['type']>('click');
  const [selector, setSelector] = useState('');
  const [actionText, setActionText] = useState('');
  const [capture, setCapture] = useState<NeuraCoBrowserCapture | null>(null);
  const [diagnostics, setDiagnostics] = useState<NeuraCoBrowserDiagnostics | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [autoRefreshMs, setAutoRefreshMs] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const autoRefreshBusyRef = useRef(false);

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId),
    [state]
  );

  const execute = useCallback(async <T,>(
    label: string,
    action: () => Promise<T>
  ): Promise<T | undefined> => {
    setBusy(label);
    setError('');
    try {
      const result = await action();
      onStatus(label);
      return result;
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      onStatus(message);
      return undefined;
    } finally {
      setBusy('');
    }
  }, [onStatus]);

  const refreshState = useCallback(async () => {
    if (!window.neuraco) return;
    const next = await window.neuraco.getBrowserState();
    setState(next);
    const active = next.tabs.find((tab) => tab.id === next.activeTabId);
    if (active && active.url !== 'about:blank') setAddress(active.url);
  }, []);

  const refreshMetadata = useCallback(async () => {
    if (!window.neuraco) return;
    const [nextHistory, nextDownloads, nextAnnotations, nextApplications] = await Promise.all([
      window.neuraco.getBrowserHistory(),
      window.neuraco.getBrowserDownloads(),
      window.neuraco.getBrowserAnnotations(),
      window.neuraco.listApplications()
    ]);
    setHistory(nextHistory);
    setDownloads(nextDownloads);
    setAnnotations(nextAnnotations);
    setApplications(nextApplications);
  }, []);

  const syncBounds = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || capture || !window.neuraco) return;
    const rect = viewport.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) return;
    void window.neuraco.setBrowserBounds({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    });
  }, [capture]);

  useEffect(() => {
    void execute('Navigateur prêt', async () => {
      await Promise.all([refreshState(), refreshMetadata()]);
      return true;
    });
    const unsubscribe = window.neuraco?.onBrowserEvent((event) => {
      setEvents((current) => [event, ...current].slice(0, 120));
      if (event.type === 'state' || event.type === 'network' || event.type === 'blocked') {
        void refreshState();
      }
      if (event.type === 'network' || event.type === 'download') void refreshMetadata();
    });
    return () => {
      unsubscribe?.();
      void window.neuraco?.hideBrowser();
    };
  }, [execute, refreshMetadata, refreshState]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(syncBounds);
    observer?.observe(viewport);
    window.addEventListener('resize', syncBounds);
    window.addEventListener('scroll', syncBounds, true);
    const timer = window.setTimeout(syncBounds, 30);
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.removeEventListener('scroll', syncBounds, true);
    };
  }, [device, sideOpen, syncBounds]);

  useEffect(() => {
    if (!autoRefreshMs || !activeTab || emergencyStopped) return;
    const timer = window.setInterval(async () => {
      if (autoRefreshBusyRef.current || activeTab.loading || !window.neuraco) return;
      autoRefreshBusyRef.current = true;
      try {
        const next = await window.neuraco.browserReload();
        setState(next);
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        setAutoRefreshMs(0);
        onStatus(`Rafraîchissement automatique arrêté: ${message}`);
      } finally {
        autoRefreshBusyRef.current = false;
      }
    }, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [activeTab, autoRefreshMs, emergencyStopped, onStatus]);

  const navigate = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!window.neuraco || emergencyStopped || !address.trim()) return;
    const next = await execute('Navigation terminée', () => (
      window.neuraco!.navigateBrowser(address.trim())
    ));
    if (next) {
      setCapture(null);
      setDiagnostics(null);
      setState(next);
      window.setTimeout(syncBounds, 20);
    }
  };

  const selectElement = async () => {
    if (!window.neuraco || emergencyStopped) return;
    setCapture(null);
    window.setTimeout(syncBounds, 20);
    const element = await execute('Élément DOM sélectionné', () => (
      window.neuraco!.selectBrowserElement()
    ));
    if (element) {
      setSelected(element);
      setSelector(element.selector);
      setMode('annotation');
    }
  };

  const saveAnnotation = async () => {
    if (!window.neuraco || !activeTab || !annotation.trim()) return;
    const saved = await execute('Annotation enregistrée', () => (
      window.neuraco!.saveBrowserAnnotation({
        tabId: activeTab.id,
        url: activeTab.url,
        selector: selected?.selector,
        rect: selected?.rect,
        comment: annotation
      })
    ));
    if (saved) {
      setAnnotations((current) => [saved, ...current]);
      setAnnotation('');
    }
  };

  const runAction = async () => {
    if (!window.neuraco || emergencyStopped) return;
    const action: NeuraCoBrowserAction = actionType === 'scroll'
      ? { type: 'scroll', y: Number(actionText || 500), x: 0 }
      : {
          type: actionType,
          selector: selector.trim(),
          text: actionType === 'type' ? actionText : undefined
        };
    const result = await execute('Action navigateur terminée', () => (
      window.neuraco!.runBrowserAction(action)
    ));
    if (result) await refreshState();
  };

  const capturePage = async () => {
    if (!window.neuraco) return;
    const image = await execute('Capture créée', () => window.neuraco!.captureBrowser());
    if (image) {
      await window.neuraco.hideBrowser();
      setCapture(image);
    }
  };

  const inspectPage = async () => {
    if (!window.neuraco || emergencyStopped) return;
    const result = await execute('Diagnostic navigateur terminé', () => (
      window.neuraco!.inspectBrowserDiagnostics()
    ));
    if (result) {
      setDiagnostics(result);
      setMode('verification');
      setSideOpen(true);
    }
  };

  const closeCapture = () => {
    setCapture(null);
    window.setTimeout(syncBounds, 20);
  };

  const launchApplication = async (applicationId: string) => {
    if (!window.neuraco || emergencyStopped) return;
    const launched = await execute('Application lancée', () => (
      window.neuraco!.launchApplication(applicationId)
    ));
    if (launched) setProcesses((current) => [...current, launched]);
  };

  const stopApplication = async (processId: string) => {
    if (!window.neuraco) return;
    const stopped = await execute('Application arrêtée', () => (
      window.neuraco!.stopApplication(processId)
    ));
    if (stopped) setProcesses((current) => current.filter((item) => item.id !== processId));
  };

  const viewportStyle = DEVICE_WIDTHS[device]
    ? { width: `min(100%, ${DEVICE_WIDTHS[device]}px)` }
    : undefined;

  return (
    <div className="browser-panel">
      {(state.controlling || events[0]?.type === 'action') && (
        <div className="browser-control-banner">
          <MousePointer2 size={15} />
          NeuraCo contrôle le navigateur isolé. L’arrêt d’urgence reste disponible.
        </div>
      )}

      <div className="browser-tabs">
        {state.tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={tab.id === state.activeTabId ? 'is-active' : ''}
            onClick={async () => {
              const next = await window.neuraco?.activateBrowserTab(tab.id);
              if (next) setState(next);
              window.setTimeout(syncBounds, 20);
            }}
            title={tab.url}
          >
            {tab.loading ? <LoaderCircle className="spin" size={13} /> : <Globe2 size={13} />}
            <span>{tab.title || 'Nouvel onglet'}</span>
            <X
              size={12}
              onClick={async (event) => {
                event.stopPropagation();
                const next = await window.neuraco?.closeBrowserTab(tab.id);
                if (next) setState(next);
              }}
            />
          </button>
        ))}
        <button
          type="button"
          className="browser-new-tab"
          title="Nouvel onglet isolé"
          onClick={async () => {
            const next = await window.neuraco?.newBrowserTab();
            if (next) setState(next);
            setAddress('http://localhost:3000');
          }}
        >
          <Plus size={15} />
        </button>
      </div>

      <form className="browser-toolbar" onSubmit={(event) => void navigate(event)}>
        <button
          type="button"
          title="Retour"
          disabled={!activeTab?.canGoBack}
          onClick={async () => setState(await window.neuraco!.browserBack())}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          title="Suivant"
          disabled={!activeTab?.canGoForward}
          onClick={async () => setState(await window.neuraco!.browserForward())}
        >
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          title="Actualiser"
          onClick={async () => setState(await window.neuraco!.browserReload())}
        >
          <RefreshCw size={14} />
        </button>
        <label className="browser-address">
          {activeTab?.secure ? <ShieldCheck size={14} /> : <Globe2 size={14} />}
          <input
            aria-label="Adresse du navigateur"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="http://localhost:3000 ou https://example.com"
          />
        </label>
        <button type="submit" disabled={Boolean(busy) || emergencyStopped} title="Ouvrir">
          <Play size={14} />
        </button>
        <button type="button" onClick={() => void capturePage()} title="Capturer la page">
          <Camera size={14} />
        </button>
        <button
          type="button"
          onClick={() => void window.neuraco?.toggleBrowserDevTools()}
          title="Outils de développement"
        >
          <CodeXml size={15} />
        </button>
        <button type="button" onClick={() => setSideOpen((value) => !value)} title="Panneau">
          <PanelRight size={15} />
        </button>
      </form>

      <div className="browser-modebar">
        <div className="browser-modes">
          {MODES.map((item) => (
            <button
              type="button"
              key={item.id}
              className={mode === item.id ? 'is-active' : ''}
              onClick={() => {
                setMode(item.id);
                if (item.id === 'selection') void selectElement();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="browser-auto-refresh">
          <RefreshCw size={13} />
          <span>Auto</span>
          <select
            aria-label="Rafraîchissement automatique"
            value={autoRefreshMs}
            onChange={(event) => setAutoRefreshMs(
              normalizeBrowserRefreshInterval(Number(event.target.value))
            )}
          >
            {BROWSER_REFRESH_INTERVALS.map((interval) => (
              <option key={interval} value={interval}>
                {interval === 0 ? 'Désactivé' : `${interval / 1000} s`}
              </option>
            ))}
          </select>
        </label>
        <div className="browser-devices" aria-label="Taille de prévisualisation">
          {([
            ['fluid', Laptop],
            ['desktop', Monitor],
            ['tablet', Tablet],
            ['mobile', Smartphone]
          ] as const).map(([value, Icon]) => (
            <button
              type="button"
              key={value}
              className={device === value ? 'is-active' : ''}
              onClick={() => setDevice(value)}
              title={value}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>

      {error && <div className="browser-error">{error}</div>}

      <div className={`browser-body ${sideOpen ? 'has-side' : ''}`}>
        <main className="browser-stage">
          <div className={`browser-device-frame is-${device}`} style={viewportStyle}>
            {capture ? (
              <div className="browser-capture">
                <img src={capture.dataUrl} alt={`Capture de ${capture.url}`} />
                <button type="button" onClick={closeCapture}>
                  <X size={14} /> Fermer la capture
                </button>
              </div>
            ) : (
              <div ref={viewportRef} className="browser-native-viewport">
                {!activeTab && (
                  <div className="browser-placeholder">
                    <Globe2 size={34} />
                    <strong>Navigateur isolé NeuraCo</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {sideOpen && (
          <aside className="browser-side">
            {mode === 'annotation' && (
              <section>
                <header><MousePointer2 size={14} /><strong>Élément sélectionné</strong></header>
                {selected ? (
                  <>
                    <code>{selected.selector}</code>
                    <small>{selected.tag} · {selected.role || 'sans rôle'} · {selected.type || 'sans type'}</small>
                    <p>{selected.text || 'Aucun texte visible.'}</p>
                    <textarea
                      value={annotation}
                      onChange={(event) => setAnnotation(event.target.value)}
                      placeholder="Commentaire ou instruction pour cet élément…"
                    />
                    <button
                      type="button"
                      disabled={!annotation.trim()}
                      onClick={() => void saveAnnotation()}
                    >
                      <Save size={14} /> Enregistrer l’annotation
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => void selectElement()}>
                    <MousePointer2 size={14} /> Sélectionner dans la page
                  </button>
                )}
              </section>
            )}

            {mode === 'control' && (
              <section>
                <header><MousePointer2 size={14} /><strong>Action DOM contrôlée</strong></header>
                <select
                  value={actionType}
                  onChange={(event) => setActionType(event.target.value as NeuraCoBrowserAction['type'])}
                >
                  <option value="click">Cliquer</option>
                  <option value="focus">Donner le focus</option>
                  <option value="type">Saisir du texte</option>
                  <option value="scroll">Faire défiler</option>
                </select>
                {actionType !== 'scroll' && (
                  <input
                    value={selector}
                    onChange={(event) => setSelector(event.target.value)}
                    placeholder="Sélecteur CSS vérifié"
                  />
                )}
                {(actionType === 'type' || actionType === 'scroll') && (
                  <textarea
                    value={actionText}
                    onChange={(event) => setActionText(event.target.value)}
                    placeholder={actionType === 'scroll' ? 'Distance verticale, ex. 500' : 'Texte à saisir'}
                  />
                )}
                <button
                  type="button"
                  disabled={Boolean(busy) || emergencyStopped || (
                    actionType !== 'scroll' && !selector.trim()
                  )}
                  onClick={() => void runAction()}
                >
                  <Play size={14} /> Exécuter avec autorisation
                </button>
                <small>Paiements, mots de passe, CAPTCHA, publications et suppressions définitives sont bloqués.</small>
              </section>
            )}

            {(mode === 'verification' || mode === 'performance') && (
              <>
                <section>
                  <header><ScanSearch size={14} /><strong>Diagnostic de la page</strong></header>
                  <button
                    type="button"
                    disabled={Boolean(busy) || activeTab?.loading || emergencyStopped}
                    onClick={() => void inspectPage()}
                  >
                    <ScanSearch size={14} /> Analyser la page actuelle
                  </button>
                  {diagnostics && (
                    <div className="browser-diagnostics">
                      <div className="browser-diagnostic-metrics">
                        <span>
                          <b>{diagnostics.metrics.viewportWidth} × {diagnostics.metrics.viewportHeight}</b>
                          <small>Fenêtre</small>
                        </span>
                        <span>
                          <b>{diagnostics.metrics.resourceCount}</b>
                          <small>Ressources</small>
                        </span>
                        <span>
                          <b>{diagnostics.metrics.loadMs ?? '—'} ms</b>
                          <small>Chargement</small>
                        </span>
                        <span>
                          <b>{diagnostics.issues.length}</b>
                          <small>Signalements</small>
                        </span>
                      </div>
                      <div className="browser-diagnostic-issues">
                        {diagnostics.issues.length === 0 && (
                          <p className="is-clear">Aucune erreur détectée dans les contrôles exécutés.</p>
                        )}
                        {diagnostics.issues.map((issue, index) => (
                          <div
                            key={`${issue.source}-${issue.message}-${index}`}
                            className={`is-${issue.severity}`}
                          >
                            <span>{issue.source} · {issue.severity}</span>
                            <p>{issue.message}</p>
                            {issue.selector && <code>{issue.selector}</code>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
                <section>
                  <header><CodeXml size={14} /><strong>Console et réseau</strong></header>
                  <div className="browser-events">
                    {events.length === 0 && <small>Aucun événement capturé.</small>}
                    {events.map((item, index) => (
                      <div key={`${item.timestamp}-${index}`} className={`is-${item.level || item.type}`}>
                        <span>{item.type}</span>
                        <p>{item.message}</p>
                        <time>{new Date(item.timestamp).toLocaleTimeString()}</time>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {mode === 'responsive' && (
              <section>
                <header><Monitor size={14} /><strong>Responsive</strong></header>
                <p>
                  Prévisualisation active : <b>{device}</b>
                  {DEVICE_WIDTHS[device] ? ` · ${DEVICE_WIDTHS[device]} px` : ' · largeur disponible'}.
                </p>
                <small>La page utilise le vrai moteur Chromium isolé, pas une image simulée.</small>
              </section>
            )}

            {mode === 'navigation' && (
              <>
                <section>
                  <header><History size={14} /><strong>Historique local</strong></header>
                  <div className="browser-history">
                    {history.slice(0, 12).map((entry) => (
                      <button
                        type="button"
                        key={entry.id}
                        onClick={() => {
                          setAddress(entry.url);
                          void execute('Navigation terminée', async () => {
                            const next = await window.neuraco!.navigateBrowser(entry.url);
                            setState(next);
                            return next;
                          });
                        }}
                      >
                        <span>{entry.title}</span>
                        <small>{entry.url}</small>
                      </button>
                    ))}
                    {history.length === 0 && <small>Aucune page visitée.</small>}
                  </div>
                </section>
                <section>
                  <header><Download size={14} /><strong>Téléchargements</strong></header>
                  <div className="browser-downloads">
                    {downloads.slice(0, 8).map((download) => {
                      const progress = browserDownloadProgress(download);
                      return (
                        <div key={download.id} className={`is-${download.state}`}>
                          <span>
                            <b>{download.filename}</b>
                            <small>
                              {formatBrowserBytes(download.receivedBytes)}
                              {download.totalBytes > 0
                                ? ` / ${formatBrowserBytes(download.totalBytes)}`
                                : ''}
                              {' · '}
                              {download.state}
                            </small>
                          </span>
                          {progress !== null && (
                            <progress
                              max={100}
                              value={progress}
                              aria-label={`Progression de ${download.filename}`}
                            />
                          )}
                        </div>
                      );
                    })}
                    {downloads.length === 0 && <small>Aucun téléchargement dans cette session.</small>}
                  </div>
                </section>
                <section>
                  <header><AppWindow size={14} /><strong>Applications autorisées</strong></header>
                  <div className="browser-applications">
                    {applications.map((application) => {
                      const running = processes.find(
                        (process) => process.applicationId === application.id
                      );
                      return (
                        <div key={application.id}>
                          <span>
                            <b>{application.name}</b>
                            <small>{application.installed ? 'Détectée' : 'Non installée'}</small>
                          </span>
                          {running ? (
                            <button type="button" onClick={() => void stopApplication(running.id)}>
                              <Square size={12} /> Arrêter
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={!application.installed || emergencyStopped}
                              onClick={() => void launchApplication(application.id)}
                            >
                              <ExternalLink size={12} /> Ouvrir
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
                {annotations.length > 0 && (
                  <section>
                    <header><MousePointer2 size={14} /><strong>Annotations</strong></header>
                    {annotations.slice(0, 5).map((item) => (
                      <div key={item.id} className="browser-annotation">
                        <code>{item.selector || 'Page entière'}</code>
                        <p>{item.comment}</p>
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
          </aside>
        )}
      </div>

      <footer className="browser-footer">
        <span><ShieldCheck size={13} /> Profil isolé</span>
        <span>{snapshot.project.name}</span>
        <span>{busy || activeTab?.error || activeTab?.url || 'about:blank'}</span>
        <button type="button" onClick={() => setMode('navigation')}>
          <ChevronDown size={13} /> Navigation
        </button>
      </footer>
    </div>
  );
}
