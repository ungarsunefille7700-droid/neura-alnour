import { useEffect, useState } from 'react';
import {
  Blocks,
  CheckCircle2,
  CircleOff,
  Download,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wrench
} from 'lucide-react';
import type {
  NeuraCoExtensionsState,
  NeuraCoMcpServerInput,
  NeuraCoMcpTransport
} from '../electron/ipc-contract';

interface ExtensionsPanelProps {
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
}

const originLabel = {
  official: 'Officiel',
  private: 'Privé',
  enterprise: 'Entreprise',
  local: 'Local'
} as const;

const trustLabel = {
  verified: 'Signature vérifiée',
  'integrity-only': 'Intégrité vérifiée',
  unsigned: 'Non signé'
} as const;

const splitList = (value: string): string[] => value
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const parseHeaders = (
  value: string
): Array<{ name: string; environmentVariable: string }> => splitList(value)
  .map((entry) => {
    const separator = entry.indexOf('=');
    if (separator < 1) {
      throw new Error(
        'Les en-têtes doivent utiliser le format Nom=VARIABLE_ENV.'
      );
    }
    return {
      name: entry.slice(0, separator).trim(),
      environmentVariable: entry.slice(separator + 1).trim()
    };
  });

export default function ExtensionsPanel({
  emergencyStopped,
  onStatus
}: ExtensionsPanelProps) {
  const [state, setState] = useState<NeuraCoExtensionsState>();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<NeuraCoMcpTransport>('stdio');
  const [commandOrUrl, setCommandOrUrl] = useState('');
  const [args, setArgs] = useState('');
  const [environmentVariables, setEnvironmentVariables] = useState('');
  const [headers, setHeaders] = useState('');

  const load = async () => {
    if (!window.neuraco) return;
    setBusy(true);
    try {
      setState(await window.neuraco.getExtensionsState());
    } catch (error) {
      onStatus(
        error instanceof Error
          ? error.message
          : 'Impossible de charger les extensions.'
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const mutate = async (
    operation: () => Promise<NeuraCoExtensionsState | null>,
    message: string
  ) => {
    setBusy(true);
    try {
      const result = await operation();
      if (result) {
        setState(result);
        onStatus(message);
      }
    } catch (error) {
      onStatus(
        error instanceof Error
          ? error.message
          : 'L’opération sur l’extension a échoué.'
      );
    } finally {
      setBusy(false);
    }
  };

  const addServer = () => {
    if (!name.trim() || !commandOrUrl.trim()) {
      onStatus('Le nom et la commande ou URL MCP sont obligatoires.');
      return;
    }
    let input: NeuraCoMcpServerInput;
    try {
      input = {
        name: name.trim(),
        transport,
        command: transport === 'stdio' ? commandOrUrl.trim() : undefined,
        args: transport === 'stdio' ? splitList(args) : [],
        url: transport === 'http' ? commandOrUrl.trim() : undefined,
        environmentVariables: splitList(environmentVariables),
        headers: transport === 'http' ? parseHeaders(headers) : []
      };
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Configuration MCP invalide.');
      return;
    }
    void mutate(
      () => window.neuraco!.addMcpServer(input),
      'Serveur MCP enregistré, désactivé jusqu’au test de connexion.'
    ).then(() => {
      setName('');
      setCommandOrUrl('');
      setArgs('');
      setEnvironmentVariables('');
      setHeaders('');
    });
  };

  if (!state) {
    return (
      <div className="extensions-view">
        <div className="extensions-loading">Chargement des extensions…</div>
      </div>
    );
  }

  const disabled = busy || emergencyStopped;

  return (
    <div className="extensions-view">
      <header className="extensions-toolbar">
        <div>
          <Blocks size={18} />
          <div>
            <strong>Compétences, plugins et MCP</strong>
            <span>
              {state.enabledSkillCount} compétence(s) ·{' '}
              {state.enabledPluginCount} plugin(s) ·{' '}
              {state.enabledMcpToolCount} outil(s) MCP actif(s)
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          title="Installer un paquet avec neuraco-extension.json"
          onClick={() => void mutate(
            () => window.neuraco!.installLocalExtension(),
            'Extension locale installée.'
          )}
        >
          <Download size={14} />
          Installer localement
        </button>
        <button
          type="button"
          disabled={busy}
          title="Actualiser"
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
        </button>
      </header>

      <div className="extensions-safety-note">
        <ShieldCheck size={15} />
        <span>
          Les nouvelles extensions sont désactivées par défaut. Les paquets
          officiels et d’entreprise exigent une signature Ed25519 valide ;
          chaque paquet est aussi contrôlé par empreinte SHA-256.
        </span>
      </div>

      <section className="extensions-section">
        <header>
          <h2>Compétences et plugins</h2>
          <span>Instructions, scripts, références, exemples, tests et permissions.</span>
        </header>
        {state.extensions.length === 0 ? (
          <div className="extensions-empty">
            Aucun paquet installé. Sélectionnez un dossier contenant{' '}
            <code>neuraco-extension.json</code>.
          </div>
        ) : (
          <div className="extensions-list">
            {state.extensions.map((extension) => (
              <article
                key={extension.id}
                className={`extension-entry ${extension.enabled ? 'is-enabled' : ''}`}
              >
                <header>
                  <div>
                    {extension.kind === 'skill'
                      ? <Wrench size={16} />
                      : <Plug size={16} />}
                    <div>
                      <strong>{extension.name}</strong>
                      <span>
                        {extension.version} · {originLabel[extension.origin]} ·{' '}
                        {extension.provider}
                      </span>
                    </div>
                  </div>
                  <span className={`extension-trust is-${extension.trust}`}>
                    {extension.signatureVerified
                      ? <CheckCircle2 size={13} />
                      : <CircleOff size={13} />}
                    {trustLabel[extension.trust]}
                  </span>
                </header>
                {extension.description && <p>{extension.description}</p>}
                <dl className="extension-permissions">
                  <div>
                    <dt>Fichiers</dt>
                    <dd>{extension.permissions.files.join(', ') || 'Aucun'}</dd>
                  </div>
                  <div>
                    <dt>Réseau</dt>
                    <dd>{extension.permissions.network.join(', ') || 'Aucun'}</dd>
                  </div>
                  <div>
                    <dt>Commandes</dt>
                    <dd>{extension.permissions.commands.join(', ') || 'Aucune'}</dd>
                  </div>
                  <div>
                    <dt>Données</dt>
                    <dd>{extension.permissions.data.join(', ') || 'Aucune'}</dd>
                  </div>
                </dl>
                <div className="extension-package-details">
                  <span>{extension.scripts.length} script(s)</span>
                  <span>{extension.references.length} référence(s)</span>
                  <span>{extension.examples.length} exemple(s)</span>
                  <span>{extension.tests.length} test(s)</span>
                </div>
                {extension.tools.length > 0 && (
                  <div className="extension-tools">
                    {extension.tools.map((tool) => (
                      <label key={tool.id}>
                        <input
                          type="checkbox"
                          checked={tool.enabled}
                          disabled={disabled || !extension.enabled}
                          onChange={(event) => void mutate(
                            () => window.neuraco!.setExtensionToolEnabled(
                              extension.id,
                              tool.id,
                              event.target.checked
                            ),
                            `Outil ${tool.name} mis à jour.`
                          )}
                        />
                        <span>
                          <strong>{tool.name}</strong>
                          <small>{tool.description || 'Aucune description.'}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {extension.warnings.map((warning) => (
                  <small key={warning} className="extension-warning">{warning}</small>
                ))}
                <footer>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void mutate(
                      () => window.neuraco!.setExtensionEnabled(
                        extension.id,
                        !extension.enabled
                      ),
                      extension.enabled ? 'Extension désactivée.' : 'Extension activée.'
                    )}
                  >
                    {extension.enabled ? 'Désactiver' : 'Activer'}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void mutate(
                      () => window.neuraco!.updateExtension(extension.id),
                      'Extension mise à jour depuis son dossier source.'
                    )}
                  >
                    <RefreshCw size={13} />
                    Mettre à jour
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    disabled={disabled}
                    onClick={() => void mutate(
                      () => window.neuraco!.removeExtension(extension.id),
                      'Extension supprimée.'
                    )}
                  >
                    <Trash2 size={13} />
                    Supprimer
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="extensions-section">
        <header>
          <h2>Serveurs MCP</h2>
          <span>Serveurs locaux stdio et serveurs HTTP distants.</span>
        </header>
        <div className="mcp-add-form">
          <input
            aria-label="Nom du serveur MCP"
            value={name}
            placeholder="Nom du serveur"
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
          <select
            aria-label="Transport MCP"
            value={transport}
            disabled={disabled}
            onChange={(event) => setTransport(
              event.target.value as NeuraCoMcpTransport
            )}
          >
            <option value="stdio">Local (stdio)</option>
            <option value="http">Distant (HTTP)</option>
          </select>
          <input
            aria-label={transport === 'stdio' ? 'Commande MCP' : 'URL MCP'}
            value={commandOrUrl}
            placeholder={transport === 'stdio' ? 'Commande exécutable' : 'https://…'}
            disabled={disabled}
            onChange={(event) => setCommandOrUrl(event.target.value)}
          />
          {transport === 'stdio' && (
            <input
              aria-label="Arguments MCP"
              value={args}
              placeholder="Arguments séparés par des virgules"
              disabled={disabled}
              onChange={(event) => setArgs(event.target.value)}
            />
          )}
          <input
            aria-label="Variables d’environnement MCP"
            value={environmentVariables}
            placeholder="Variables autorisées : GITHUB_TOKEN, FIGMA_TOKEN"
            disabled={disabled}
            onChange={(event) => setEnvironmentVariables(event.target.value)}
          />
          {transport === 'http' && (
            <input
              aria-label="En-têtes MCP"
              value={headers}
              placeholder="Authorization=MCP_TOKEN"
              disabled={disabled}
              onChange={(event) => setHeaders(event.target.value)}
            />
          )}
          <button type="button" disabled={disabled} onClick={addServer}>
            <Plug size={14} />
            Enregistrer
          </button>
        </div>

        {state.mcpServers.length === 0 ? (
          <div className="extensions-empty">Aucun serveur MCP configuré.</div>
        ) : (
          <div className="extensions-list">
            {state.mcpServers.map((server) => (
              <article key={server.id} className="extension-entry mcp-entry">
                <header>
                  <div>
                    <Plug size={16} />
                    <div>
                      <strong>{server.name}</strong>
                      <span>
                        {server.transport === 'stdio'
                          ? `${server.command} ${(server.args || []).join(' ')}`.trim()
                          : server.url}
                      </span>
                    </div>
                  </div>
                  <span className={`mcp-status is-${server.status}`}>
                    {server.status}
                  </span>
                </header>
                {server.lastError && (
                  <small className="extension-warning">{server.lastError}</small>
                )}
                {server.tools.length > 0 && (
                  <div className="extension-tools">
                    {server.tools.map((tool) => (
                      <label key={tool.name}>
                        <input
                          type="checkbox"
                          checked={tool.enabled}
                          disabled={disabled || !server.enabled}
                          onChange={(event) => void mutate(
                            () => window.neuraco!.setMcpToolEnabled(
                              server.id,
                              tool.name,
                              event.target.checked
                            ),
                            `Outil MCP ${tool.name} mis à jour.`
                          )}
                        />
                        <span>
                          <strong>{tool.name}</strong>
                          <small>{tool.description || 'Aucune description.'}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <footer>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void mutate(
                      () => window.neuraco!.testMcpServer(server.id),
                      'Connexion MCP testée et outils actualisés.'
                    )}
                  >
                    Tester
                  </button>
                  <button
                    type="button"
                    disabled={disabled || server.tools.length === 0}
                    onClick={() => void mutate(
                      () => window.neuraco!.setMcpServerEnabled(
                        server.id,
                        !server.enabled
                      ),
                      server.enabled ? 'Serveur MCP désactivé.' : 'Serveur MCP activé.'
                    )}
                  >
                    {server.enabled ? 'Désactiver' : 'Activer'}
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    disabled={disabled}
                    onClick={() => void mutate(
                      () => window.neuraco!.removeMcpServer(server.id),
                      'Serveur MCP supprimé.'
                    )}
                  >
                    <Trash2 size={13} />
                    Supprimer
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
