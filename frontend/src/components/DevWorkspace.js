import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  X, Save, GitCompare, CheckCircle2, History as HistoryIcon, Trash2,
  RefreshCw, Sparkles, FileCode, Lock
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Premium developer workspace: files stored server-side (in DB), with versioning,
// rollback, diff and a safe (no-exec) syntax check. Used from the chat "Code" mode.
export default function DevWorkspace({ open, onClose, lastAiCode }) {
  const { getAuthHeader } = useAuth();
  const [files, setFiles] = useState([]);
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState(null);
  const [diff, setDiff] = useState(null);
  const [history, setHistory] = useState(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/developer/files`, { headers: getAuthHeader() });
      setFiles(r.data || []); setLocked(false);
    } catch (e) {
      if (e.response?.status === 403) setLocked(true);
    }
  }, [getAuthHeader]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const loadFile = async (p) => {
    try {
      const r = await axios.get(`${API}/developer/files/content`, { headers: getAuthHeader(), params: { path: p } });
      setPath(r.data.path); setContent(r.data.content); setStatus(null); setDiff(null); setHistory(null);
    } catch (e) { /* ignore */ }
  };

  const save = async () => {
    if (!path.trim()) { setStatus('Indique un chemin de fichier (ex: src/App.js).'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/developer/files`, { path: path.trim(), content }, { headers: getAuthHeader() });
      setStatus('Enregistré (version précédente sauvegardée, rollback possible).'); setDiff(null); refresh();
    } catch (e) { setStatus('Erreur enregistrement.'); }
    setBusy(false);
  };

  const showDiff = async () => {
    if (!path.trim()) { setStatus('Indique un chemin de fichier.'); return; }
    try {
      const r = await axios.post(`${API}/developer/files/diff`, { path: path.trim(), new_content: content }, { headers: getAuthHeader() });
      setDiff(r.data); setStatus(r.data.is_new ? 'Nouveau fichier.' : `Changements : +${r.data.added} / -${r.data.removed}`);
    } catch (e) { setStatus('Erreur diff.'); }
  };

  const checkSyntax = async () => {
    try {
      const r = await axios.post(`${API}/developer/syntax-check`, { path: path.trim() || 'x.txt', content }, { headers: getAuthHeader() });
      setStatus((r.data.ok ? 'OK - ' : 'Erreur - ') + r.data.message);
    } catch (e) { setStatus('Erreur vérif syntaxe.'); }
  };

  const loadHistory = async () => {
    try {
      const r = await axios.get(`${API}/developer/files/history`, { headers: getAuthHeader(), params: { path: path.trim() } });
      setHistory(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const rollback = async (vid) => {
    try {
      await axios.post(`${API}/developer/files/rollback`, { path: path.trim(), version_id: vid }, { headers: getAuthHeader() });
      await loadFile(path); setStatus('Version restaurée.'); setHistory(null);
    } catch (e) { setStatus('Erreur rollback.'); }
  };

  const del = async (p) => {
    try {
      await axios.delete(`${API}/developer/files`, { headers: getAuthHeader(), params: { path: p } });
      if (p === path) { setPath(''); setContent(''); }
      refresh();
    } catch (e) { /* ignore */ }
  };

  const useAiCode = () => {
    if (!lastAiCode) { setStatus('Aucun code IA détecté dans la dernière réponse.'); return; }
    if (lastAiCode.path) setPath(lastAiCode.path);
    setContent(lastAiCode.code);
    setStatus("Code de l'IA chargé - vérifie le chemin, puis Diff / Enregistrer.");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-3">
          <div className="flex items-center gap-2 font-semibold"><FileCode className="w-5 h-5 text-primary" /> Projet — Espace développeur</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        {locked ? (
          <div className="p-8 text-center">
            <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-1">Espace de travail réservé à Neura+ / Neura Ultra</p>
            <p className="text-sm text-muted-foreground mb-4">Applique le code, garde un historique et reviens en arrière (rollback) sur tes fichiers.</p>
            <Button onClick={() => { window.location.href = '/subscription'; }} className="rounded-full">Passer à Neura+</Button>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* Files list */}
            <div className="w-52 border-r border-border p-2 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Fichiers</span>
                <button onClick={refresh} className="p-1 rounded hover:bg-muted" title="Rafraîchir"><RefreshCw className="w-3.5 h-3.5" /></button>
              </div>
              <button onClick={() => { setPath(''); setContent(''); setStatus('Nouveau fichier.'); setDiff(null); setHistory(null); }}
                className="w-full text-left text-sm px-2 py-1 rounded text-primary hover:bg-muted mb-1">+ Nouveau</button>
              {files.length === 0 && <p className="text-xs text-muted-foreground px-2">Aucun fichier.</p>}
              {files.map((f) => (
                <div key={f.path} className="group flex items-center justify-between text-sm px-2 py-1 rounded hover:bg-muted">
                  <button onClick={() => loadFile(f.path)} className="truncate text-left flex-1">{f.path}</button>
                  <button onClick={() => del(f.path)} className="opacity-0 group-hover:opacity-100 text-destructive ml-1" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>

            {/* Editor */}
            <div className="flex-1 flex flex-col p-3 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="chemin/du/fichier.js"
                  className="flex-1 text-sm rounded-lg border border-border bg-background px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary" />
                <Button size="sm" variant="outline" className="rounded-full gap-1" onClick={useAiCode} title="Reprendre le code de la dernière réponse IA">
                  <Sparkles className="w-4 h-4" /> Code IA
                </Button>
              </div>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="// contenu du fichier…"
                className="flex-1 resize-none rounded-lg bg-[#0d1117] text-[#e6edf3] p-3 text-sm font-mono border border-border min-h-[200px] outline-none" />

              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Button size="sm" className="rounded-full gap-1" onClick={save} disabled={busy}><Save className="w-4 h-4" /> Enregistrer</Button>
                <Button size="sm" variant="outline" className="rounded-full gap-1" onClick={showDiff}><GitCompare className="w-4 h-4" /> Diff</Button>
                <Button size="sm" variant="outline" className="rounded-full gap-1" onClick={checkSyntax}><CheckCircle2 className="w-4 h-4" /> Syntaxe</Button>
                <Button size="sm" variant="outline" className="rounded-full gap-1" onClick={loadHistory}><HistoryIcon className="w-4 h-4" /> Historique</Button>
              </div>

              {status && <p className="text-xs mt-2 text-muted-foreground">{status}</p>}

              {diff && diff.diff && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-2 text-xs">
                  {diff.diff.split('\n').map((l, i) => (
                    <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'text-green-500' : (l.startsWith('-') && !l.startsWith('---') ? 'text-red-500' : 'text-muted-foreground')}>{l}</div>
                  ))}
                </pre>
              )}

              {history && (
                <div className="mt-2 max-h-40 overflow-auto border border-border rounded-lg p-2">
                  <p className="text-xs text-muted-foreground mb-1">Versions précédentes ({history.length}) :</p>
                  {history.length === 0 && <p className="text-xs text-muted-foreground">Aucune version.</p>}
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-xs py-1">
                      <span className="text-muted-foreground">{new Date(h.saved_at).toLocaleString()}</span>
                      <button onClick={() => rollback(h.id)} className="text-primary hover:underline">Restaurer</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
