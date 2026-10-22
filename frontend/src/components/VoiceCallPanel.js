import { useState } from 'react';
import { Loader2, Mic, PhoneOff, Volume2, Play } from 'lucide-react';
import { VOICE_GROUPS } from '@/utils/voice';

export function VoicePicker({ value, onChange, disabled, onPreview, previewing, className = '' }) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label="Voix"
        className="rounded-full bg-muted px-3 py-1.5 text-sm border-0 outline-none cursor-pointer disabled:opacity-60"
        data-testid="voice-picker"
      >
        {VOICE_GROUPS.map((group) => (
          <optgroup key={group.gender} label={group.label}>
            {group.voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label} · {group.gender === 'female' ? 'féminine' : group.gender === 'male' ? 'masculine' : 'neutre'}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          disabled={disabled || previewing}
          className="p-1.5 rounded-full bg-muted hover:text-primary disabled:opacity-50"
          aria-label="Écouter cette voix"
          title="Écouter cette voix"
          data-testid="voice-preview"
        >
          {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

const PHASES = {
  paused: 'Micro en pause pendant que tu écris…',
  listening: 'Je t’écoute… parle quand tu veux',
  transcribing: 'Je note ce que tu as dit…',
  thinking: 'Je réfléchis…',
  speaking: 'Je te réponds… (touche pour couper)',
  idle: 'Connexion…',
};

// Call screen shown above the message box while a voice call is running.
export default function VoiceCallPanel({ call, voice, onVoiceChange, title = 'Appel vocal' }) {
  const [previewing, setPreviewing] = useState(false);
  const preview = async () => {
    setPreviewing(true);
    try {
      await call.speak('Salam alaykoum ! Voici ma voix. On peut parler quand tu veux.');
    } catch (error) {
      call.setError(error?.message || 'Voix indisponible.');
    } finally {
      setPreviewing(false);
    }
  };
  const scale = 1 + Math.min(0.35, call.level * 0.6);
  return (
    <div className="mb-3 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-background to-emerald-500/10 p-4" data-testid="voice-call-panel">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={call.interrupt}
          className="relative w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30 transition-transform"
          style={{ transform: `scale(${call.phase === 'listening' ? scale : 1})` }}
          aria-label={call.phase === 'speaking' ? 'Couper la voix' : 'Appel en cours'}
        >
          {call.phase === 'speaking' ? <Volume2 className="w-6 h-6" />
            : call.phase === 'listening' || call.phase === 'paused' ? <Mic className={`w-6 h-6 ${call.phase === 'paused' ? 'opacity-50' : ''}`} />
              : <Loader2 className="w-6 h-6 animate-spin" />}
          {call.phase === 'listening' && <span className="absolute inset-0 rounded-full border-2 border-primary animate-ping opacity-40" />}
        </button>
        <div className="flex-1 min-w-[160px]">
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground" data-testid="voice-call-phase">{PHASES[call.phase] || PHASES.idle}</p>
          {call.error && <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">{call.error}</p>}
        </div>
        <VoicePicker value={voice} onChange={onVoiceChange} onPreview={preview} previewing={previewing} />
        <button
          type="button"
          onClick={call.stop}
          className="inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          data-testid="voice-call-hangup"
        >
          <PhoneOff className="w-4 h-4" /> Raccrocher
        </button>
      </div>
    </div>
  );
}
