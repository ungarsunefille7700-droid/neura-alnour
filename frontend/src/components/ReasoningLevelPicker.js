import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';

// The reasoning level picker, like ChatGPT's: it opens above the message bar on a blurred
// background, the chosen level is written above a horizontal track with one stop per level,
// a round knob and the active part of the track filled. Levels the subscription does not
// include are shown locked (the server refuses them anyway).
export const LEVELS = ['instant', 'medium', 'high', 'very_high'];
const SHORT = { auto: 'Auto', instant: 'Instantané', medium: 'Moyenne', high: 'Élevée', very_high: 'Très élevée' };
const HINT = {
  auto: 'Neura choisit selon ta demande',
  instant: 'Réponses rapides, sans étape de réflexion',
  medium: 'Réfléchit un peu avant de répondre',
  high: 'Réfléchit davantage : code, analyses, problèmes',
  very_high: 'Réflexion la plus approfondie',
};

export const levelLabel = (key) => SHORT[key] || SHORT.instant;

export default function ReasoningLevelPicker({ modes = [], value = 'instant', onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const trackRef = useRef(null);
  const dragging = useRef(false);
  const byKey = Object.fromEntries(modes.map((mode) => [mode.key, mode]));
  const hasAuto = Boolean(byKey.auto);
  const current = value === 'auto' && hasAuto ? 'auto' : (LEVELS.includes(value) ? value : 'instant');
  const index = Math.max(0, LEVELS.indexOf(current === 'auto' ? 'instant' : current));
  const available = (key) => byKey[key]?.available !== false;

  const choose = useCallback((key) => {
    if (!available(key) || key === value) return;
    onChange?.(key);
  }, [value, onChange]);

  const fromPointer = (clientX) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    let target = Math.round(ratio * (LEVELS.length - 1));
    while (target > 0 && !available(LEVELS[target])) target -= 1;  // never past what the plan includes
    choose(LEVELS[target]);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = LEVELS[Math.min(LEVELS.length - 1, Math.max(0, index + step))];
        if (available(next)) choose(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, choose]);

  if (!modes.length) return null;
  const fill = current === 'auto' ? 0 : (index / (LEVELS.length - 1)) * 100;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        disabled={disabled}
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="intelligence-mode-selector"
        data-level={current}
      >
        <span className="hidden sm:inline">{levelLabel(current)}</span>
        <span className="sm:hidden">{levelLabel(current).split(' ')[0]}</span>
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-label="Niveau de réflexion"
          data-testid="reasoning-picker">
          <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setOpen(false)} data-testid="reasoning-backdrop" />
          <div className="relative mb-28 w-[min(92vw,26rem)] rounded-3xl border border-border bg-background p-5 shadow-2xl">
            {hasAuto && (
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Réflexion</span>
                <button type="button" onClick={() => choose(current === 'auto' ? 'instant' : 'auto')}
                  className={`rounded-full px-3 py-1 text-xs ${current === 'auto' ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'}`}
                  aria-pressed={current === 'auto'} data-testid="reasoning-auto">
                  Auto
                </button>
              </div>
            )}
            <p className="text-center text-lg font-semibold" data-testid="reasoning-current">{levelLabel(current)}</p>
            <p className="mb-5 text-center text-xs text-muted-foreground">{HINT[current]}</p>
            <div
              ref={trackRef}
              className="relative mx-3 h-8 cursor-pointer touch-none select-none"
              onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); fromPointer(event.clientX); }}
              onPointerMove={(event) => { if (dragging.current) fromPointer(event.clientX); }}
              onPointerUp={() => { dragging.current = false; }}
              data-testid="reasoning-track"
            >
              <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
              <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-500 transition-all duration-200"
                style={{ width: `${fill}%` }} data-testid="reasoning-fill" />
              {LEVELS.map((key, position) => (
                <button
                  key={key}
                  type="button"
                  onClick={(event) => { event.stopPropagation(); choose(key); }}
                  onPointerDown={(event) => event.stopPropagation()}
                  disabled={!available(key)}
                  className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                  style={{ left: `${(position / (LEVELS.length - 1)) * 100}%` }}
                  aria-label={`${levelLabel(key)}${available(key) ? '' : ` (avec ${byKey[key]?.plan_needed || 'un abonnement'})`}`}
                  aria-pressed={current === key}
                  data-testid={`reasoning-stop-${key}`}
                >
                  {available(key)
                    ? <span className={`h-2.5 w-2.5 rounded-full ${position <= index && current !== 'auto' ? 'bg-blue-500' : 'bg-muted-foreground/40'}`} />
                    : <Lock className="h-3 w-3 text-muted-foreground" />}
                </button>
              ))}
              {current !== 'auto' && (
                <span className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-500 shadow-md transition-all duration-200"
                  style={{ left: `${fill}%` }} data-testid="reasoning-knob" />
              )}
            </div>
            <div className="mt-2 flex justify-between px-1 text-[11px] text-muted-foreground">
              {LEVELS.map((key) => (
                <span key={key} className={current === key ? 'font-medium text-foreground' : ''}>{levelLabel(key)}</span>
              ))}
            </div>
            {LEVELS.some((key) => !available(key)) && (
              <p className="mt-4 text-center text-xs text-muted-foreground" data-testid="reasoning-upsell">
                {LEVELS.filter((key) => !available(key)).map((key) => `${levelLabel(key)} avec ${byKey[key]?.plan_needed || 'un abonnement'}`).join(' · ')}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
