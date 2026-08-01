export const MAX_CHAT_IMAGES = 5;

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Impossible de lire cette image.'));
  reader.readAsDataURL(file);
});

const loadImage = (source) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Cette image est illisible ou endommagée.'));
  image.src = source;
});

const dataUrlBytes = (dataUrl) => {
  const payload = String(dataUrl).split(',', 2)[1] || '';
  return Math.ceil(payload.length * 0.75);
};

export const formatImageBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

export const isSupportedImageFile = (file) => (
  Boolean(file) && SUPPORTED_IMAGE_TYPES.has(String(file.type || '').toLowerCase())
);

export const clipboardImageFiles = (clipboardData) => (
  Array.from(clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
);

export const droppedImageFiles = (dataTransfer) => (
  Array.from(dataTransfer?.files || []).filter(isSupportedImageFile)
);

export const prepareImageAttachment = async (file, maxBytes) => {
  if (!isSupportedImageFile(file)) {
    throw new Error('Formats acceptés : PNG, JPEG, WEBP et GIF.');
  }
  if (file.size > maxBytes) {
    throw new Error(`L’image dépasse la limite de ${formatImageBytes(maxBytes)}.`);
  }

  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  let preview = original;

  // Preserve crisp screenshots when possible. Large images and animated GIFs
  // are flattened to a high-quality WEBP preview to keep uploads reasonable.
  if (scale < 1 || file.size > 2 * 1024 * 1024 || file.type === 'image/gif') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
    preview = canvas.toDataURL('image/webp', 0.9);
  }

  const size = dataUrlBytes(preview);
  if (size > maxBytes) {
    throw new Error('L’image reste trop volumineuse après compression.');
  }

  return {
    id: globalThis.crypto?.randomUUID?.() || `image-${Date.now()}-${Math.random()}`,
    name: file.name || `capture-${Date.now()}.png`,
    type: file.type,
    originalSize: file.size,
    size,
    width,
    height,
    preview,
    data: preview.split(',', 2)[1] || ''
  };
};

export const composeImageAttachments = async (attachments, maxBytes) => {
  if (!attachments.length) return null;
  if (attachments.length === 1) return attachments[0].data;

  const images = await Promise.all(attachments.map((item) => loadImage(item.preview)));
  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const canvas = document.createElement('canvas');
  const gap = 24;
  const labelHeight = 42;
  const cellWidth = Math.floor((3600 - gap * (columns + 1)) / columns);
  const cellHeight = 1300;
  canvas.width = columns * cellWidth + gap * (columns + 1);
  canvas.height = rows * (cellHeight + labelHeight) + gap * (rows + 1);

  const context = canvas.getContext('2d');
  context.fillStyle = '#080b12';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '600 24px Arial, sans-serif';
  context.textBaseline = 'middle';

  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (cellWidth + gap);
    const y = gap + row * (cellHeight + labelHeight + gap);
    context.fillStyle = '#d9e3f0';
    context.fillText(`Image ${index + 1} — ${attachments[index].name}`, x, y + labelHeight / 2);
    const scale = Math.min(cellWidth / image.naturalWidth, cellHeight / image.naturalHeight);
    const drawWidth = Math.round(image.naturalWidth * scale);
    const drawHeight = Math.round(image.naturalHeight * scale);
    const drawX = x + Math.floor((cellWidth - drawWidth) / 2);
    const drawY = y + labelHeight + Math.floor((cellHeight - drawHeight) / 2);
    context.fillStyle = '#111827';
    context.fillRect(x, y + labelHeight, cellWidth, cellHeight);
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  });

  for (const quality of [0.92, 0.82, 0.7, 0.58]) {
    const output = canvas.toDataURL('image/webp', quality);
    if (dataUrlBytes(output) <= maxBytes) {
      return output.split(',', 2)[1] || '';
    }
  }
  throw new Error('Les images réunies sont trop volumineuses. Retirez une image puis réessayez.');
};
