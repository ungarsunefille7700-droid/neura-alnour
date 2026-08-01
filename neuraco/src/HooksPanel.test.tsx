// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoDesktopApi,
  NeuraCoHooksState
} from '../electron/ipc-contract';
import HooksPanel from './HooksPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state: NeuraCoHooksState = {
  securityHookCount: 2,
  activeCustomHookCount: 1,
  hooks: [
    {
      id: 'security-secret-protection',
      name: 'Protection obligatoire des secrets',
      event: 'before_instruction',
      action: 'block_pattern',
      pattern: '[detection interne]',
      failureMode: 'block',
      enabled: true,
      security: true,
      immutable: true,
      createdAt: '2026-07-29T12:00:00.000Z',
      updatedAt: '2026-07-29T12:00:00.000Z'
    },
    {
      id: 'format-after-edit',
      name: 'Formatter apres modification',
      event: 'after_modification',
      action: 'command',
      command: 'npm',
      args: ['run', 'format'],
      timeoutMs: 30_000,
      failureMode: 'warn',
      enabled: true,
      security: false,
      immutable: false,
      createdAt: '2026-07-29T12:00:00.000Z',
      updatedAt: '2026-07-29T12:00:00.000Z'
    }
  ],
  recentRuns: [{
    id: 'run-1',
    hookId: 'format-after-edit',
    hookName: 'Formatter apres modification',
    event: 'after_modification',
    status: 'passed',
    summary: 'Commande du hook terminee avec succes.',
    durationMs: 42,
    createdAt: '2026-07-29T12:01:00.000Z'
  }]
};

afterEach(() => {
  document.body.innerHTML = '';
  delete window.neuraco;
});

describe('HooksPanel', () => {
  it('keeps security hooks immutable and controls custom hooks', async () => {
    const setHookEnabled = vi.fn().mockResolvedValue({
      ...state,
      activeCustomHookCount: 0,
      hooks: state.hooks.map((hook) => (
        hook.id === 'format-after-edit' ? { ...hook, enabled: false } : hook
      ))
    });
    window.neuraco = {
      getHooksState: vi.fn().mockResolvedValue(state),
      setHookEnabled
    } as unknown as NeuraCoDesktopApi;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<HooksPanel emergencyStopped={false} onStatus={vi.fn()} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const entries = Array.from(container.querySelectorAll<HTMLElement>('.hook-entry'));
    const systemEntry = entries.find((entry) => (
      entry.textContent?.includes('Protection obligatoire des secrets')
    ));
    const customEntry = entries.find((entry) => (
      entry.textContent?.includes('Formatter apres modification')
    ));
    expect(systemEntry?.textContent).toContain('Obligatoire');
    expect(systemEntry?.textContent).toContain('Non modifiable');
    expect(systemEntry?.querySelector('button')).toBeNull();
    expect(customEntry?.textContent).toContain('Actif');
    expect(container.textContent).toContain('Commande du hook');
    expect(container.textContent).toContain('42 ms');

    const disableButton = Array.from(
      customEntry!.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent?.toLowerCase().includes('sactiver'));
    expect(disableButton).toBeDefined();
    await act(async () => {
      disableButton!.click();
      await Promise.resolve();
    });
    expect(setHookEnabled).toHaveBeenCalledWith('format-after-edit', false);

    await act(async () => root.unmount());
  });
});
