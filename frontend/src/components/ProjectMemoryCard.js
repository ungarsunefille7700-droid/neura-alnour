import { useEffect, useState } from 'react';
import axios from 'axios';
import { Brain, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// The project memory of the conversation (step 2): what Neura keeps between messages and
// sessions — objective, constraints, decisions, files studied and delivered, open errors.
export default function ProjectMemoryCard({ conversationId, refreshKey }) {
  const { getAuthHeader } = useAuth();
  const [memory, setMemory] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Never the memory of another conversation, even for an instant (a refresh keeps it on screen).
    setMemory((current) => (current && current.conversation_id === conversationId ? current : null));
    if (!conversationId) return undefined;
    let alive = true;
    // The memory is updated in the background just after an answer (the summary of the
    // objective / constraints takes a few seconds): read it again a little later.
    const load = () => axios.get(`${API}/projects/memory`, { headers: getAuthHeader(), params: { conversation_id: conversationId } })
      .then((response) => { if (alive) setMemory(response.data?.memory || null); })
      .catch(() => {});
    const timers = refreshKey ? [setTimeout(load, 4000), setTimeout(load, 15000)] : [setTimeout(load, 0)];
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [conversationId, refreshKey, getAuthHeader]);

  if (!memory) return null;
  const studied = memory.files_studied || [];
  const read = studied.filter((file) => file.state === 'lu').length;
  const erase = async () => {
    if (!window.confirm('Effacer la mémoire de ce projet ? La conversation reste.')) return;
    await axios.delete(`${API}/projects/memory`, { headers: getAuthHeader(), params: { conversation_id: conversationId } }).catch(() => {});
    setMemory(null);
  };
  const list = (label, items) => (items?.length ? (
    <div><span className="font-medium">{label} :</span><ul className="ml-4 list-disc">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>
  ) : null);

  return (
    <div className="mb-2 rounded-2xl border border-border bg-card/70 px-3 py-2 text-xs" data-testid="project-memory">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-left" data-testid="project-memory-toggle">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Brain className="h-3.5 w-3.5 text-primary" />
          <span className="truncate font-medium">Mémoire du projet : {memory.archive?.name || 'projet'}</span>
          <span className="shrink-0 text-muted-foreground">· {read} fichiers étudiés · {memory.modified_files?.length || 0} livrés{memory.open_errors?.length ? ` · ${memory.open_errors.length} erreur(s) ouverte(s)` : ''}</span>
        </button>
        <button type="button" onClick={erase} className="rounded-full p-1 text-muted-foreground hover:text-destructive" aria-label="Effacer la mémoire du projet" data-testid="project-memory-erase">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 text-muted-foreground" data-testid="project-memory-details">
          {memory.objective && <p><span className="font-medium">Objectif :</span> {memory.objective}</p>}
          {list('Contraintes', memory.constraints)}
          {list('Décisions', memory.decisions)}
          {list('Étapes restantes', memory.remaining_steps)}
          {list('Erreurs encore ouvertes', memory.open_errors)}
          {memory.modified_files?.length > 0 && list('Fichiers livrés', memory.modified_files.map((file) => `${file.path} · ${file.lines} lignes`))}
          {memory.changed_since_studied?.length > 0 && list('Modifiés depuis leur étude', memory.changed_since_studied)}
        </div>
      )}
    </div>
  );
}
