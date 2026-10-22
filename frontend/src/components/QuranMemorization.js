import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { BookCheck, Check, RotateCcw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const REVIEW_DAYS = 7;

export const STATUS_LABELS = { none: 'Pas commencée', learning: 'En cours', learned: 'Apprise' };

// A learned surah not revised for a week is to be reviewed.
export const needsReview = (row, now = Date.now()) => {
  if (!row || row.status !== 'learned') return false;
  const last = Date.parse(row.last_reviewed_at || row.updated_at || '');
  return Number.isNaN(last) || now - last > REVIEW_DAYS * 24 * 3600 * 1000;
};

export const summarize = (rows) => {
  const list = Object.values(rows || {});
  return {
    learned: list.filter((row) => row.status === 'learned').length,
    learning: list.filter((row) => row.status === 'learning').length,
    review: list.filter((row) => needsReview(row)).length,
  };
};

// Memorization of the Quran (free for everyone): saved with the account.
export function useQuranMemorization() {
  const { user, getAuthHeader } = useAuth();
  const [rows, setRows] = useState({});

  useEffect(() => {
    if (!user) { setRows({}); return; }
    axios.get(`${API}/quran/memorization`, { headers: getAuthHeader() })
      .then((response) => {
        const next = {};
        (response.data?.surahs || []).forEach((row) => { next[row.surah] = row; });
        setRows(next);
      })
      .catch(() => {});
  }, [user, getAuthHeader]);

  const update = useCallback(async (surah, body) => {
    if (!user) {
      toast.error('Connecte-toi pour suivre ta mémorisation.');
      return;
    }
    try {
      const response = await axios.put(`${API}/quran/memorization/${surah}`, body, { headers: getAuthHeader() });
      setRows((previous) => {
        const next = { ...previous };
        if (response.data?.status === 'none') delete next[surah];
        else next[surah] = response.data;
        return next;
      });
    } catch {
      toast.error("Impossible d'enregistrer ta mémorisation.");
    }
  }, [user, getAuthHeader]);

  return { rows, update, signedIn: Boolean(user) };
}

export function MemorizationSummary({ rows }) {
  const { learned, learning, review } = summarize(rows);
  if (!learned && !learning) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm" data-testid="memorization-summary">
      <BookCheck className="h-5 w-5 text-primary" />
      <span><strong>{learned}</strong> apprise{learned > 1 ? 's' : ''}</span>
      <span><strong>{learning}</strong> en cours</span>
      {review > 0 && <span className="text-amber-600 dark:text-amber-400"><strong>{review}</strong> à réviser</span>}
    </div>
  );
}

export function MemorizationDot({ row }) {
  if (!row) return null;
  const review = needsReview(row);
  const label = review ? 'À réviser' : STATUS_LABELS[row.status];
  const color = review ? 'bg-amber-500' : row.status === 'learned' ? 'bg-emerald-500' : 'bg-blue-500';
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="memorization-dot">
      <span className={`h-2 w-2 rounded-full ${color}`} /> {label}
    </span>
  );
}

export function MemorizationBar({ surah, row, onUpdate }) {
  const status = row?.status || 'none';
  const last = row?.last_reviewed_at ? new Date(row.last_reviewed_at).toLocaleDateString('fr-FR') : null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm" data-testid="memorization-bar">
      <span className="font-medium">Mémorisation :</span>
      {['none', 'learning', 'learned'].map((key) => (
        <button key={key} type="button" onClick={() => onUpdate(surah, { status: key })}
          className={`rounded-full px-3 py-1 text-xs ${status === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
          aria-pressed={status === key} data-testid={`memorization-${key}`}>
          {status === key && <Check className="mr-1 inline h-3 w-3" />}{STATUS_LABELS[key]}
        </button>
      ))}
      {status === 'learned' && (
        <button type="button" onClick={() => onUpdate(surah, { reviewed: true })}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          data-testid="memorization-review">
          <RotateCcw className="h-3 w-3" /> J’ai révisé aujourd’hui
        </button>
      )}
      {last && <span className="text-xs text-muted-foreground">Dernière révision : {last}{row?.reviews ? ` · ${row.reviews} révision${row.reviews > 1 ? 's' : ''}` : ''}</span>}
    </div>
  );
}
