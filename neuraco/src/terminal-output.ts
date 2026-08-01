export interface TerminalOutputToken {
  text: string;
  color?: string;
  bold: boolean;
  url?: string;
}

const ANSI_PATTERN = /\u001b\[([0-9;]*)m/g;
const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/gi;
const COLOR_CODES: Record<number, string> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
  90: 'bright-black',
  91: 'bright-red',
  92: 'bright-green',
  93: 'bright-yellow',
  94: 'bright-blue',
  95: 'bright-magenta',
  96: 'bright-cyan',
  97: 'bright-white'
};

export const stripTerminalAnsi = (value: string): string => (
  String(value || '').replace(ANSI_PATTERN, '')
);

const textTokens = (
  value: string,
  color: string | undefined,
  bold: boolean
): TerminalOutputToken[] => (
  value.split(URL_PATTERN).filter(Boolean).map((text) => ({
    text,
    color,
    bold,
    url: /^https?:\/\//i.test(text) ? text.replace(/[),.;]+$/, '') : undefined
  }))
);

export const tokenizeTerminalOutput = (value: string): TerminalOutputToken[] => {
  const tokens: TerminalOutputToken[] = [];
  let color: string | undefined;
  let bold = false;
  let cursor = 0;
  ANSI_PATTERN.lastIndex = 0;
  for (const match of String(value || '').matchAll(ANSI_PATTERN)) {
    const index = match.index || 0;
    tokens.push(...textTokens(value.slice(cursor, index), color, bold));
    const codes = (match[1] || '0').split(';').map((code) => Number(code || 0));
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        color = undefined;
      } else if (COLOR_CODES[code]) {
        color = COLOR_CODES[code];
      }
    }
    cursor = index + match[0].length;
  }
  tokens.push(...textTokens(value.slice(cursor), color, bold));
  return tokens;
};
