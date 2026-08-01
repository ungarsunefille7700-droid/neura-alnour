// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NeuraCoControlledMemoryState } from '../electron/ipc-contract';
import ControlledMemoryPanel from './ControlledMemoryPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state: NeuraCoControlledMemoryState = {
  enabled: true,
  entries: [],
  activeCount: 0,
  pendingCount: 0,
  projectInstructions: {
    found: true,
    path: 'C:\\projet\\NEURACO.md',
    contentPreview: '# Règles\nToujours lancer les tests.',
    size: 42,
    modifiedAt: '2026-07-29T12:00:00.000Z',
    warnings: []
  },
  sessionMemory: {
    threadId: 'thread-1',
    title: 'Corriger la mémoire',
    messageCount: 6,
    updatedAt: '2026-07-29T12:00:00.000Z'
  }
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ControlledMemoryPanel', () => {
  it('shows user, project and session memory controls without mixing scopes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ControlledMemoryPanel
          state={state}
          busy={false}
          onStateChange={vi.fn()}
          onBusyChange={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Mémoire de session');
    expect(container.textContent).toContain('Corriger la mémoire');
    expect(container.textContent).toContain('Instructions du projet');
    expect(container.textContent).toContain('NEURACO.md détecté');
    expect(container.textContent).toContain('Mémoires approuvées');
    expect(container.textContent).toContain('Aucune mémoire approuvée');

    await act(async () => {
      root.unmount();
    });
  });
});
