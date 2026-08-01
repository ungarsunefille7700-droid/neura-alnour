const SECRET_ASSIGNMENT =
  /\b(api[_-]?key|token|password|passwd|secret|authorization)\b(\s*[:=]\s*)([^\s,;]+)/gi;
const SECRET_TOKEN = /\b(?:sk|ghp|rnd|vcp|tvly)[_-][A-Za-z0-9_-]{12,}\b/gi;

export const redactSecrets = (value: string): string => value
  .replace(SECRET_ASSIGNMENT, '$1$2[MASQUÉ]')
  .replace(SECRET_TOKEN, '[MASQUÉ]');
