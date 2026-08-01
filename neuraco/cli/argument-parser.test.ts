import { describe, expect, it } from 'vitest';
import { parseCliArguments } from './argument-parser';

describe('parseCliArguments', () => {
  it('parses a non-interactive run with explicit safe options', () => {
    expect(parseCliArguments([
      'run',
      'Corriger les tests',
      '--model',
      'gpt-4o',
      '--agent',
      'reviewer',
      '--budget',
      '12',
      '--attach',
      'src/App.tsx',
      '--cloud',
      '--non-interactive',
      '--json'
    ])).toMatchObject({
      command: 'run',
      positionals: ['Corriger les tests'],
      model: 'gpt-4o',
      agent: 'reviewer',
      budget: 12,
      attachments: ['src/App.tsx'],
      executionMode: 'cloud',
      nonInteractive: true,
      json: true
    });
  });

  it('defaults to interactive chat', () => {
    expect(parseCliArguments([])).toMatchObject({
      command: 'chat',
      model: 'auto',
      readOnly: false,
      automatic: false
    });
  });

  it('rejects unknown models and conflicting permission modes', () => {
    expect(() => parseCliArguments(['run', 'test', '--model', 'invented']))
      .toThrow('Modèle');
    expect(() => parseCliArguments(['run', 'test', '--read-only', '--auto']))
      .toThrow('combinés');
  });
});
