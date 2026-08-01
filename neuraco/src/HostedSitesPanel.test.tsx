import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoDesktopApi,
  NeuraCoHostedSiteDeployment,
  NeuraCoHostedSitePreview
} from '../electron/ipc-contract';
import HostedSitesPanel from './HostedSitesPanel';

const preview: NeuraCoHostedSitePreview = {
  id: 'preview-1',
  projectId: 'project-1',
  name: 'Portail client',
  slug: 'portail-client',
  kind: 'dashboard',
  sourceDirectory: 'dist',
  visibility: 'public',
  files: [
    { relativePath: 'assets/app.js', size: 1200 },
    { relativePath: 'index.html', size: 400 }
  ],
  totalBytes: 1600,
  plannedAddress: 'https://portail-client.vercel.app',
  plannedAddressIsEstimate: true,
  environmentVariables: ['PUBLIC_API_URL'],
  estimatedCredits: 0,
  hostingDurationDays: 30,
  hostingDurationLabel: '30 jours',
  authorizedPeople: ['Tout le monde (site public)'],
  framework: 'Vite',
  provider: 'vercel',
  createdAt: '2026-07-29T10:00:00.000Z',
  expiresAt: '2026-07-29T10:30:00.000Z'
};

const deployment: NeuraCoHostedSiteDeployment = {
  id: 'deployment-1',
  projectId: preview.projectId,
  name: preview.name,
  kind: preview.kind,
  sourceDirectory: preview.sourceDirectory,
  visibility: 'public',
  provider: 'vercel',
  address: 'https://portail-client-live.vercel.app',
  deployedAt: '2026-07-29T10:10:00.000Z',
  files: preview.files,
  totalBytes: preview.totalBytes,
  environmentVariables: preview.environmentVariables,
  estimatedCredits: 0,
  hostingDurationDays: 30,
  hostingDurationLabel: '30 jours',
  authorizedPeople: preview.authorizedPeople
};

const setValue = (
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) => {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event(
    control instanceof HTMLSelectElement ? 'change' : 'input',
    { bubbles: true }
  ));
};

describe('HostedSitesPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: Partial<NeuraCoDesktopApi>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    api = {
      listHostedSiteDeployments: vi.fn().mockResolvedValue([]),
      getHostedSiteProviderStatus: vi.fn().mockResolvedValue({
        provider: 'vercel',
        available: true,
        version: '54.15.0'
      }),
      previewHostedSite: vi.fn().mockResolvedValue(preview),
      startHostedSitePreview: vi.fn().mockResolvedValue({
        previewId: preview.id,
        address: 'http://127.0.0.1:43125/',
        startedAt: '2026-07-29T10:05:00.000Z'
      }),
      stopHostedSitePreview: vi.fn().mockResolvedValue(true),
      deployHostedSite: vi.fn().mockResolvedValue(deployment)
    };
    window.neuraco = api as NeuraCoDesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.neuraco;
  });

  it('shows the reviewed files and uses server results for preview and deployment', async () => {
    const onOpenPreview = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <HostedSitesPanel
          emergencyStopped={false}
          onOpenPreview={onOpenPreview}
          onStatus={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    const inputs = container.querySelectorAll('input');
    const selects = container.querySelectorAll('select');
    const textareas = container.querySelectorAll('textarea');
    await act(async () => {
      setValue(inputs[0], 'Portail client');
      setValue(inputs[1], 'dist');
      setValue(selects[0], 'dashboard');
      setValue(selects[1], '30');
      setValue(textareas[0], 'PUBLIC_API_URL');
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Publication publique')
      )?.click();
    });

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Analyser les fichiers')
      )?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.previewHostedSite).toHaveBeenCalledWith({
      name: 'Portail client',
      kind: 'dashboard',
      sourceDirectory: 'dist',
      visibility: 'public',
      environmentVariables: ['PUBLIC_API_URL'],
      authorizedPeople: [],
      hostingDurationDays: 30
    });
    expect(container.textContent).toContain('https://portail-client.vercel.app');
    expect(container.textContent).toContain('assets/app.js');
    expect(container.textContent).toContain('Tout le monde (site public)');
    expect(container.textContent).toContain('0 crédit IA estimé');

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Tester localement')
      )?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.startHostedSitePreview).toHaveBeenCalledWith(preview.id);
    expect(onOpenPreview).toHaveBeenCalledWith('http://127.0.0.1:43125/');

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Confirmer la publication')
      )?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.deployHostedSite).toHaveBeenCalledWith(preview.id);
    expect(onOpenPreview).toHaveBeenCalledWith(deployment.address);
  });
});
