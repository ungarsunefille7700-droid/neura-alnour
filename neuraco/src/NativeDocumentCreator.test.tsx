// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoDesktopApi,
  NeuraCoNativeDocumentPreview
} from '../electron/ipc-contract';
import NativeDocumentCreator from './NativeDocumentCreator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preview: NeuraCoNativeDocumentPreview = {
  previewId: 'sha256-preview',
  format: 'docx',
  extension: '.docx',
  mimeType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  previewHtml: '<!doctype html><html><body><h1>Rapport</h1></body></html>',
  itemCount: 2,
  warnings: [],
  validatedAt: '2026-07-29T12:00:00.000Z'
};

afterEach(() => {
  document.body.innerHTML = '';
  delete window.neuraco;
});

describe('NativeDocumentCreator', () => {
  it('requires a fresh preview before exporting the exact native draft', async () => {
    const previewNativeDocument = vi.fn().mockResolvedValue(preview);
    const exportNativeDocument = vi.fn().mockResolvedValue({
      path: 'C:\\Projet\\rapport.docx',
      format: 'docx',
      mimeType: preview.mimeType,
      size: 2048,
      sha256: 'sha256-export',
      createdAt: '2026-07-29T12:01:00.000Z'
    });
    window.neuraco = {
      previewNativeDocument,
      exportNativeDocument
    } as unknown as NeuraCoDesktopApi;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <NativeDocumentCreator
          project={{ id: 'project-1', name: 'Projet', rootPath: 'C:\\Projet' }}
          emergencyStopped={false}
          onStatus={vi.fn()}
        />
      );
    });

    const buttons = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    const exportButton = () =>
      buttons().find((button) => button.textContent?.includes('Exporter'));
    const previewButton = buttons()
      .find((button) => button.textContent?.includes('Prévisualiser'));

    expect(previewButton).toBeDefined();
    expect(exportButton()?.disabled).toBe(true);

    await act(async () => {
      previewButton!.click();
      await Promise.resolve();
    });

    expect(previewNativeDocument).toHaveBeenCalledWith(expect.objectContaining({
      format: 'docx',
      title: 'Rapport NeuraCo'
    }));
    expect(container.textContent).toContain('2 élément(s)');
    expect(exportButton()?.disabled).toBe(false);

    await act(async () => {
      exportButton()!.click();
      await Promise.resolve();
    });
    expect(exportNativeDocument).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'docx', title: 'Rapport NeuraCo' }),
      'sha256-preview'
    );

    const titleInput = Array.from(
      container.querySelectorAll<HTMLInputElement>('input')
    ).find((input) => input.value === 'Rapport NeuraCo');
    expect(titleInput).toBeDefined();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      valueSetter?.call(titleInput, 'Rapport modifié');
      titleInput!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(exportButton()?.disabled).toBe(true);

    await act(async () => root.unmount());
  });
});
