import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleStop,
  Clipboard,
  Eraser,
  Play,
  Plus,
  Search,
  SquareTerminal,
  X
} from 'lucide-react';
import type {
  NeuraCoTerminalEvent,
  NeuraCoTerminalCommandAssessment,
  NeuraCoTerminalProfile,
  NeuraCoTerminalProfileId
} from '../electron/ipc-contract';
import {
  stripTerminalAnsi,
  tokenizeTerminalOutput
} from './terminal-output';

interface TerminalPanelProps {
  projectRoot: string;
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
  onOpenBrowser: (url: string) => Promise<void>;
}

interface TerminalTabState {
  id: string;
  title: string;
  profileId: NeuraCoTerminalProfileId;
  target: string;
  command: string;
  output: string;
  commandId?: string;
  history: string[];
  historyIndex?: number;
  failed: boolean;
}

const MAX_TERMINAL_TABS = 10;
const MAX_RENDERED_OUTPUT = 200_000;

const createTab = (
  profileId: NeuraCoTerminalProfileId,
  index: number
): TerminalTabState => ({
  id: crypto.randomUUID(),
  title: `Terminal ${index}`,
  profileId,
  target: '',
  command: '',
  output: '',
  history: [],
  failed: false
});

const appendOutput = (current: string, value: string): string => (
  `${current}${value}`.slice(-MAX_RENDERED_OUTPUT)
);

const highlightedOutput = (output: string, query: string) => {
  const needle = query.trim();
  if (!needle) return output;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = output.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, index) => (
    part.toLowerCase() === needle.toLowerCase()
      ? <mark key={`${index}-${part}`}>{part}</mark>
      : part
  ));
};

