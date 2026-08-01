import { describe, expect, it } from 'vitest';
import { stripTerminalAnsi, tokenizeTerminalOutput } from './terminal-output';

describe('terminal output parser', () => {
  it('parses ANSI colors as data without producing HTML', () => {
    const tokens = tokenizeTerminalOutput(
      '\u001b[31mError\u001b[0m then \u001b[1;32mok\u001b[0m'
    );
    expect(tokens).toEqual([
      { text: 'Error', color: 'red', bold: false, url: undefined },
      { text: ' then ', color: undefined, bold: false, url: undefined },
      { text: 'ok', color: 'green', bold: true, url: undefined }
    ]);
    expect(stripTerminalAnsi('\u001b[31mError\u001b[0m')).toBe('Error');
  });

  it('recognizes only HTTP links and keeps surrounding output as text', () => {
    const tokens = tokenizeTerminalOutput(
      'Ready at https://localhost:5173/path.\nfile://secret'
    );
    expect(tokens.find((token) => token.url)?.url).toBe('https://localhost:5173/path');
    expect(tokens.map((token) => token.text).join('')).toContain('file://secret');
  });
});
