import { describe, expect, it, vi } from 'vitest';
import {
  MAX_AGENT_IMAGES,
  MAX_PREPARED_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_BYTES,
  clipboardImageFiles,
  droppedImageFiles,
  formatImageBytes,
  isSupportedImageFile,
  resizePreparedImage
} from './image-attachments';

describe('NeuraCo image attachments', () => {
  it('accepts only the required safe image formats', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(isSupportedImageFile({ type } as File)).toBe(true);
    }
    expect(isSupportedImageFile({ type: 'image/svg+xml' } as File)).toBe(false);
    expect(isSupportedImageFile({ type: 'application/pdf' } as File)).toBe(false);
    expect(MAX_AGENT_IMAGES).toBe(5);
    expect(MAX_SOURCE_IMAGE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_PREPARED_IMAGE_BYTES).toBe(6 * 1024 * 1024);
  });

  it('extracts all clipboard images without consuming text entries', () => {
    const png = new File(['png'], 'capture.png', { type: 'image/png' });
    const webp = new File(['webp'], 'capture.webp', { type: 'image/webp' });
    const clipboard = {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => png },
        { kind: 'file', type: 'image/webp', getAsFile: () => webp }
      ]
    } as unknown as DataTransfer;
    expect(clipboardImageFiles(clipboard)).toEqual([png, webp]);
  });

  it('keeps supported dropped files and formats their size', () => {
    const jpeg = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' });
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const transfer = { files: [jpeg, text] } as unknown as DataTransfer;
    expect(droppedImageFiles(transfer)).toEqual([jpeg]);
    expect(formatImageBytes(500)).toBe('500 o');
    expect(formatImageBytes(2048)).toBe('2 Ko');
    expect(formatImageBytes(2 * 1024 * 1024)).toBe('2.0 Mo');
  });

  it('creates an exact local resize without mutating the prepared source', async () => {
    const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const source = {
      id: 'source-image-123',
      name: 'source.png',
      mimeType: 'image/png' as const,
      dataBase64: encoded,
      width: 640,
      height: 480,
      size: 24,
      preview: `data:image/png;base64,${encoded}`
    };
    const drawImage = vi.fn();
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(context),
      toDataURL: vi.fn().mockReturnValue(`data:image/png;base64,${encoded}`)
    };
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement')
      .mockImplementation(((tagName: string) => (
        tagName === 'canvas'
          ? canvas
          : originalCreateElement(tagName)
      )) as typeof document.createElement);
    const OriginalImage = globalThis.Image;
    class MockImage {
      naturalWidth = 640;
      naturalHeight = 480;
      onload?: () => void;
      onerror?: () => void;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;
    try {
      const result = await resizePreparedImage(source, 1024, 512);
      expect(canvas.width).toBe(1024);
      expect(canvas.height).toBe(512);
      expect(context.imageSmoothingEnabled).toBe(true);
      expect(context.imageSmoothingQuality).toBe('high');
      expect(drawImage).toHaveBeenCalledWith(
        expect.any(MockImage),
        0,
        0,
        1024,
        512
      );
      expect(result).toMatchObject({
        width: 1024,
        height: 512,
        mimeType: 'image/png',
        dataBase64: encoded
      });
      expect(source.width).toBe(640);
      expect(source.height).toBe(480);
    } finally {
      createElement.mockRestore();
      globalThis.Image = OriginalImage;
    }
  });
});
