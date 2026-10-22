import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { splitMessage } from '@/utils/codeFiles';

// "Réflexion en cours ⌄" like ChatGPT: folded by default; opened, it shows what NEURA
// AL-NOUR is thinking (when the model shares its reasoning) and its steps live —
// every file being written, with its line count.
// Some models (gpt-oss) always reason in English, whatever they are asked: that raw
// reasoning is never shown as is — opened, it is translated to French (`translate`).
const ENGLISH = /\b(the|we|user|should|need|needs|must|provide|let's|maybe|then|with|and|is|are)\b/gi;
const FRENCH = /\b(le|la|les|des|une|un|je|nous|il|est|sont|pour|avec|dans|qui|que|et)\b/gi;
export const showableReasoning = (text) => {
  const value = String(text || '').trim();
  if (!value) return '';
  const english = (value.match(ENGLISH) || []).length;
  const french = (value.match(FRENCH) || []).length;
  return english > french ? '' : value;
};

export const isEnglishReasoning = (text) => Boolean(String(text || '').trim()) && !showableReasoning(text);

// Where the translation can stop: the end of the last full sentence (all of it once finished).
export const translatableEnd = (text, from, finished) => {
  if (finished) return text.length;
  const rest = text.slice(from);
  const match = rest.match(/[\s\S]*[.!?:\n](\s|$)/);
  return match ? from + match[0].length : from;
};

const duration = (seconds) => {
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return minutes ? `${minutes} min ${total % 60} s` : `${total} s`;
};

// Translates the English reasoning piece by piece while the panel is open.
function useFrenchReasoning(thinking, { open, finished, translate }) {
  const [french, setFrench] = useState('');
  const [doneUpTo, setDoneUpTo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const english = isEnglishReasoning(thinking);
  useEffect(() => {
    if (!open || !english || !translate || busy || failed) return;
    const end = translatableEnd(thinking, doneUpTo, finished);
    // While it is still thinking, wait for a few sentences instead of one call per word.
    if (end <= doneUpTo || (!finished && end - doneUpTo < 240)) return;
    setBusy(true);
    Promise.resolve(translate(thinking.slice(doneUpTo, end)))
      .then((text) => {
        if (!mounted.current) return;
        setFrench((previous) => `${previous}${previous ? ' ' : ''}${String(text || '').trim()}`);
        setDoneUpTo(end);
      })
      .catch(() => { if (mounted.current) setFailed(true); })
      .finally(() => { if (mounted.current) setBusy(false); });
  }, [open, english, translate, thinking, finished, busy, failed, doneUpTo]);
  if (!english) return { text: showableReasoning(thinking), pending: false };
  return { text: french, pending: open && Boolean(translate) && !failed && doneUpTo < thinking.length };
}

export default function ThinkingPanel({ thinking = '', content = '', active = false, label, seconds = 0, translate }) {
  const [open, setOpen] = useState(false);
  const { text: reasoning, pending } = useFrenchReasoning(thinking, { open, finished: !active, translate });
  const files = useMemo(
    () => splitMessage(content).filter((part) => part.type === 'code' && (part.path || part.lines >= 6)),
    [content],
  );
  const title = active
    ? (label || 'Réflexion en cours')
    : (seconds > 0 ? `Réfléchi pendant ${duration(seconds)}` : 'Réflexion terminée');
  return (
    <div className="mb-3" data-testid="thinking-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        data-testid="thinking-toggle"
      >
        {active ? <Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" /> : <Check className="h-3.5 w-3.5 text-primary" />}
        <span className={active ? 'animate-pulse' : ''} data-testid="thinking-title">{title}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-l-2 border-border pl-3 text-xs text-muted-foreground" data-testid="thinking-details">
          <p className="flex items-center gap-1.5">
            <Check className="h-3 w-3 text-primary" /> Analyse de ta demande
          </p>
          {reasoning && (
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed" data-testid="thinking-text">
              {reasoning}
            </p>
          )}
          {pending && (
            <p className="flex items-center gap-1.5" data-testid="thinking-translating">
              <Loader2 className="h-3 w-3 animate-spin" /> {reasoning ? 'Suite de la réflexion…' : 'Lecture de la réflexion…'}
            </p>
          )}
          {files.map((file, index) => (
            <p key={`${file.path || file.language}-${index}`} className="flex items-center gap-1.5">
              {file.complete
                ? <Check className="h-3 w-3 text-primary" />
                : <Loader2 className="h-3 w-3 animate-spin text-primary" />}
              {file.complete ? 'Écrit' : 'Écriture de'} {file.path || 'code'} · {file.lines} ligne{file.lines > 1 ? 's' : ''}
            </p>
          ))}
          {active && !content && !reasoning && !pending && (
            <p className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Préparation de la réponse…</p>
          )}
        </div>
      )}
    </div>
  );
}
