import {
  buildTimeline, candidateTimes, chooseFrames, coverageOf, difference, findSpeech, mmss, parseFrameLines, parseRanges,
  searchTimeline, timelineText, videoSummary, wavBase64, windowsFor,
} from './videoAnalysis';

const thumb = (value) => new Uint8Array(32 * 18 * 3).fill(value);
const colour = ([r, g, b], box) => {
  const t = new Uint8Array(32 * 18 * 3);
  for (let i = 0; i < 32 * 18; i += 1) {
    const x = i % 32;
    const y = Math.floor(i / 32);
    const inBox = box && x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3];
    t[i * 3] = inBox ? 220 : r; t[i * 3 + 1] = inBox ? 38 : g; t[i * 3 + 2] = inBox ? 38 : b;
  }
  return t;
};

describe('videoAnalysis', () => {
  test('horaires et plages', () => {
    expect(mmss(0)).toBe('00:00');
    expect(mmss(85.9)).toBe('01:25');
    expect(mmss(3725)).toBe('1:02:05');
    expect(parseRanges('1:00-2:30, 5:10 – 6:00 ; 80-90', 400)).toEqual([[60, 150], [80, 90], [310, 360]]);
    expect(parseRanges('n’importe quoi', 400)).toEqual([]);
    expect(windowsFor('first_half', 90)).toEqual([[0, 45]]);
    expect(windowsFor('second_half', 90)).toEqual([[45, 90]]);
    expect(windowsFor('ranges', 90, '0:10-0:20, 200-300')).toEqual([[10, 20], [200, 90]].filter(([a, b]) => b > a));
    expect(windowsFor('search', 90)).toEqual([[0, 90]]);
  });

  test('les instants examinés couvrent toute la partie choisie', () => {
    const times = candidateTimes([[0, 90]], 240);
    expect(times[0]).toBe(0.5);
    expect(times.length).toBe(90);
    expect(Math.max(...times)).toBeLessThan(90);
    const long = candidateTimes([[0, 3600]], 240);
    expect(long.length).toBe(240);
  });

  test('choix adaptatif : chaque changement de scène, une image au moins toutes les 30 s, pas plus que le maximum', () => {
    const candidates = [];
    for (let t = 0; t < 90; t += 1) candidates.push({ t, thumb: thumb(t < 15 ? 40 : t < 30 ? 120 : t < 80 ? 200 : 60), image: `i${t}` });
    const kept = chooseFrames(candidates, { max: 32 });
    expect(kept.map((f) => f.t)).toEqual([0, 15, 30, 60, 80]);
    expect(kept.map((f) => f.reason)).toEqual(['début', 'changement', 'changement', 'intervalle', 'changement']);
    expect(chooseFrames(candidates, { max: 3 })).toHaveLength(3); // the strongest changes kept
    expect(chooseFrames(candidates, { max: 3 })[0].t).toBe(0);
  });

  test('changements vus comme sur la vidéo de test : couleur seule, petit encadré ; pas le petit mouvement', () => {
    const blue = colour([29, 83, 205]);
    const green = colour([0, 107, 85]); // about the same brightness as the blue
    expect(difference(blue, green)).toBeGreaterThanOrEqual(1);
    expect(difference(colour([15, 118, 110]), colour([15, 118, 110], [20, 11, 10, 2]))).toBeGreaterThanOrEqual(1); // "Code secret" box
    expect(difference(blue, colour([29, 83, 205], [5, 15, 1, 1]))).toBeLessThan(1); // the little moving dot
    expect(difference(blue, blue)).toBe(0);
  });

  test('la parole est trouvée, le silence n’est pas envoyé', () => {
    const rate = 1000;
    const samples = new Float32Array(90 * rate);
    const speak = (a, b) => { for (let i = a * rate; i < b * rate; i += 1) samples[i] = Math.sin(i) * 0.3; };
    speak(1, 5); speak(16, 20); speak(76, 82);
    const pieces = findSpeech(samples, rate, [[0, 90]]);
    expect(pieces.length).toBe(3);
    expect(pieces[0][0]).toBeGreaterThanOrEqual(0.6);
    expect(pieces[0][1]).toBeLessThanOrEqual(5.4);
    const spoken = pieces.reduce((acc, [a, b]) => acc + b - a, 0);
    expect(spoken).toBeLessThan(18); // 14 s spoken (+ small margins), not 90
    expect(findSpeech(samples, rate, [[0, 45]]).length).toBe(2); // only inside the chosen part
    speak(30, 70); // 40 s non-stop: cut into pieces of 28 s at most
    expect(findSpeech(samples, rate, [[25, 75]]).every(([a, b]) => b - a <= 28.01)).toBe(true);
  });

  test('WAV valide de 16 bits', () => {
    const b64 = wavBase64(new Float32Array(16000).fill(0.5), 16000, 0, 0.5);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(bytes.length).toBe(44 + 8000 * 2);
  });

  test('lignes d’images, chronologie, recherche, couverture', () => {
    const frames = parseFrameLines('**00:00** | titre bleu | texte : Leçon\n00:15 | écran vert | texte : aucun\n01:22 | encadré rouge | texte : Code secret : 4817', [0, 15, 82]);
    expect(frames).toEqual([
      { t: 0, seen: 'titre bleu', text: 'Leçon' }, { t: 15, seen: 'écran vert', text: '' }, { t: 82, seen: 'encadré rouge', text: 'Code secret : 4817' },
    ]);
    const segments = [{ start: 78.5, end: 81, text: 'Le mot-clé de cette vidéo est Olivier.' }];
    const timeline = buildTimeline({ frames, segments });
    expect(timeline.map((i) => `${mmss(i.t)} ${i.kind}`)).toEqual(['00:00 IMAGE', '00:15 IMAGE', '01:18 PAROLE', '01:22 IMAGE']);
    expect(searchTimeline(timeline, 'olivier').map((i) => i.kind)).toEqual(['PAROLE']);
    expect(searchTimeline(timeline, 'le code 4817').map((i) => mmss(i.t))).toEqual(['01:22']);
    const coverage = coverageOf({ windows: [[0, 90]], frames, speech: { status: 'ok', spokenSeconds: 21.4, pieces: 6, segments } });
    expect(coverage).toEqual({ windows: ['00:00–01:30'], seconds: 90, frames: 3, largestGap: 67,
      speech: { status: 'ok', spokenSeconds: 21, pieces: 6, segments: 1 } });
    const text = timelineText({ name: 'lecon.webm', duration: 90, coverage, timeline, matches: searchTimeline(timeline, 'olivier'), query: 'olivier' });
    expect(text).toContain('Couverture réelle : 00:00–01:30 — 3 images analysées (au plus 67 s sans image)');
    expect(text).toContain('Recherche « olivier » : trouvée à 01:18.');
    expect(text).toContain("[01:22] IMAGE : encadré rouge — texte à l'écran : « Code secret : 4817 »");
    expect(videoSummary({ name: 'lecon.webm', coverage })).toBe('🎬 lecon.webm · 00:00–01:30 · 3 images · 21 s de parole');
  });

  test('audio non analysé : dit clairement', () => {
    const coverage = coverageOf({ windows: [[0, 90]], frames: [], speech: { status: 'skipped', reason: 'pas de piste audio lisible dans cette vidéo' } });
    expect(timelineText({ name: 'v', duration: 90, coverage, timeline: [], matches: [] })).toContain('paroles NON analysées (pas de piste audio lisible dans cette vidéo)');
  });
});
