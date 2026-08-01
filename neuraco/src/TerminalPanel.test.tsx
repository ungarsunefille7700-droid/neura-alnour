import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoDesktopApi,
  NeuraCoTerminalEvent
} from '../electron/ipc-contract';
import TerminalPanel from './TerminalPanel';

const setValue = (control: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('TerminalPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let listener: ((event: NeuraCoTerminalEvent) => void) | undefined;
  let api: Partial<NeuraCoDesktopApi>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    api = {
      listTerminalProfiles: vi.fn().mockResolvedValue([
        {
          id: 'cmd',
          label: 'Invite de commandes',
          available: true,
          detail: 'cmd.exe',
          requiresTarget: false
        },
        {
          id: 'powershell',
          label: 'PowerShell',
          available: true,
          detail: 'powershell.exe',
          requiresTarget: false
        }
      ]),
      assessTerminalCommand: vi.fn().mockResolvedValue({
        level: 'safe',
        label: 'Niveau sûr',
        reason: 'Commande de test.',
        requiresExplicitConfirmation: false
      }),
      startTerminalCommand: vi.fn().mockResolvedValue({
        accepted: true,
        commandId: 'command-1'
      }),
      cancelTerminalCommand: vi.fn().mockResolvedValue(true),
      onTerminalEvent: vi.fn((next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      })
    };
    window.neuraco = api as NeuraCoDesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.neuraco;
  });

  it('isolates tab output, searches it and recalls command history', async () => {
    await act(async () => {
      root.render(
        <TerminalPanel
          projectRoot="C:\\projects\\portal"
          emergencyStopped={false}
          onStatus={vi.fn()}
          onOpenBrowser={vi.fn()}
        />
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '.terminal-tabs > button'
      )?.click();
    });
    expect(container.querySelectorAll('.terminal-tabs > div')).toHaveLength(2);

    const activeTab = container.querySelector('.terminal-tabs > div.is-active');
    const activeTabButton = activeTab?.querySelector<HTMLButtonElement>('button');
    expect(activeTabButton).toBeTruthy();

    const command = container.querySelector<HTMLInputElement>(
      'input[aria-label="Commande terminal"]'
    )!;
    await act(async () => setValue(command, 'npm test'));
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Exécuter')
      )?.click();
      await Promise.resolve();
    });

    const request = vi.mocked(api.startTerminalCommand!).mock.calls[0][0];
    expect(request.command).toBe('npm test');
    expect(request.terminalId).toBeTruthy();

    await act(async () => {
      listener?.({
        commandId: 'command-1',
        terminalId: request.terminalId,
        profileId: request.profileId,
        type: 'stdout',
        chunk: 'Tests passed successfully\n'
      });
      listener?.({
        commandId: 'command-1',
        terminalId: request.terminalId,
        profileId: request.profileId,
        type: 'completed',
        exitCode: 0,
        durationMs: 50
      });
    });
    expect(container.textContent).toContain('Tests passed successfully');

    const search = container.querySelector<HTMLInputElement>(
      'input[placeholder="Rechercher dans la sortie"]'
    )!;
    await act(async () => setValue(search, 'passed'));
    expect(container.querySelector('mark')?.textContent).toBe('passed');

    await act(async () => {
      command.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true
      }));
    });
    expect(command.value).toBe('npm test');

    const firstTabButton = container.querySelector<HTMLButtonElement>(
      '.terminal-tabs > div:first-child > button:first-child'
    );
    await act(async () => firstTabButton?.click());
    expect(container.textContent).not.toContain('Tests passed successfully');
  });
});
