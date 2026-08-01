import { useEffect, useMemo, useState } from 'react';
import {
  Cable,
  Container,
  FileSearch,
  KeyRound,
  Network,
  Play,
  RefreshCw,
  Server,
  Square,
  TerminalSquare,
  Unplug
} from 'lucide-react';
import type {
  NeuraCoRemoteAction,
  NeuraCoRemoteActionResult,
  NeuraCoRemoteDiscovery
} from '../electron/ipc-contract';

type RemoteKind = 'ssh' | 'wsl2' | 'docker';

export default function RemoteConnectionsSection({
  onStatus
}: {
  onStatus: (message: string) => void;
}) {
  const [discovery, setDiscovery] = useState<NeuraCoRemoteDiscovery>();
  const [kind, setKind] = useState<RemoteKind>('ssh');
  const [target, setTarget] = useState('');
  const [identityFile, setIdentityFile] = useState('');
  const [remotePath, setRemotePath] = useState('/workspace');
  const [command, setCommand] = useState('pwd && ls');
  const [localPort, setLocalPort] = useState(3000);
  const [remotePort, setRemotePort] = useState(3000);
  const [result, setResult] = useState<NeuraCoRemoteActionResult>();
  const [busy, setBusy] = useState(false);

  const targets = useMemo(() => {
    if (!discovery) return [];
    if (kind === 'ssh') {
      return discovery.sshHosts.map((host) => ({
        id: host.alias,
        label: host.hostname
          ? `${host.alias} · ${host.user ? `${host.user}@` : ''}${host.hostname}`
          : host.alias
      }));
    }
    if (kind === 'wsl2') {
      return discovery.wslDistributions.map((name) => ({ id: name, label: name }));
    }
    return discovery.dockerContainers.map((container) => ({
      id: container.name,
      label: `${container.name} · ${container.image} · ${container.state}`
    }));
  }, [discovery, kind]);

  const refresh = async () => {
    if (!window.neuraco?.discoverRemoteConnections || busy) return;
    setBusy(true);
    try {
      const next = await window.neuraco.discoverRemoteConnections();
      setDiscovery(next);
      const candidates = kind === 'ssh'
        ? next.sshHosts.map((item) => item.alias)
        : kind === 'wsl2'
          ? next.wslDistributions
          : next.dockerContainers.map((item) => item.name);
      setTarget((current) => current || candidates[0] || '');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Détection distante impossible.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setTarget(targets[0]?.id || '');
    setResult(undefined);
  }, [kind]);

  const chooseKey = async () => {
    const selected = await window.neuraco?.chooseRemoteSshKey?.();
    if (selected) setIdentityFile(selected);
  };

  const run = async (action: NeuraCoRemoteAction) => {
    if (!window.neuraco?.runRemoteConnectionAction || !target || busy) return;
    setBusy(true);
    try {
      const next = await window.neuraco.runRemoteConnectionAction({
        kind,
        action,
        target,
        identityFile: kind === 'ssh' ? identityFile || undefined : undefined,
        path: remotePath,
        command,
        localPort,
        remoteHost: '127.0.0.1',
        remotePort
      });
      setResult(next);
      onStatus(next.ok ? 'Action distante terminée.' : 'Action distante en échec.');
      setDiscovery(await window.neuraco.discoverRemoteConnections());
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Action distante impossible.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (id: string) => {
    if (!window.neuraco?.disconnectRemoteConnection) return;
    await window.neuraco.disconnectRemoteConnection(id);
    await refresh();
  };

  return (
    <section className="remote-connections">
      <header>
        <div>
          <Network size={18} />
          <span>
            <strong>Connexions distantes</strong>
            <small>SSH, WSL2 et Docker restent exécutés localement.</small>
          </span>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={busy} title="Actualiser">
          <RefreshCw size={15} className={busy ? 'is-spinning' : ''} />
        </button>
      </header>

      <div className="remote-kind-tabs">
        <button type="button" className={kind === 'ssh' ? 'is-active' : ''} onClick={() => setKind('ssh')}>
          <Server size={15} /> SSH
        </button>
        <button type="button" className={kind === 'wsl2' ? 'is-active' : ''} onClick={() => setKind('wsl2')}>
          <TerminalSquare size={15} /> WSL2
        </button>
        <button type="button" className={kind === 'docker' ? 'is-active' : ''} onClick={() => setKind('docker')}>
          <Container size={15} /> Docker
        </button>
      </div>

      <div className="remote-fields">
        <label>
          <span>Cible</span>
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Sélectionner</option>
            {targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {kind === 'ssh' && (
          <label>
            <span>Clé SSH locale</span>
            <button type="button" onClick={() => void chooseKey()}>
              <KeyRound size={14} />
              {identityFile ? 'Changer la clé' : 'Choisir une clé'}
            </button>
            {identityFile && <small title={identityFile}>{identityFile}</small>}
          </label>
        )}
        <label>
          <span>Chemin distant / projet</span>
          <input value={remotePath} onChange={(event) => setRemotePath(event.target.value)} />
        </label>
        <label className="remote-command-field">
          <span>Commande</span>
          <input value={command} onChange={(event) => setCommand(event.target.value)} />
        </label>
      </div>

      <div className="remote-actions">
        <button type="button" onClick={() => void run('connect')} disabled={!target || busy}>
          <Cable size={14} /> Vérifier
        </button>
        <button type="button" onClick={() => void run('list_files')} disabled={!target || busy}>
          <FileSearch size={14} /> Fichiers
        </button>
        <button type="button" onClick={() => void run('read_file')} disabled={!target || busy}>
          Lire
        </button>
        <button type="button" onClick={() => void run('run_command')} disabled={!target || busy}>
          <Play size={14} /> Exécuter
        </button>
        {kind === 'docker' && (
          <>
            <button type="button" onClick={() => void run('logs')} disabled={!target || busy}>Journaux</button>
            <button type="button" onClick={() => void run('inspect')} disabled={!target || busy}>Inspecter</button>
            <button type="button" onClick={() => void run('start')} disabled={!target || busy}>Démarrer</button>
            <button type="button" onClick={() => void run('stop')} disabled={!target || busy}>
              <Square size={13} /> Arrêter
            </button>
            <button type="button" onClick={() => void run('rebuild')} disabled={!target || busy}>Reconstruire</button>
          </>
        )}
      </div>

      {kind === 'ssh' && (
        <div className="remote-tunnel">
          <label>Port local<input type="number" min="1" max="65535" value={localPort} onChange={(event) => setLocalPort(Number(event.target.value))} /></label>
          <label>Port distant<input type="number" min="1" max="65535" value={remotePort} onChange={(event) => setRemotePort(Number(event.target.value))} /></label>
          <button type="button" onClick={() => void run('tunnel')} disabled={!target || busy}>
            <Network size={14} /> Ouvrir le tunnel
          </button>
        </div>
      )}

      {discovery?.activeTunnels.map((tunnel) => (
        <div className="remote-active-tunnel" key={tunnel.id}>
          <span>{tunnel.host} · localhost:{tunnel.localPort} → {tunnel.remoteHost}:{tunnel.remotePort}</span>
          <button type="button" onClick={() => void disconnect(tunnel.id)} title="Déconnecter">
            <Unplug size={14} />
          </button>
        </div>
      ))}

      {result && (
        <pre className={result.ok ? 'is-success' : 'is-error'}>
          {result.stdout || result.stderr || `Code de sortie : ${result.exitCode}`}
        </pre>
      )}
    </section>
  );
}
