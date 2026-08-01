import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleStop,
  Link,
  Link2Off,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Server,
  ShieldCheck,
  Square
} from 'lucide-react';
import type {
  NeuraCoBackgroundProcess,
  NeuraCoBackgroundProcessAction,
  NeuraCoProjectSnapshot
} from '../electron/ipc-contract';

interface BackgroundProcessesPanelProps {
  snapshot: NeuraCoProjectSnapshot;
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
}

const ACTIVE_STATES = new Set(['starting', 'running', 'detached', 'stopping']);

const formatDuration = (durationMs: number): string => {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours} h ${minutes} min`
    : minutes > 0
      ? `${minutes} min ${remainder} s`
      : `${remainder} s`;
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 Mo';
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

const STATE_LABELS: Record<NeuraCoBackgroundProcess['state'], string> = {
  starting: 'Démarrage',
  running: 'Actif',
  detached: 'Détaché',
  stopping: 'Arrêt en cours',
  stopped: 'Arrêté',
  exited: 'Terminé',
  failed: 'Échec',
  orphaned: 'Introuvable'
};

export default function BackgroundProcessesPanel({
  snapshot,
  emergencyStopped,
  onStatus
}: BackgroundProcessesPanelProps) {
  const [processes, setProcesses] = useState<NeuraCoBackgroundProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [openedLog, setOpenedLog] = useState<string>();
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [name, setName] = useState('Serveur de développement');
  const [command, setCommand] = useState('');
  const [agent, setAgent] = useState('Agent développeur');
  const [workingDirectory, setWorkingDirectory] = useState('.');
  const [port, setPort] = useState('');
  const [keepAlive, setKeepAlive] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!window.neuraco) return;
    if (!silent) setLoading(true);
    try {
      const next = await window.neuraco.listBackgroundProcesses();
      setProcesses(next);
    } catch (error) {
      if (!silent) {
        onStatus(error instanceof Error ? error.message : 'Processus indisponibles.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onStatus]);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.neuraco?.onBackgroundProcessEvent(() => {
      void refresh(true);
    });
    const timer = window.setInterval(() => void refresh(true), 2500);
    return () => {
      unsubscribe?.();
      window.clearInterval(timer);
    };
  }, [refresh]);

  const activeCount = useMemo(
    () => processes.filter((item) => ACTIVE_STATES.has(item.state)).length,
    [processes]
  );

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!window.neuraco || !command.trim() || emergencyStopped || starting) return;
    setStarting(true);
    try {
      const started = await window.neuraco.startBackgroundProcess({
        name: name.trim(),
        command: command.trim(),
        agent: agent.trim(),
        workingDirectory: workingDirectory.trim() || '.',
        port: port.trim() ? Number(port) : undefined,
        keepAlive
      });
      setCommand('');
      setProcesses((current) => [
        started,
        ...current.filter((item) => item.id !== started.id)
      ]);
      onStatus(`${started.name} a démarré avec le PID ${started.pid}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Démarrage impossible.');
    } finally {
      setStarting(false);
    }
  };

  const control = async (
    process: NeuraCoBackgroundProcess,
    action: NeuraCoBackgroundProcessAction
  ) => {
    if (!window.neuraco || busyId) return;
    setBusyId(process.id);
    try {
      const updated = await window.neuraco.controlBackgroundProcess(
        process.id,
        action
      );
      setProcesses((current) => current.map((item) => (
        item.id === updated.id ? updated : item
      )));
      onStatus(`${updated.name} : ${STATE_LABELS[updated.state]}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Action impossible.');
    } finally {
      setBusyId(undefined);
    }
  };

  const toggleLog = async (processId: string) => {
    if (!window.neuraco) return;
    if (openedLog === processId) {
      setOpenedLog(undefined);
      return;
    }
    setBusyId(processId);
    try {
      const log = await window.neuraco.getBackgroundProcessLog(processId);
      setLogs((current) => ({
        ...current,
        [processId]: `${log.truncated ? '[Début du journal tronqué]\n' : ''}${log.content}`
      }));
      setOpenedLog(processId);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Journal indisponible.');
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className="background-processes" aria-label="Processus en arrière-plan">
      <header>
        <div>
          <span className="panel-heading-icon"><Server size={18} /></span>
          <div>
            <h2>Processus en arrière-plan</h2>
            <p>
              {activeCount} actif(s) · journaux persistants · projet {snapshot.project.name}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Actualiser les processus"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </header>

      <form className="background-process-form" onSubmit={start}>
        <label>
          <span>Nom</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label>
          <span>Agent propriétaire</span>
          <input
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label className="process-command-field">
          <span>Commande</span>
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="npm run dev"
            required
          />
        </label>
        <label>
          <span>Dossier dans le projet</span>
          <input
            value={workingDirectory}
            onChange={(event) => setWorkingDirectory(event.target.value)}
            placeholder="."
          />
        </label>
        <label>
          <span>Port (facultatif)</span>
          <input
            type="number"
            min="1"
            max="65535"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            placeholder="3000"
          />
        </label>
        <label className="process-keep-check">
          <input
            type="checkbox"
            checked={keepAlive}
            onChange={(event) => setKeepAlive(event.target.checked)}
          />
          Conserver après fermeture de NeuraCo
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={!command.trim() || starting || emergencyStopped}
        >
          <Play size={15} />
          {starting ? 'Démarrage…' : 'Lancer'}
        </button>
      </form>

      <div className="background-process-list">
        {loading && processes.length === 0 && (
          <div className="empty-panel">Chargement des processus…</div>
        )}
        {!loading && processes.length === 0 && (
          <div className="empty-panel">
            Aucun processus enregistré pour ce projet.
          </div>
        )}
        {processes.map((process) => {
          const active = ACTIVE_STATES.has(process.state);
          const busy = busyId === process.id;
          return (
            <article className="background-process-item" key={process.id}>
              <header>
                <div>
                  <span className={`process-state is-${process.state}`} />
                  <div>
                    <h3>{process.name}</h3>
                    <p>{process.agent} · PID {process.pid || '—'}</p>
                  </div>
                </div>
                <span className={`status-badge is-${process.state}`}>
                  {STATE_LABELS[process.state]}
                </span>
              </header>

              <dl>
                <div><dt>Durée</dt><dd>{formatDuration(process.durationMs)}</dd></div>
                <div><dt>CPU</dt><dd>{process.cpuPercent.toFixed(1)} %</dd></div>
                <div><dt>Mémoire</dt><dd>{formatBytes(process.memoryBytes)}</dd></div>
                <div><dt>Port</dt><dd>{process.port || '—'}</dd></div>
                <div><dt>Dossier</dt><dd title={process.workingDirectory}>{process.workingDirectory}</dd></div>
                <div><dt>Suivi</dt><dd>{process.attached ? 'Attaché' : 'Détaché'}</dd></div>
              </dl>

              <pre className="process-command">{process.command}</pre>
              {process.lastOutput && (
                <pre className="process-output">{process.lastOutput}</pre>
              )}

              <div className="process-actions">
                <button
                  type="button"
                  title="Ouvrir ou fermer le journal complet"
                  onClick={() => void toggleLog(process.id)}
                  disabled={busy}
                >
                  <ScrollText size={14} /> Journal
                </button>
                {active && (
                  <button
                    type="button"
                    title={process.attached ? 'Détacher le suivi' : 'Rattacher le suivi'}
                    onClick={() => void control(
                      process,
                      process.attached ? 'detach' : 'attach'
                    )}
                    disabled={busy}
                  >
                    {process.attached ? <Link2Off size={14} /> : <Link size={14} />}
                    {process.attached ? 'Détacher' : 'Rattacher'}
                  </button>
                )}
                {active && !process.keepAlive && (
                  <button
                    type="button"
                    title="Conserver ce processus après fermeture"
                    onClick={() => void control(process, 'keep')}
                    disabled={busy}
                  >
                    <ShieldCheck size={14} /> Conserver
                  </button>
                )}
                <button
                  type="button"
                  title="Redémarrer le processus"
                  onClick={() => void control(process, 'restart')}
                  disabled={busy || emergencyStopped || !process.restartable}
                >
                  <RotateCcw size={14} /> Redémarrer
                </button>
                {active && (
                  <>
                    <button
                      type="button"
                      title="Demander un arrêt normal"
                      onClick={() => void control(process, 'stop')}
                      disabled={busy}
                    >
                      <Square size={14} /> Arrêter
                    </button>
                    <button
                      type="button"
                      className="danger"
                      title="Forcer immédiatement l’arrêt"
                      onClick={() => void control(process, 'force_stop')}
                      disabled={busy}
                    >
                      <CircleStop size={14} /> Forcer
                    </button>
                  </>
                )}
              </div>

              {openedLog === process.id && (
                <pre className="process-full-log">
                  {logs[process.id] || 'Journal vide.'}
                </pre>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
