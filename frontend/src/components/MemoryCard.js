import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Brain, Loader2, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const memoryDate = (iso) => {
  const day = new Date(iso);
  return Number.isNaN(day.getTime())
    ? ''
    : day.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};

// What NEURA AL-NOUR remembers about the user, like Claude's memory: seen, added, erased here.
export default function MemoryCard() {
  const { getAuthHeader } = useAuth();
  const [memories, setMemories] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(() => {
    axios.get(`${API}/ai/memory`, { headers: getAuthHeader() })
      .then((response) => setMemories(Array.isArray(response.data) ? response.data : []))
      .catch(() => setMemories([]));
  }, [getAuthHeader]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get(`${API}/ai/memory/settings`, { headers: getAuthHeader() })
      .then((response) => setEnabled(response.data?.enabled !== false))
      .catch(() => {});
  }, [getAuthHeader]);

  const toggle = async (value) => {
    setEnabled(value);
    try {
      await axios.put(`${API}/ai/memory/settings`, { enabled: value }, { headers: getAuthHeader() });
    } catch {
      setEnabled(!value);
      toast.error("Impossible de changer ce réglage.");
    }
  };

  const add = async (event) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setSaving(true);
    try {
      await axios.post(`${API}/ai/memory`, { label: 'souvenir', value }, { headers: getAuthHeader() });
      setDraft('');
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Impossible d'enregistrer ce souvenir.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await axios.delete(`${API}/ai/memory/${id}`, { headers: getAuthHeader() });
      setMemories((list) => (list || []).filter((item) => item.id !== id));
    } catch {
      toast.error("Impossible d'effacer ce souvenir.");
    }
  };

  const removeAll = async () => {
    if (!window.confirm('Effacer tous les souvenirs de NEURA AL-NOUR ?')) return;
    try {
      await axios.delete(`${API}/ai/memory`, { headers: getAuthHeader() });
      setMemories([]);
    } catch {
      toast.error("Impossible d'effacer la mémoire.");
    }
  };

  return (
    <Card className="p-6 mb-6" data-testid="memory-section">
      <h3 className="font-semibold mb-1 flex items-center gap-2">
        <Brain className="w-5 h-5 text-primary" />
        Mémoire
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        NEURA AL-NOUR retient ce que tu lui confies (prénom, ville, projets, goûts…) pour s'en souvenir
        dans tes prochaines conversations, même des mois plus tard. Les mots de passe et clés ne sont jamais retenus.
      </p>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-medium">Mémoire activée</p>
          <p className="text-xs text-muted-foreground">
            {enabled ? 'NEURA AL-NOUR retient et utilise tes souvenirs.' : "Rien n'est retenu ni utilisé. Tes souvenirs restent ici tant que tu ne les effaces pas."}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={toggle} data-testid="memory-toggle" aria-label="Mémoire activée" />
      </div>
      <form onSubmit={add} className="flex gap-2 mb-4">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={500}
          placeholder="Ajouter un souvenir (ex. : J'habite à Lyon)"
          className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid="memory-input"
        />
        <Button type="submit" size="sm" disabled={saving || !draft.trim()} data-testid="memory-add">Ajouter</Button>
      </form>
      {memories === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</p>
      ) : memories.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="memory-empty">Aucun souvenir pour l'instant.</p>
      ) : (
        <>
          <ul className="space-y-2 max-h-80 overflow-y-auto" data-testid="memory-list">
            {memories.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-md bg-muted/50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm break-words">{item.value}</p>
                  {memoryDate(item.created_at) && (
                    <p className="text-xs text-muted-foreground">Retenu le {memoryDate(item.created_at)}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Effacer ce souvenir"
                  data-testid="memory-delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="mt-4" onClick={removeAll} data-testid="memory-clear">
            Tout effacer
          </Button>
        </>
      )}
    </Card>
  );
}
