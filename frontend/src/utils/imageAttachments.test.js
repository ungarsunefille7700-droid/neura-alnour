import {
  MAX_CHAT_IMAGES,
  clipboardImageFiles,
  droppedImageFiles,
  formatImageBytes,
  isSupportedImageFile
} from './imageAttachments';


describe('chat image attachments', () => {
  test('supports the required web image formats', () => {
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].forEach((type) => {
      expect(isSupportedImageFile({ type })).toBe(true);
    });
    expect(isSupportedImageFile({ type: 'image/svg+xml' })).toBe(false);
    expect(isSupportedImageFile({ type: 'application/pdf' })).toBe(false);
    expect(MAX_CHAT_IMAGES).toBe(5);
  });

  test('extracts every image from clipboard items without treating text as a file', () => {
    const first = { name: 'capture.png', type: 'image/png' };
    const second = { name: 'photo.webp', type: 'image/webp' };
    const clipboardData = {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => first },
        { kind: 'file', type: 'image/webp', getAsFile: () => second }
      ]
    };
    expect(clipboardImageFiles(clipboardData)).toEqual([first, second]);
  });

  test('keeps only supported dropped image files', () => {
    const png = { name: 'capture.png', type: 'image/png' };
    const text = { name: 'notes.txt', type: 'text/plain' };
    expect(droppedImageFiles({ files: [png, text] })).toEqual([png]);
  });

  test('formats attachment sizes for the composer', () => {
    expect(formatImageBytes(500)).toBe('500 o');
    expect(formatImageBytes(2048)).toBe('2 Ko');
    expect(formatImageBytes(2 * 1024 * 1024)).toBe('2.0 Mo');
  });
});
