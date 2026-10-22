import { useCallback, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Loader2, Package, Search, ShieldAlert, X } from 'lucide-react';
import { readZipDirectory, readZipText, refusalReason } from '@/utils/zipReader';
import {
  CONTEXT_TOKENS, buildProjectContext, extensionOf, fileKind, folderSummary, isReadable, rankFiles, selectScope,
} from '@/utils/projectIndex';

// Version of a file (FNV-1a, 32 bits + length): enough to see that a file changed.
export const versionOf = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16).padStart(8, '0')}${text.length.toString(16)}`;
};
export const fingerprintOf = (entries) => versionOf(entries.map((e) => `${e.path}:${e.size}`).sort().join('|'));

const MB = (bytes) => `${(bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1)} Mo`;

// The project workshop of a conversation: an archive opened in the browser (never uploaded),
// the scope chosen by the user, the files read, and the context built for each question.
export function useProjectWorkshop() {
  const [state, setState] = useState(null);
  const blobRef = useRef(null);
  const textsRef = useRef(new Map());
  const statusRef = useRef(new Map());
  const readingRef = useRef(null);

  const open = useCallback(async (file) => {
    blobRef.current = file;
    textsRef.current = new Map();
    statusRef.current = new Map();
    setState({ name: file.name, size: file.size, loading: true, entries: [], scope: { mode: 'all' }, read: 0, error: null });
    try {
      const entries = await readZipDirectory(file);
      setState((s) => ({ ...s, loading: false, entries }));
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: error.message }));
    }
  }, []);

  const close = useCallback(() => { blobRef.current = null; setState(null); }, []);
  const setScope = useCallback((scope) => setState((s) => (s ? { ...s, scope } : s)), []);

  const selected = useMemo(() => (state?.entries?.length ? selectScope(state.entries, state.scope) : []), [state?.entries, state?.scope]);

  // Reads, one by one, the text files of the scope not read yet (progress shown).
  const readScope = useCallback(async () => {
    if (!blobRef.current || !selected.length) return;
    if (readingRef.current) return readingRef.current;
    const run = (async () => {
      const todo = selected.filter((entry) => isReadable(entry) && !statusRef.current.has(entry.path));
      let done = 0;
      for (const entry of todo) {
        const reason = refusalReason(entry);
        if (reason) statusRef.current.set(entry.path, { state: 'refusé', reason });
        else {
          try {
            const text = await readZipText(blobRef.current, entry);
            textsRef.current.set(entry.path, text);
            statusRef.current.set(entry.path, { state: 'lu', hash: versionOf(text) });
          } catch (error) {
            statusRef.current.set(entry.path, { state: 'refusé', reason: error.message });
          }
        }
        done += 1;
        if (done % 25 === 0 || done === todo.length) setState((s) => (s ? { ...s, read: textsRef.current.size, progress: { done, total: todo.length } } : s));
      }
      setState((s) => (s ? { ...s, read: textsRef.current.size, progress: null } : s));
    })();
    readingRef.current = run;
    try { await run; } finally { readingRef.current = null; }
  }, [selected]);

  // The context for one question, within the ceiling of the reasoning level.
  const contextFor = useCallback(async (question, level) => {
    if (!state || !state.entries.length) return null;
    await readScope();
    return buildProjectContext({
      archiveName: state.name, entries: state.entries, selected, texts: textsRef.current, question,
      budgetTokens: CONTEXT_TOKENS[level] || CONTEXT_TOKENS.auto,
    });
  }, [state, selected, readScope]);

  const search = useCallback(async (query) => {
    await readScope();
    return rankFiles(query, textsRef.current, selected.filter((entry) => textsRef.current.has(entry.path)).map((entry) => entry.path));
  }, [readScope, selected]);

  // Project memory: the archive and the files really studied (path, size, version), kept on
  // the server with the conversation so the work can resume later.
  const saveSnapshot = useCallback(async (conversationId, headers) => {
    if (!state || !conversationId) return null;
    const files = selected.slice(0, 3000).map((entry) => {
      const status = statusRef.current.get(entry.path);
      return { path: entry.path, size: entry.size, hash: status?.hash || null, state: status?.state || (isReadable(entry) ? 'inventorié' : fileKind(entry.path)) };
    });
    try {
      const { data } = await axios.put(`${process.env.REACT_APP_BACKEND_URL}/api/projects/memory`, {
        conversation_id: conversationId, archive_name: state.name, archive_size: state.size,
        fingerprint: fingerprintOf(state.entries), total_files: state.entries.length, files,
      }, { headers });
      if (data) setState((s) => (s ? { ...s, changed: data.changed_since_studied || [] } : s));
      return data;
    } catch {
      return null;
    }
  }, [state, selected]);

  return {
    active: Boolean(state), state, selected, open, close, setScope, readScope, contextFor, search, saveSnapshot,
    statusOf: (path) => statusRef.current.get(path),
  };
}

const SCOPES = [
  ['all', 'Tout le projet'], ['half-first', 'Première moitié'], ['half-second', 'Deuxième moitié'],
  ['folders', 'Dossiers choisis'], ['types', 'Types de fichiers'], ['range', 'Intervalle de fichiers'],
];

export function ProjectWorkshopPanel({ workshop }) {
  const [details, setDetails] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const { state, selected } = workshop;
  if (!state) return null;
  const scope = state.scope || { mode: 'all' };
  const scopeKey = scope.mode === 'half' ? `half-${scope.half || 'first'}` : scope.mode;
  const folders = folderSummary(state.entries);
  const types = [...new Set(state.entries.map((entry) => extensionOf(entry.path)).filter(Boolean))].sort();
  const readable = selected.filter(isReadable);
  const changeScope = (key) => {
    if (key.startsWith('half-')) workshop.setScope({ mode: 'half', half: key.slice(5) });
    else if (key === 'folders') workshop.setScope({ mode: 'folders', folders: [] });
    else if (key === 'types') workshop.setScope({ mode: 'types', types: [] });
    else if (key === 'range') workshop.setScope({ mode: 'range', from: 1, to: Math.min(100, state.entries.length) });
    else workshop.setScope({ mode: 'all' });
  };
  const toggle = (list, value) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <div className="mb-2 rounded-2xl border border-border bg-card/70 p-3 text-xs" data-testid="project-workshop">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium" data-testid="workshop-name">{state.name}</span>
        <span className="shrink-0 text-muted-foreground">{state.loading ? 'Lecture…' : `${state.entries.length} fichiers · ${MB(state.size)}`}</span>
        <button type="button" onClick={workshop.close} className="rounded-full p-1 text-muted-foreground hover:text-foreground" aria-label="Fermer l'atelier" data-testid="workshop-close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {state.error && <p className="mt-2 text-destructive" data-testid="workshop-error">{state.error}</p>}
      {!state.loading && !state.error && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={scopeKey} onChange={(event) => changeScope(event.target.value)}
              className="rounded-full border-0 bg-muted px-3 py-1 outline-none" data-testid="workshop-scope" aria-label="Périmètre">
              {SCOPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            {scope.mode === 'range' && (
              <span className="inline-flex items-center gap-1">
                fichiers
                <input type="number" min={1} value={scope.from} onChange={(e) => workshop.setScope({ ...scope, from: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} className="w-16 rounded bg-muted px-2 py-0.5" data-testid="workshop-from" />
                à
                <input type="number" min={1} value={scope.to} onChange={(e) => workshop.setScope({ ...scope, to: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} className="w-16 rounded bg-muted px-2 py-0.5" data-testid="workshop-to" />
              </span>
            )}
            <span className="text-muted-foreground" data-testid="workshop-coverage">
              {selected.length} dans le périmètre · {readable.length} lisibles · {state.read} lus
              {state.progress ? ` (lecture ${state.progress.done}/${state.progress.total})` : ''}
            </span>
          </div>
          {scope.mode === 'folders' && (
            <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {folders.map((row) => (
                <button key={row.folder} type="button" onClick={() => workshop.setScope({ ...scope, folders: toggle(scope.folders || [], row.folder) })}
                  className={`rounded-full px-2 py-0.5 ${scope.folders?.includes(row.folder) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {row.folder} ({row.files})
                </button>
              ))}
            </div>
          )}
          {scope.mode === 'types' && (
            <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {types.map((type) => (
                <button key={type} type="button" onClick={() => workshop.setScope({ ...scope, types: toggle(scope.types || [], type) })}
                  className={`rounded-full px-2 py-0.5 ${scope.types?.includes(type) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  .{type}
                </button>
              ))}
            </div>
          )}
          {/* No <form> here: the panel sits inside the chat's form, Enter must never send a message. */}
          <div className="mt-2 flex gap-2">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Chercher dans le code (ex. garage, spawn, payment)"
              onKeyDown={async (event) => {
                if (event.key === 'Enter') { event.preventDefault(); setResults(await workshop.search(query)); }
              }}
              className="min-w-0 flex-1 rounded-full bg-muted px-3 py-1 outline-none" data-testid="workshop-search" />
            <button type="button" onClick={async () => setResults(await workshop.search(query))}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 hover:text-foreground" data-testid="workshop-search-btn">
              <Search className="h-3 w-3" /> Chercher
            </button>
          </div>
          {results && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto" data-testid="workshop-results">
              {results.length === 0 && <li className="text-muted-foreground">Aucun fichier lu ne contient ces mots.</li>}
              {results.slice(0, 20).map((row) => (
                <li key={row.path}>
                  <span className="font-medium">{row.path}</span>
                  {row.lines.map((hit) => <span key={hit.line} className="block truncate text-muted-foreground">l.{hit.line} : {hit.text}</span>)}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => { setDetails((v) => !v); workshop.readScope(); }}
            className="mt-2 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" data-testid="workshop-details-toggle">
            {details ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Fichiers du périmètre
          </button>
          {details && (
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto" data-testid="workshop-files">
              {selected.slice(0, 1000).map((entry) => {
                const status = workshop.statusOf(entry.path);
                return (
                  <li key={entry.path} className="flex items-center gap-1.5">
                    {status?.state === 'lu' ? <CheckCircle2 className="h-3 w-3 text-primary" />
                      : status?.state === 'refusé' ? <ShieldAlert className="h-3 w-3 text-amber-500" />
                        : <CircleDashed className="h-3 w-3 text-muted-foreground" />}
                    <span className="truncate">{entry.path}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {status?.state === 'refusé' ? `non lu : ${status.reason}` : status?.state === 'lu' ? 'lu' : isReadable(entry) ? 'inventorié' : fileKind(entry.path)}
                    </span>
                  </li>
                );
              })}
              {selected.length > 1000 && <li className="text-muted-foreground">… {selected.length - 1000} autres fichiers</li>}
            </ul>
          )}
          {state.progress && <p className="mt-1 flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Lecture des fichiers…</p>}
          {state.changed?.length > 0 && (
            <p className="mt-2 text-amber-600 dark:text-amber-400" data-testid="workshop-changed">
              Modifiés depuis leur dernière étude : {state.changed.slice(0, 8).join(', ')}{state.changed.length > 8 ? '…' : ''}
            </p>
          )}
          <p className="mt-2 text-muted-foreground">Rien n'est envoyé tant que tu n'écris pas : à chaque message, seuls les fichiers utiles à ta question partent avec lui.</p>
        </>
      )}
    </div>
  );
}

// The line under the user's message: what was really given to the AI.
export const workshopSummary = (report) => (report
  ? `Atelier : ${report.full.length} fichier(s) en entier, ${report.partial.length} en extraits, ${report.outlined?.length || 0} dans le plan · ${report.tokens.toLocaleString('fr-FR')} jetons`
  : '');