export default function TerminalPanel({
  projectRoot,
  emergencyStopped,
  onStatus,
  onOpenBrowser
}: TerminalPanelProps) {
  const [profiles, setProfiles] = useState<NeuraCoTerminalProfile[]>([]);
  const [tabs, setTabs] = useState<TerminalTabState[]>([createTab('cmd', 1)]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [search, setSearch] = useState('');
  const [profilesError, setProfilesError] = useState('');
  const [assessment, setAssessment] = useState<NeuraCoTerminalCommandAssessment>();
  const outputRef = useRef<HTMLPreElement>(null);

  const active = useMemo(
    () => tabs.find((tab) => tab.id === activeId) || tabs[0],
    [activeId, tabs]
  );
  const activeProfile = profiles.find((profile) => profile.id === active?.profileId);
  const searchMatches = search.trim() && active
    ? stripTerminalAnsi(active.output).toLowerCase().split(search.trim().toLowerCase()).length - 1
    : 0;
  const outputTokens = useMemo(
    () => tokenizeTerminalOutput(active?.output || ''),
    [active?.output]
  );

  useEffect(() => {
    let mounted = true;
    void window.neuraco?.listTerminalProfiles()
      .then((loaded) => {
        if (!mounted) return;
        setProfiles(loaded);
        const preferred = loaded.find((profile) => (
          profile.available && profile.id === 'powershell'
        )) || loaded.find((profile) => profile.available);
        if (preferred) {
          setTabs((current) => current.map((tab, index) => (
            index === 0 && !loaded.find(
              (profile) => profile.id === tab.profileId && profile.available
            )
              ? { ...tab, profileId: preferred.id, title: preferred.label }
              : tab
          )));
        }
      })
      .catch((error) => {
        if (mounted) {
          setProfilesError(
            error instanceof Error ? error.message : 'Profils de terminal indisponibles.'
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.neuraco?.onTerminalEvent((event: NeuraCoTerminalEvent) => {
      setTabs((current) => current.map((tab) => {
        const matches = event.terminalId
          ? event.terminalId === tab.id
          : event.commandId === tab.commandId;
        if (!matches) return tab;
        if (event.type === 'started') {
          return {
            ...tab,
            commandId: event.commandId,
            output: appendOutput(tab.output, `\n> ${event.command || ''}\n`),
            failed: false
          };
        }
        if (event.type === 'stdout' || event.type === 'stderr') {
          return {
            ...tab,
            output: appendOutput(tab.output, event.chunk || ''),
            failed: tab.failed || event.type === 'stderr'
          };
        }
        const suffix = event.type === 'completed'
          ? `\n[terminé, code ${event.exitCode ?? 'inconnu'}, ${event.durationMs ?? 0} ms]\n`
          : `\n[${event.message || 'commande arrêtée'}]\n`;
        return {
          ...tab,
          commandId: undefined,
          output: appendOutput(tab.output, suffix),
          failed: tab.failed || event.type === 'error' || (
            event.type === 'completed' && event.exitCode !== 0
          )
        };
      }));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof outputRef.current?.scrollTo === 'function') {
      outputRef.current.scrollTo({ top: outputRef.current.scrollHeight });
    }
  }, [active?.output]);

  useEffect(() => {
    const command = active?.command.trim();
    if (!command) {
      setAssessment(undefined);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      void window.neuraco?.assessTerminalCommand(command)
        .then((next) => {
          if (current) setAssessment(next);
        })
        .catch(() => {
          if (current) setAssessment(undefined);
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [active?.command]);

  const updateActive = (updater: (tab: TerminalTabState) => TerminalTabState) => {
    setTabs((current) => current.map((tab) => tab.id === activeId ? updater(tab) : tab));
  };

  const addTab = () => {
    if (tabs.length >= MAX_TERMINAL_TABS) {
      onStatus(`Le terminal est limité à ${MAX_TERMINAL_TABS} onglets.`);
      return;
    }
    const profileId = profiles.find((profile) => profile.available)?.id || 'cmd';
    const tab = createTab(profileId, tabs.length + 1);
    const label = profiles.find((profile) => profile.id === profileId)?.label;
    if (label) tab.title = label;
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  };

  const closeTab = (tabId: string) => {
    const closing = tabs.find((tab) => tab.id === tabId);
    if (closing?.commandId) {
      onStatus('Arrêtez la commande avant de fermer cet onglet.');
      return;
    }
    if (tabs.length === 1) {
      const replacement = createTab(
        profiles.find((profile) => profile.available)?.id || 'cmd',
        1
      );
      setTabs([replacement]);
      setActiveId(replacement.id);
      return;
    }
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);
    if (activeId === tabId) {
      setActiveId(nextTabs[Math.min(closingIndex, nextTabs.length - 1)].id);
    }
  };

  const run = async () => {
    if (!window.neuraco || !active || !active.command.trim() || active.commandId) return;
    if (activeProfile?.requiresTarget && !active.target.trim()) {
      onStatus(`Renseignez la cible ${activeProfile.label}.`);
      return;
    }
    const command = active.command.trim();
    updateActive((tab) => ({
      ...tab,
      history: tab.history.at(-1) === command
        ? tab.history
        : [...tab.history, command].slice(-200),
      historyIndex: undefined,
      failed: false
    }));
    try {
      const result = await window.neuraco.startTerminalCommand({
        command,
        terminalId: active.id,
        profileId: active.profileId,
        target: active.target.trim() || undefined
      });
      if (result.accepted && result.commandId) {
        updateActive((tab) => ({
          ...tab,
          command: '',
          commandId: result.commandId
        }));
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Commande refusée.');
    }
  };

  const navigateHistory = (direction: -1 | 1) => {
    if (!active || active.history.length === 0) return;
    const currentIndex = active.historyIndex ?? active.history.length;
    const nextIndex = Math.max(0, Math.min(
      active.history.length,
      currentIndex + direction
    ));
    updateActive((tab) => ({
      ...tab,
      historyIndex: nextIndex === tab.history.length ? undefined : nextIndex,
      command: nextIndex === tab.history.length ? '' : tab.history[nextIndex]
    }));
  };

  const copyOutput = async () => {
    if (!active?.output) return;
    try {
      await navigator.clipboard.writeText(active.output);
      onStatus('Sortie du terminal copiée.');
    } catch {
      onStatus('Le presse-papiers n’est pas disponible.');
    }
  };

  if (!active) return null;

  return (
    <div className="terminal-view">
      <nav className="terminal-tabs" aria-label="Onglets du terminal">
        {tabs.map((tab) => (
          <div key={tab.id} className={tab.id === active.id ? 'is-active' : ''}>
            <button type="button" onClick={() => setActiveId(tab.id)}>
              <SquareTerminal size={13} />
              <span>{tab.title}</span>
              {tab.commandId && <i title="Commande en cours" />}
              {tab.failed && <em title="Dernière commande en erreur" />}
            </button>
            <button
              type="button"
              onClick={() => closeTab(tab.id)}
              title={`Fermer ${tab.title}`}
              aria-label={`Fermer ${tab.title}`}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button type="button" onClick={addTab} title="Nouveau terminal">
          <Plus size={14} />
        </button>
      </nav>

      <header className="terminal-toolbar">
        <div>
          <select
            value={active.profileId}
            disabled={Boolean(active.commandId)}
            onChange={(event) => {
              const profileId = event.target.value as NeuraCoTerminalProfileId;
              const profile = profiles.find((candidate) => candidate.id === profileId);
              updateActive((tab) => ({
                ...tab,
                profileId,
                target: '',
                title: profile?.label || tab.title
              }));
            }}
            aria-label="Profil du terminal"
          >
            {profiles.length === 0 && <option value={active.profileId}>Détection…</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id} disabled={!profile.available}>
                {profile.label}{profile.available ? '' : ' — indisponible'}
              </option>
            ))}
          </select>
          {activeProfile?.requiresTarget && (
            <input
              value={active.target}
              disabled={Boolean(active.commandId)}
              onChange={(event) => updateActive((tab) => ({
                ...tab,
                target: event.target.value
              }))}
              placeholder={activeProfile.targetPlaceholder}
              aria-label={`Cible ${activeProfile.label}`}
            />
          )}
          <small title={activeProfile?.detail}>
            {activeProfile?.detail || profilesError || projectRoot}
          </small>
        </div>
        <label>
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher dans la sortie"
          />
          {search.trim() && <span>{searchMatches}</span>}
        </label>
        <button type="button" onClick={() => void copyOutput()} disabled={!active.output}>
          <Clipboard size={13} /> Copier
        </button>
        <button
          type="button"
          onClick={() => updateActive((tab) => ({ ...tab, output: '', failed: false }))}
          disabled={!active.output || Boolean(active.commandId)}
        >
          <Eraser size={13} /> Effacer
        </button>
      </header>

      <pre ref={outputRef} className={active.failed ? 'has-error' : ''}>
        {active.output
          ? search.trim()
            ? highlightedOutput(stripTerminalAnsi(active.output), search)
            : outputTokens.map((token, index) => (
                token.url
                  ? (
                      <button
                        type="button"
                        className="terminal-output-link"
                        key={`${index}-${token.text}`}
                        onClick={() => void onOpenBrowser(token.url!)}
                        title="Ouvrir dans le navigateur NeuraCo isolé"
                      >
                        {token.text}
                      </button>
                    )
                  : (
                      <span
                        key={`${index}-${token.text}`}
                        className={[
                          token.color ? `ansi-${token.color}` : '',
                          token.bold ? 'is-bold' : ''
                        ].filter(Boolean).join(' ')}
                      >
                        {token.text}
                      </span>
                    )
              ))
          : `Répertoire: ${projectRoot}\n`}
      </pre>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <span>&gt;</span>
        <small
          className={`terminal-risk ${assessment ? `is-${assessment.level}` : ''}`}
          title={assessment?.reason}
        >
          {assessment?.label || 'Analyse…'}
        </small>
        <input
          value={active.command}
          onChange={(event) => updateActive((tab) => ({
            ...tab,
            command: event.target.value,
            historyIndex: undefined
          }))}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              navigateHistory(-1);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              navigateHistory(1);
            }
          }}
          placeholder="npm test, git status, python -m pytest…"
          disabled={Boolean(active.commandId) || emergencyStopped}
          aria-label="Commande terminal"
        />
        {active.commandId ? (
          <button
            type="button"
            className="terminal-stop"
            onClick={() => void window.neuraco?.cancelTerminalCommand(active.commandId!)}
          >
            <CircleStop size={16} /> Arrêter
          </button>
        ) : (
          <button type="submit" disabled={!active.command.trim() || emergencyStopped}>
            <Play size={16} /> Exécuter
          </button>
        )}
      </form>
    </div>
  );
}
