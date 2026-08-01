// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RecoveryPanel from './RecoveryPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const checkpoint = {
  id: '12345678-1234-1234-1234-123456789abc',
  projectId: 'project-1',
  projectName: 'project',
  type: 'project' as const,
  trigger: 'important_change' as const,
  reason: 'Avant une modification importante',
  createdAt: '2026-07-29T12:00:00.000Z',
  size: 1024,
  hasConversation: true,
  hasTaskSettings: true
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RecoveryPanel', () => {
  it('offers selective restoration and configurable retention', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRestoreCheckpoint = vi.fn().mockResolvedValue(undefined);
    const onUpdateRetention = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <RecoveryPanel
          checkpoints={[checkpoint]}
          retention={{ maxPerProject: 30, minimum: 5, maximum: 100 }}
          trash={[]}
          recoverableTasks={[]}
          busy={false}
          emergencyShortcut="CommandOrControl+Shift+Escape"
          onClose={vi.fn()}
          onCreateCheckpoint={vi.fn()}
          onRestoreCheckpoint={onRestoreCheckpoint}
          onUpdateRetention={onUpdateRetention}
          onRestoreTrash={vi.fn()}
          onInspectTask={vi.fn()}
          onResumeTask={vi.fn()}
          onDiscardTask={vi.fn()}
          onSaveEmergencyShortcut={vi.fn()}
        />
      );
    });

    const select = container.querySelector(
      'select[aria-label^="Portée de restauration"]'
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(container.textContent).toContain('Conversation');
    expect(container.textContent).toContain('Réglages de tâche');

    await act(async () => {
      select.value = 'conversation';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const restore = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Restaurer')
    );
    await act(async () => {
      restore?.click();
    });
    expect(onRestoreCheckpoint).toHaveBeenCalledWith(checkpoint.id, 'conversation');

    const retention = container.querySelector('#checkpoint-retention') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set?.call(retention, '12');
      retention.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const retentionForm = retention.closest('form') as HTMLFormElement;
    await act(async () => {
      retentionForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }));
    });
    expect(onUpdateRetention).toHaveBeenCalledWith(12);

    await act(async () => {
      root.unmount();
    });
  });
});
