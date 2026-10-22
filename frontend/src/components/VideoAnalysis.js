import { useCallback, useRef, useState } from 'react';
import axios from 'axios';
import { Clapperboard, Loader2, Search, Square, X } from 'lucide-react';
import {
  VIDEO_LIMITS, buildTimeline, candidateTimes, captureCandidates, chooseFrames, composeGrids, coverageOf,
  decodeSpeechTrack, findSpeech, mmss, openVideo, parseFrameLines, searchTimeline, spanOf, timelineText, videoSummary,
  wavBase64, windowsFor,
} from '@/utils/videoAnalysis';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const MODES = [
  ['full', 'Vidéo complète'],
  ['first_half', 'Première moitié'],
  ['second_half', 'Seconde moitié'],
  ['ranges', 'Plages précises'],
  ['search', 'Chercher un moment'],
];
const errorText = (error) => error?.response?.data?.detail || error?.message || 'Erreur inconnue';

// The video of the conversation: opened in the browser (never uploaded whole), analysed on demand
// in the part the user chose; its timeline is then given with each question.
export function useVideoAnalysis(getAuthHeader) {
  const [state, setState] = useState(null);
  const fileRef = useRef(null);
  const handleRef = useRef(null);
  const stopRef = useRef(false);

  // What the person may still analyse today (shown before analysing, refreshed after).
  const refreshQuota = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/video/status`, { headers: getAuthHeader() });
      setState((s) => (s ? { ...s, quota: response.data } : s));
      return response.data;
    } catch (error) {
      return null;
    }
  }, [getAuthHeader]);

  const close = useCallback(() => {
    stopRef.current = true;
    handleRef.current?.close();
    handleRef.current = null;
    fileRef.current = null;
    setState(null);
  }, []);

  const open = useCallback(async (file) => {
    handleRef.current?.close();
    fileRef.current = file;
    setState({ name: file.name, size: file.size, loading: true, mode: 'full', ranges: '', query: '', result: null, error: null });
    try {
      const handle = await openVideo(file);
      handleRef.current = handle;
      setState((s) => ({ ...s, loading: false, duration: handle.duration, width: handle.width, height: handle.height }));
      refreshQuota();
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: errorText(error) }));
    }
  }, [refreshQuota]);

  const setOptions = useCallback((options) => setState((s) => (s ? { ...s, ...options, result: null } : s)), []);
  const stop = useCallback(() => { stopRef.current = true; }, []);

  const analyse = useCallback(async (level = 'auto') => {
    const handle = handleRef.current;
    if (!handle || !state) return;
    const progress = (label, done, total) => setState((s) => ({ ...s, progress: { label, done, total } }));
    const windows = windowsFor(state.mode, handle.duration, state.ranges);
    if (!windows.length) { setState((s) => ({ ...s, error: 'Plages invalides : écris par exemple 1:00-2:30, 5:10-6:00' })); return; }
    stopRef.current = false;
    setState((s) => ({ ...s, running: true, error: null, result: null }));
    const headers = getAuthHeader();
    let neurons = 0;
    let stoppedBy = null;
    try {
      const status = await axios.get(`${API}/video/status`, { headers });
      if (!status.data?.enabled) throw new Error("L'analyse vidéo n'est pas encore activée.");
      // 1. frames: examined evenly, kept where the picture changes, described 4 by 4
      const times = candidateTimes(windows);
      const candidates = await captureCandidates(handle.video, times, {
        onProgress: (done, total) => progress('Images examinées', done, total), shouldStop: () => stopRef.current,
      });
      const chosen = chooseFrames(candidates, { max: VIDEO_LIMITS.maxFrames[level] || VIDEO_LIMITS.maxFrames.auto });
      const grids = await composeGrids(chosen);
      const frames = [];
      for (let i = 0; i < grids.length && !stopRef.current && !stoppedBy; i += 1) {
        progress('Images analysées', i * VIDEO_LIMITS.framesPerGrid, chosen.length);
        try {
          // eslint-disable-next-line no-await-in-loop
          const response = await axios.post(`${API}/video/frames`, { image_base64: grids[i].image, timestamps: grids[i].times }, { headers });
          neurons += response.data.neurons || 0;
          frames.push(...parseFrameLines(response.data.text, grids[i].times));
        } catch (error) { stoppedBy = errorText(error); }
      }
      // 2. speech: only the spoken parts, with their place in the video
      let speech = { status: 'skipped', reason: 'arrêtée avant l’audio' };
      const segments = [];
      if (!stopRef.current && !stoppedBy) {
        progress('Lecture de l’audio', 0, 1);
        const track = await decodeSpeechTrack(fileRef.current, handle.duration);
        if (!track.samples) speech = { status: 'skipped', reason: track.reason };
        else {
          const pieces = findSpeech(track.samples, track.rate, windows);
          let spoken = 0;
          for (let i = 0; i < pieces.length && !stopRef.current && !stoppedBy; i += 1) {
            progress('Paroles transcrites', i, pieces.length);
            const [a, b] = pieces[i];
            try {
              // eslint-disable-next-line no-await-in-loop
              const response = await axios.post(`${API}/video/speech`, {
                audio_base64: wavBase64(track.samples, track.rate, a, b), offset: a, language: 'fr',
              }, { headers });
              neurons += response.data.neurons || 0;
              segments.push(...response.data.segments);
              spoken += b - a;
            } catch (error) { stoppedBy = errorText(error); }
          }
          speech = { status: 'ok', spokenSeconds: spoken, pieces: pieces.length, segments };
          if (stoppedBy || stopRef.current) speech = { ...speech, status: 'partial' };
        }
      }
      if (speech.status === 'partial') speech = { status: 'ok', ...speech, partial: true };
      const coverage = coverageOf({ windows, frames, speech: speech.status === 'ok' ? { ...speech, segments } : speech });
      const timeline = buildTimeline({ frames, segments });
      const query = state.mode === 'search' || state.query ? state.query : '';
      const matches = query ? searchTimeline(timeline, query) : [];
      setState((s) => ({ ...s, running: false, progress: null,
        result: { coverage, timeline, matches, query, neurons: Math.round(neurons * 10) / 10, stoppedBy: stoppedBy || (stopRef.current ? 'arrêtée par toi' : null) } }));
    } catch (error) {
      setState((s) => ({ ...s, running: false, progress: null, error: errorText(error) }));
    }
    refreshQuota();
  }, [getAuthHeader, state, refreshQuota]);

  const contextFor = useCallback(() => {
    if (!state?.result) return null;
    const text = timelineText({ name: state.name, duration: state.duration, ...state.result });
    return { text, summary: videoSummary({ name: state.name, coverage: state.result.coverage }) };
  }, [state]);

  return { state, active: Boolean(state), ready: Boolean(state?.result), open, close, setOptions, analyse, stop, contextFor };
}

export function VideoAnalysisPanel({ video, level }) {
  const { state } = video;
  if (!state) return null;
  const result = state.result;
  const c = result?.coverage;
  return (
    <div className="mb-2 rounded-2xl border border-border bg-card/70 p-3 text-xs" data-testid="video-analysis">
      <div className="flex items-center gap-2">
        <Clapperboard className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium" data-testid="video-name">{state.name}</span>
        <span className="shrink-0 text-muted-foreground">
          {state.loading ? 'Ouverture…' : state.duration ? `${mmss(state.duration)} · ${state.width}×${state.height}` : ''}
        </span>
        <button type="button" onClick={video.close} className="rounded-full p-1 text-muted-foreground hover:text-foreground" aria-label="Fermer la vidéo" data-testid="video-close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {state.error && <p className="mt-2 text-destructive" data-testid="video-error">{state.error}</p>}
      {!state.loading && state.duration > 0 && (
        <>
          {/* No <form>: the panel is inside the chat's form, Enter must never send a message. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={state.mode} onChange={(e) => video.setOptions({ mode: e.target.value })} disabled={state.running}
              className="rounded-full border-0 bg-muted px-3 py-1 outline-none" data-testid="video-mode" aria-label="Partie à analyser">
              {MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            {state.mode === 'ranges' && (
              <input value={state.ranges} onChange={(e) => video.setOptions({ ranges: e.target.value })} placeholder="ex. 1:00-2:30, 5:10-6:00"
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} className="w-44 rounded-full bg-muted px-3 py-1 outline-none" data-testid="video-ranges" />
            )}
            {state.mode === 'search' && (
              <span className="inline-flex items-center gap-1">
                <Search className="h-3 w-3" />
                <input value={state.query} onChange={(e) => video.setOptions({ query: e.target.value })} placeholder="mot ou texte à trouver"
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} className="w-44 rounded-full bg-muted px-3 py-1 outline-none" data-testid="video-query" />
              </span>
            )}
            {state.running ? (
              <button type="button" onClick={video.stop} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1" data-testid="video-stop">
                <Square className="h-3 w-3" /> Arrêter
              </button>
            ) : (
              <button type="button" onClick={() => video.analyse(level)} className="rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground" data-testid="video-analyse">
                {result ? 'Analyser à nouveau' : 'Analyser'}
              </button>
            )}
          </div>
          {state.quota && !state.running && (
            <p className="mt-2 text-muted-foreground" data-testid="video-quota">
              {(() => {
                const part = spanOf(windowsFor(state.mode, state.duration, state.ranges));
                const chosen = part ? `Partie choisie : ${mmss(part)}` : 'Partie choisie : aucune plage valide';
                if (!state.quota.enabled) return "L'analyse vidéo n'est pas activée pour le moment.";
                if (state.quota.unlimited) return `${chosen} · analyse vidéo sans limite pour ton compte`;
                const left = state.quota.minutes_left_today;
                const warn = part / 60 > left ? ' — la fin ne pourra pas être analysée aujourd’hui si la vidéo parle tout le temps' : '';
                return `${chosen} · il te reste aujourd’hui environ ${left} min de vidéo parlée${warn}`;
              })()}
            </p>
          )}
          {state.progress && (
            <p className="mt-2 flex items-center gap-1.5 text-muted-foreground" data-testid="video-progress">
              <Loader2 className="h-3 w-3 animate-spin" /> {state.progress.label} {state.progress.total > 1 ? `${state.progress.done}/${state.progress.total}` : '…'}
            </p>
          )}
          {result && (
            <div className="mt-2 space-y-0.5 text-muted-foreground" data-testid="video-coverage">
              <p>Analysé : {c.windows.join(', ')} · {c.frames} images (au plus {c.largestGap} s sans image)</p>
              <p>{c.speech.status === 'ok' ? `Paroles : ${c.speech.spokenSeconds} s transcrites (${c.speech.segments} phrases)${c.speech.partial ? ' — partiel' : ''}` : `Paroles non analysées : ${c.speech.reason}`}</p>
              {result.query && (
                <p data-testid="video-matches">
                  {result.matches.length ? `« ${result.query} » trouvé à ${result.matches.map((m) => mmss(m.t)).join(', ')}` : `« ${result.query} » : rien trouvé dans ce qui a été analysé`}
                </p>
              )}
              <p>Coût : {result.neurons} neurones{result.stoppedBy ? ` · interrompue : ${result.stoppedBy}` : ''}</p>
              <p className="text-foreground">Pose maintenant ta question sur la vidéo.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
