import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Code2, Send, Crown, Zap, Clock, Plus, History as HistoryIcon,
  Copy, Check, ArrowUpCircle, Loader2
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DEV_ROLES = [
  { value: '', label: 'Assistant général' },
  { value: 'frontend', label: 'Frontend senior' },
  { value: 'backend', label: 'Backend senior' },
  { value: 'fullstack', label: 'Fullstack senior' },
  { value: 'architect', label: 'Architecte logiciel' },
  { value: 'security', label: 'Expert sécurité' },
  { value: 'database', label: 'Expert base de données' },
  { value: 'mobile', label: 'Mobile senior' },
];

// Code block with a copy button (used to render fenced code from the AI).
function CodeBlock({ children }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = ref.current?.innerText || '';
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative my-3">
      <button
        onClick={copy}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
        data-testid="copy-code-btn"
      >
        {copied ? <><Check className="w-3 h-3" /> Copié</> : <><Copy className="w-3 h-3" /> Copier</>}
      </button>
      <pre ref={ref} className="overflow-x-auto rounded-lg bg-[#0d1117] text-[#e6edf3] p-4 text-sm border border-border">
        {children}
      </pre>
    </div>
  );
}

const mdComponents = {
  pre: CodeBlock,
  code: ({ children }) => (
    <code className="px-1.5 py-0.5 rounded bg-muted text-primary text-[0.85em]">{children}</code>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">{children}</a>
  ),
};

