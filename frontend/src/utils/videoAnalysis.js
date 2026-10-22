// Video analysis in the browser (step 5): the video never leaves the computer. Only what is
// needed goes to the server: a few frames (4 per picture, each with its time) and the pieces of
// audio where someone speaks (silences are not sent: they would be charged for nothing).
// Everything really covered is measured and said; nothing is presented as seen if it was not.

export const VIDEO_LIMITS = {
  maxFrames: { instant: 16, medium: 32, high: 48, very_high: 64, auto: 32 }, // frames kept per analysis
  minGap: 2, // never two kept frames closer than this (s), except the scene changes
  maxGap: 30, // a frame at least every 30 s, even when nothing changes
  candidatesMax: 240, // frames examined to find the scene changes
  framesPerGrid: 4,
  cellWidth: 640,
  speechMaxSeconds: 28, // one piece of speech sent at a time (the server takes 30 s at most)
  audioMaxMinutes: 45, // beyond, the audio is not decoded in the browser (memory): said in the coverage
};

export const mmss = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// "1:00-2:30, 5:10-6" -> [[60, 150], [310, 360]]
export const parseRanges = (text, duration) => {
  const toSeconds = (part) => part.trim().split(':').reduce((acc, n) => acc * 60 + Number(n), 0);
  return String(text || '').split(/[,;]+/).map((part) => part.split(/\s*[-–à]\s*/))
    .filter((pair) => pair.length === 2 && pair.every((p) => /^\s*\d+(:\d{1,2}){0,2}\s*$/.test(p)))
    .map(([a, b]) => [Math.max(0, toSeconds(a)), Math.min(duration, toSeconds(b))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
};

// The parts of the video to analyse.
export const windowsFor = (mode, duration, ranges = '') => {
  if (mode === 'first_half') return [[0, duration / 2]];
  if (mode === 'second_half') return [[duration / 2, duration]];
  if (mode === 'ranges') return parseRanges(ranges, duration);
  return [[0, duration]]; // full, search
};

export const spanOf = (windows) => windows.reduce((acc, [a, b]) => acc + (b - a), 0);

// The times examined to find what changes: evenly spread over the windows.
export const candidateTimes = (windows, max = VIDEO_LIMITS.candidatesMax) => {
  const span = spanOf(windows);
  if (!span) return [];
  const step = Math.max(1, span / max);
  const times = [];
  windows.forEach(([a, b]) => {
    for (let t = a + Math.min(0.5, (b - a) / 2); t < b; t += step) times.push(Math.round(t * 100) / 100);
  });
  return times;
};

// How much the picture changed between two small colour thumbnails (RGB, 3 values per cell):
// 1 or more = a real change. Two signs: the whole picture changes (mean difference), or a
// part of it changes clearly (a text, a box, a subtitle appearing). Colour counts: two scenes
// may have the same brightness and different colours (measured on the test video).
export const difference = (a, b) => {
  if (!a || !b || a.length !== b.length) return 1;
  let sum = 0;
  let changedCells = 0;
  for (let i = 0; i < a.length; i += 3) {
    const cell = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    sum += cell;
    if (cell > 0.25 * 3 * 255) changedCells += 1;
  }
  const cells = a.length / 3;
  return Math.max(sum / (a.length * 255) / 0.05, changedCells / cells / 0.015);
};

// Adaptive choice: every scene change, at least one frame per `maxGap`, then at most `max` frames
// (the strongest changes kept, the first frame always kept).
export const chooseFrames = (candidates, { max, minGap = VIDEO_LIMITS.minGap, maxGap = VIDEO_LIMITS.maxGap, threshold = 1 }) => {
  const kept = [];
  candidates.forEach((frame) => {
    const last = kept[kept.length - 1];
    if (!last) { kept.push({ ...frame, change: 1, reason: 'début' }); return; }
    const change = difference(last.thumb, frame.thumb);
    const gap = frame.t - last.t;
    if (change >= threshold && gap >= Math.min(minGap, 1)) kept.push({ ...frame, change, reason: 'changement' });
    else if (gap >= maxGap) kept.push({ ...frame, change, reason: 'intervalle' });
  });
  if (kept.length <= max) return kept;
  const [first, ...rest] = kept;
  return [first, ...rest.sort((x, y) => y.change - x.change).slice(0, max - 1)].sort((x, y) => x.t - y.t);
};

// What was really covered: frames, largest unseen gap, speech.
export const coverageOf = ({ windows, frames, speech }) => {
  const times = frames.map((f) => f.t).sort((a, b) => a - b);
  let largestGap = 0;
  windows.forEach(([a, b]) => {
    const inside = [a, ...times.filter((t) => t >= a && t <= b), b];
    for (let i = 1; i < inside.length; i += 1) largestGap = Math.max(largestGap, inside[i] - inside[i - 1]);
  });
  return {
    windows: windows.map(([a, b]) => `${mmss(a)}–${mmss(b)}`),
    seconds: Math.round(spanOf(windows)),
    frames: frames.length,
    largestGap: Math.round(largestGap),
    speech: speech.status === 'ok'
      ? { status: 'ok', spokenSeconds: Math.round(speech.spokenSeconds), pieces: speech.pieces, segments: speech.segments.length }
      : { status: speech.status, reason: speech.reason },
  };
};

// "00:10 | ce qu'on voit | texte : ..." lines given back by the server, matched to their frames.
export const parseFrameLines = (text, times) => {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter((line) => /\|/.test(line));
  return times.map((t, i) => {
    const label = mmss(t);
    const line = lines.find((l) => l.replace(/\*/g, '').startsWith(label)) || lines[i] || '';
    const parts = line.replace(/\*/g, '').split('|').map((p) => p.trim());
    const seen = parts[1] || '';
    const written = (parts[2] || '').replace(/^texte\s*:\s*/i, '').trim();
    return { t, seen, text: /^aucun\.?$/i.test(written) ? '' : written };
  });
};

// The timeline given to the AI: images and speech in time order.
export const buildTimeline = ({ frames, segments }) => [
  ...frames.map((f) => ({ t: f.t, kind: 'IMAGE', line: `${f.seen}${f.text ? ` — texte à l'écran : « ${f.text} »` : ''}` })),
  ...segments.map((s) => ({ t: s.start, end: s.end, kind: 'PAROLE', line: s.text })),
].filter((item) => item.line).sort((a, b) => a.t - b.t || (a.kind === 'IMAGE' ? -1 : 1));

const plain = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Search mode: the moments where the words of the query are seen or heard.
export const searchTimeline = (timeline, query) => {
  const words = plain(query).split(/[^a-z0-9؀-ۿ]+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  return timeline.filter((item) => words.some((w) => plain(item.line).includes(w)));
};

export const timelineText = ({ name, duration, coverage, timeline, matches, query }) => {
  const head = [
    `Vidéo : ${name} (durée ${mmss(duration)}).`,
    `Couverture réelle : ${coverage.windows.join(', ')} — ${coverage.frames} images analysées (au plus ${coverage.largestGap} s sans image) ; `
    + (coverage.speech.status === 'ok'
      ? `paroles : ${coverage.speech.spokenSeconds} s de parole transcrite (${coverage.speech.segments} phrases).`
      : `paroles NON analysées (${coverage.speech.reason}).`),
  ];
  if (query) {
    head.push(matches.length
      ? `Recherche « ${query} » : trouvée à ${matches.map((m) => mmss(m.t)).join(', ')}.`
      : `Recherche « ${query} » : rien trouvé dans ce qui a été analysé.`);
  }
  return [...head, 'Chronologie :', ...timeline.map((item) => `[${mmss(item.t)}] ${item.kind} : ${item.line}`)].join('\n');
};

export const videoSummary = ({ name, coverage }) => `🎬 ${name} · ${coverage.windows.join(', ')} · ${coverage.frames} images`
  + (coverage.speech.status === 'ok' ? ` · ${coverage.speech.spokenSeconds} s de parole` : ' · audio non analysé');

// ---------- Browser parts (video element, canvas, audio) ----------

export const openVideo = (file) => new Promise((resolve, reject) => {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px';
  const url = URL.createObjectURL(file);
  video.onerror = () => { URL.revokeObjectURL(url); video.remove(); reject(new Error('Cette vidéo ne peut pas être lue par le navigateur.')); };
  video.onloadeddata = async () => {
    // Recorded WebM files often have no duration until the end is reached once.
    if (!Number.isFinite(video.duration)) {
      await new Promise((done) => { video.ondurationchange = () => Number.isFinite(video.duration) && done(); video.currentTime = 1e9; });
    }
    resolve({ video, url, duration: video.duration, width: video.videoWidth, height: video.videoHeight,
      close: () => { video.remove(); URL.revokeObjectURL(url); } });
  };
  video.src = url;
  document.body.appendChild(video);
});

// Seek and wait until the frame is really displayed (a "seeked" event alone may come too early).
export const seekTo = (video, t) => new Promise((resolve) => {
  let done = false;
  const finish = () => { if (!done) { done = true; resolve(); } };
  video.onseeked = () => {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => finish());
    setTimeout(finish, 400);
  };
  video.currentTime = t;
});

const THUMB_W = 32;
const THUMB_H = 18;

export const captureCandidates = async (video, times, { onProgress, shouldStop } = {}) => {
  const small = document.createElement('canvas');
  small.width = THUMB_W;
  small.height = THUMB_H;
  const sg = small.getContext('2d', { willReadFrequently: true });
  const big = document.createElement('canvas');
  big.width = VIDEO_LIMITS.cellWidth;
  big.height = Math.round(VIDEO_LIMITS.cellWidth * (video.videoHeight || 9) / (video.videoWidth || 16));
  const bg = big.getContext('2d');
  const out = [];
  for (let i = 0; i < times.length; i += 1) {
    if (shouldStop?.()) break;
    // eslint-disable-next-line no-await-in-loop
    await seekTo(video, times[i]);
    sg.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    const rgba = sg.getImageData(0, 0, THUMB_W, THUMB_H).data;
    const thumb = new Uint8Array(THUMB_W * THUMB_H * 3);
    for (let p = 0; p < THUMB_W * THUMB_H; p += 1) {
      thumb[p * 3] = rgba[p * 4];
      thumb[p * 3 + 1] = rgba[p * 4 + 1];
      thumb[p * 3 + 2] = rgba[p * 4 + 2];
    }
    bg.drawImage(video, 0, 0, big.width, big.height); // ~40 KB each: 240 at most stay a few MB
    out.push({ t: times[i], thumb, image: big.toDataURL('image/jpeg', 0.85) });
    onProgress?.(i + 1, times.length);
  }
  return out;
};

// 4 frames in one picture (2 x 2), each labelled with its time.
export const composeGrids = async (frames, perGrid = VIDEO_LIMITS.framesPerGrid) => {
  const grids = [];
  for (let i = 0; i < frames.length; i += perGrid) {
    const group = frames.slice(i, i + perGrid);
    // eslint-disable-next-line no-await-in-loop
    const images = await Promise.all(group.map((f) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = f.image;
    })));
    const cw = images[0].naturalWidth;
    const ch = images[0].naturalHeight;
    const cols = group.length > 1 ? 2 : 1;
    const rows = Math.ceil(group.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = cols * cw;
    canvas.height = rows * ch;
    const g = canvas.getContext('2d');
    images.forEach((img, k) => {
      const x = (k % cols) * cw;
      const y = Math.floor(k / cols) * ch;
      g.drawImage(img, x, y, cw, ch);
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(x, y, 118, 40);
      g.fillStyle = '#fff';
      g.font = 'bold 26px Arial, sans-serif';
      g.fillText(mmss(group[k].t), x + 10, y + 29);
    });
    grids.push({ times: group.map((f) => f.t), image: canvas.toDataURL('image/webp', 0.85).split(',')[1] });
  }
  return grids;
};

// ---------- Speech: decoded in the browser, only the spoken parts are sent ----------

export const findSpeech = (samples, rate, windows, { frame = 0.03, pad = 0.3, join = 0.6, maxPiece = VIDEO_LIMITS.speechMaxSeconds } = {}) => {
  const size = Math.round(frame * rate);
  const energies = [];
  for (let i = 0; i + size <= samples.length; i += size) {
    let sum = 0;
    for (let k = i; k < i + size; k += 1) sum += samples[k] * samples[k];
    energies.push(Math.sqrt(sum / size));
  }
  const sorted = [...energies].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const threshold = Math.max(0.01, floor * 3);
  const regions = [];
  energies.forEach((e, i) => {
    if (e < threshold) return;
    const t = i * frame;
    const last = regions[regions.length - 1];
    if (last && t - last[1] <= join) last[1] = t + frame;
    else regions.push([t, t + frame]);
  });
  const inside = (a, b) => windows.map(([wa, wb]) => [Math.max(a, wa), Math.min(b, wb)]).filter(([x, y]) => y - x > 0.2);
  const pieces = [];
  regions.map(([a, b]) => [Math.max(0, a - pad), b + pad]).flatMap(([a, b]) => inside(a, b)).forEach(([a, b]) => {
    const last = pieces[pieces.length - 1];
    if (last && a - last[1] <= join && b - last[0] <= maxPiece) last[1] = b;
    else for (let x = a; x < b; x += maxPiece) pieces.push([x, Math.min(b, x + maxPiece)]);
  });
  return pieces;
};

export const wavBase64 = (samples, rate, start, end) => {
  const from = Math.floor(start * rate);
  const to = Math.min(samples.length, Math.ceil(end * rate));
  const count = Math.max(0, to - from);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i += 1) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[from + i])) * 0x7fff, true);
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// The whole audio track at 16 kHz mono (null + reason when it cannot be done here).
export const decodeSpeechTrack = async (file, duration) => {
  if (duration > VIDEO_LIMITS.audioMaxMinutes * 60) {
    return { samples: null, reason: `vidéo de plus de ${VIDEO_LIMITS.audioMaxMinutes} min : audio trop long pour le navigateur (les images restent analysées)` };
  }
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return { samples: null, reason: 'audio non pris en charge par ce navigateur' };
  let decoded;
  try {
    // Decoded straight at 16 kHz (the rate of the context): ~4 MB per minute and channel.
    decoded = await new Ctx(1, 16000, 16000).decodeAudioData(await file.arrayBuffer());
  } catch (error) {
    return { samples: null, reason: error?.name === 'RangeError' || /memory/i.test(error?.message || '')
      ? 'audio trop long pour la mémoire de ce navigateur (les images restent analysées)'
      : 'pas de piste audio lisible dans cette vidéo' };
  }
  if (decoded.numberOfChannels === 1) return { samples: decoded.getChannelData(0), rate: decoded.sampleRate };
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c += 1) {
    const channel = decoded.getChannelData(c);
    for (let i = 0; i < mono.length; i += 1) mono[i] += channel[i] / decoded.numberOfChannels;
  }
  return { samples: mono, rate: decoded.sampleRate };
};
