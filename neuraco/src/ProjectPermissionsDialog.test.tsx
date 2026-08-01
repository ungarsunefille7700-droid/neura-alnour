import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeuraCoProjectPermissions } from '../electron/ipc-contract';
import ProjectPermissionsDialog from './ProjectPermissionsDialog';

const permissions: NeuraCoProjectPermissions = {
  projectId: 'project-1',
  projectRoot: 'C:\\projects\\sample',
  configured: true,
  mode: 'manual',
  allowedActions: ['read_file', 'terminal'],
  allowedFolders: ['C:\\projects\\sample'],
  readOnlyFolders: ['C:\\projects\\sample\\docs'],
  writableFolders: ['C:\\projects\\sample\\src'],
  forbiddenPaths: ['C:\\projects\\sample\\private'],
  allowedCommandPrefixes: ['npm test'],
  allowedDomains: ['docs.example.com'],
  networkAccessMode: 'approved_domains',
  allowedApplications: ['Visual Studio Code'],
  alwaysAllowedSignatures: [],
  updatedAt: '2026-07-28T00:00:00.000Z'
};

describe('ProjectPermissionsDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows the six permission modes and saves the selected behavior', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <ProjectPermissionsDialog
          permissions={permissions}
          busy={false}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );
    });

    const modeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.permission-modes > button')
    );
    expect(modeButtons).toHaveLength(6);
    expect(modeButtons.map((button) => button.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Plan / lecture seule'),
        expect.stringContaining('Manuel'),
        expect.stringContaining('Accepter les modifications'),
        expect.stringContaining('Automatique sécurisé'),
        expect.stringContaining('Ne pas demander'),
        expect.stringContaining('Accès complet')
      ])
    );

    const denyMode = modeButtons.find(
      (button) => button.textContent?.includes('Ne pas demander')
    );
    await act(async () => denyMode?.click());
    expect(container.textContent).toContain('refusée et journalisée');
    expect(container.textContent).toContain('Domaines Internet autorisés');
    expect(container.textContent).toContain('Dossiers en lecture seule');
    expect(container.textContent).toContain('Dossiers modifiables');
    expect(container.textContent).toContain('Chemins interdits');
    expect(container.textContent).toContain('Aucun accès');
    expect(container.textContent).toContain('Domaines approuvés uniquement');
    expect(container.textContent).toContain('Demander pour chaque nouveau domaine');
    expect(container.textContent).toContain('Accès complet temporaire');

    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Enregistrer ce mode')
    );
    await act(async () => save?.click());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'deny_unapproved',
      allowedActions: ['read_file', 'terminal'],
      allowedCommandPrefixes: ['npm test'],
      allowedDomains: ['docs.example.com'],
      networkAccessMode: 'approved_domains',
      allowedApplications: ['Visual Studio Code'],
      readOnlyFolders: ['C:\\projects\\sample\\docs'],
      writableFolders: ['C:\\projects\\sample\\src'],
      forbiddenPaths: ['C:\\projects\\sample\\private']
    }));
  });

  it('requires both full-access confirmations before enabling activation', async () => {
    await act(async () => {
      root.render(
        <ProjectPermissionsDialog
          permissions={permissions}
          busy={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      );
    });
    const fullMode = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.permission-modes > button')
    ).find((button) => button.textContent?.includes('Accès complet'));
    await act(async () => fullMode?.click());

    const activation = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Activer l’accès complet')
    );
    expect(activation?.disabled).toBe(true);
    expect(container.textContent).toContain('ATTENTION — ACCÈS COMPLET À VOTRE ORDINATEUR');
  });

  it('creates a bounded temporary network grant from the existing dialog', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <ProjectPermissionsDialog
          permissions={permissions}
          busy={false}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );
    });

    const temporary = container.querySelector<HTMLInputElement>(
      'input[name="network-access-mode"][value="temporary_full"]'
    );
    await act(async () => temporary?.click());
    const duration = container.querySelector<HTMLSelectElement>(
      '.permission-network-scope select'
    );
    expect(duration?.value).toBe('30');

    const before = Date.now();
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Enregistrer ce mode')
    );
    await act(async () => save?.click());
    const request = onSave.mock.calls[0]?.[0];
    expect(request.networkAccessMode).toBe('temporary_full');
    const expiry = Date.parse(request.temporaryFullNetworkUntil);
    expect(expiry).toBeGreaterThanOrEqual(before + 29 * 60_000);
    expect(expiry).toBeLessThanOrEqual(before + 31 * 60_000);
  });
});
