// Browser speech helpers shared by the language tutor and its tests.
export function speechLang(code) {
  const map = {
    ary: 'ar-MA', arq: 'ar-DZ', aeb: 'ar-TN', 'ar-MA': 'ar-MA', 'ar-TN': 'ar-TN',
    kab: 'kab-DZ', shy: 'shy-DZ', cnu: 'cnu-DZ', mzb: 'mzb-DZ', thv: 'thv-DZ', 'ber-DZ': 'ber-DZ',
    rif: 'rif-MA', shi: 'shi-MA', zgh: 'zgh-MA', tzm: 'tzm-MA', ber: 'ber-MA', jbn: 'jbn-TN',
    ar: 'ar-SA', en: 'en-US', fr: 'fr-FR', zh: 'zh-CN', pt: 'pt-PT',
  };
  return map[code] || code;
}

export function selectBestVoice(voices, locale) {
  const target = locale.toLowerCase();
  const language = target.split('-')[0];
  const qualityPattern = /natural|neural|enhanced|premium|online|google|microsoft|siri/i;
  return voices
    .filter((voice) => voice.lang && voice.lang.toLowerCase().split('-')[0] === language)
    .sort((a, b) => {
      const score = (voice) => {
        const voiceLang = voice.lang.toLowerCase();
        return (voiceLang === target ? 100 : 0)
          + (qualityPattern.test(voice.name) ? 25 : 0)
          + (!voice.localService ? 10 : 0)
          + (voice.default ? 5 : 0);
      };
      return score(b) - score(a);
    })[0];
}

export function speechChunks(text, maxLength = 220) {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?\u3002\uFF01\uFF1F]+[.!?\u3002\uFF01\uFF1F]?/g) || [clean];
  const chunks = [];
  let current = '';
  sentences.forEach((sentence) => {
    const next = `${current} ${sentence.trim()}`.trim();
    if (current && next.length > maxLength) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}