function formatReset(resetAt) {
  if (!resetAt) return '';
  const diff = new Date(resetAt).getTime() - Date.now();
  if (diff <= 0) return 'maintenant';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export default function DeveloperPage() {
  const { user, getAuthHeader } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [limitMsg, setLimitMsg] = useState(null);
  const [role, setRole] = useState('');
  const bottomRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/developer/status`, { headers: getAuthHeader() });
      setStatus(r.data);
    } catch (e) { /* ignore */ }
  }, [getAuthHeader]);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/developer/history`, { headers: getAuthHeader() });
      setHistory(r.data || []);
    } catch (e) { /* ignore */ }
  }, [getAuthHeader]);

  useEffect(() => { fetchStatus(); fetchHistory(); }, [fetchStatus, fetchHistory]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const loadSession = async (sid) => {
    try {
      const r = await axios.get(`${API}/developer/session/${sid}`, { headers: getAuthHeader() });
      setSessionId(sid);
      setMessages((r.data || []).map(m => ({ role: m.role, content: m.content })));
      setLimitMsg(null);
    } catch (e) { /* ignore */ }
  };

  const newSession = () => { setSessionId(null); setMessages([]); setLimitMsg(null); };

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLimitMsg(null);
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const r = await axios.post(`${API}/developer/chat`,
        { content: text, session_id: sessionId, role: role || null },
        { headers: getAuthHeader(), timeout: 120000 });
      setSessionId(r.data.session_id);
      setMessages(prev => [...prev, { role: 'assistant', content: r.data.response }]);
      if (r.data.quota) {
        setStatus(s => ({ ...(s || {}), used: r.data.quota.used, remaining: r.data.quota.remaining, reset_at: r.data.quota.reset_at }));
      }
      fetchHistory();
    } catch (err) {
      if (err.response?.status === 429) {
        const d = err.response.data?.detail || {};
        setLimitMsg(d.message || 'Limite atteinte.');
        if (d.quota) setStatus(s => ({ ...(s || {}), used: d.quota.used, remaining: 0, reset_at: d.quota.reset_at }));
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Service IA développeur temporairement indisponible. Réessaie.' }]);
      }
    } finally {
      setLoading(false);
    }
  };

  const tier = status?.tier || 'free';
  const isUltra = tier === 'ultra';
  const isPlus = tier === 'plus';

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-72 border-r border-border p-4 gap-4">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 text-lg font-bold">
          <Code2 className="w-6 h-6 text-primary" /> NEURA DEV
        </button>
        <Button onClick={newSession} className="rounded-full gap-2" data-testid="new-dev-session">
          <Plus className="w-4 h-4" /> Nouvelle demande
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
          <HistoryIcon className="w-4 h-4" /> Historique développeur
        </div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {history.length === 0 && <p className="text-xs text-muted-foreground">Aucune demande encore.</p>}
          {history.map(h => (
            <button key={h.session_id} onClick={() => loadSession(h.session_id)}
              className={`w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-muted truncate ${sessionId === h.session_id ? 'bg-muted' : ''}`}>
              {h.title || 'Sans titre'}
            </button>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col">
        {/* Quota / plan bar */}
        <div className="border-b border-border p-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-2">
            {isUltra ? <Crown className="w-5 h-5 text-yellow-500" /> : isPlus ? <Zap className="w-5 h-5 text-primary" /> : <Code2 className="w-5 h-5 text-muted-foreground" />}
            <span className="font-semibold">{status?.label || 'Gratuit'}</span>
            {status?.is_founder && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 text-xs font-medium">
                <Crown className="w-3 h-3" /> Fondateur
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            {status?.unlimited ? (
              <span className="text-primary font-medium">Génération illimitée</span>
            ) : (
              <>
                <span className="text-muted-foreground">
                  Crédits : <b className="text-foreground">{status?.remaining ?? '—'}</b> / {status?.limit ?? '—'}
                </span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-4 h-4" /> Régén. dans {formatReset(status?.reset_at)}
                </span>
              </>
            )}
            {!isUltra && (
              <Button size="sm" variant="outline" className="rounded-full gap-1"
                onClick={() => navigate('/subscription')} data-testid="dev-upgrade-btn">
                <ArrowUpCircle className="w-4 h-4" /> Upgrade
              </Button>
            )}
          </div>
        </div>

        <div className="border-b border-border px-3 py-2 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="text-muted-foreground">Rôle :</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={!isPlus && !isUltra}
            className="h-9 rounded-full border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
            data-testid="developer-role-select"
          >
            {DEV_ROLES.map((item) => (
              <option key={item.value || 'general'} value={item.value}>{item.label}</option>
            ))}
          </select>
          {!isPlus && !isUltra && (
            <span className="text-xs text-muted-foreground">Rôles experts réservés à Neura+ / Ultra.</span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {messages.length === 0 && (
            <div className="max-w-2xl mx-auto text-center mt-16">
              <Code2 className="w-12 h-12 text-primary mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-2">Assistant Développeur IA</h2>
              <p className="text-muted-foreground mb-6">
                Décris une fonctionnalité, un bug à corriger, une page à créer ou une API.
                L'IA propose un plan, les fichiers concernés (chemin exact) et le code prêt à copier.
              </p>
              <div className="grid sm:grid-cols-2 gap-2 text-left text-sm">
                {['Ajoute une page premium en React', 'Corrige ce bug : [colle ton erreur]', 'Crée une API Express pour des utilisateurs', 'Crée un petit script FiveM ESX'].map((ex, i) => (
                  <button key={i} onClick={() => setInput(ex)}
                    className="px-4 py-3 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`max-w-3xl mx-auto w-full ${m.role === 'user' ? 'text-right' : ''}`}>
              <div className={`inline-block text-left rounded-2xl px-4 py-3 ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 w-full'}`}>
                {m.role === 'assistant'
                  ? <div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{m.content}</ReactMarkdown></div>
                  : <span className="whitespace-pre-wrap">{m.content}</span>}
              </div>
            </div>
          ))}
          {loading && (
            <div className="max-w-3xl mx-auto w-full">
              <div className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 bg-muted/50 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> L'IA analyse et génère le code…
              </div>
            </div>
          )}
          {limitMsg && (
            <div className="max-w-3xl mx-auto w-full">
              <Card className="p-4 border-yellow-500/40 bg-yellow-500/5">
                <p className="text-sm mb-3">{limitMsg}</p>
                <div className="flex gap-2">
                  <Button size="sm" className="rounded-full" onClick={() => navigate('/subscription')}>Passer à Neura+</Button>
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => navigate('/subscription')}>Neura Ultra</Button>
                </div>
              </Card>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={send} className="border-t border-border p-3 md:p-4">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
              placeholder="Décris ta demande de code… (Entrée pour envoyer, Shift+Entrée = nouvelle ligne)"
              rows={1}
              className="flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary max-h-40"
              data-testid="dev-input"
            />
            <Button type="submit" disabled={loading || !input.trim()} className="rounded-full h-11 w-11 p-0" data-testid="dev-send">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
