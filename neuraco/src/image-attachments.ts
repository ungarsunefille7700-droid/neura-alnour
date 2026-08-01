import type { NeuraCoAgentImageContext } from '../electron/ipc-contract';
import type { NeuraCoImageStudioLocalOutput } from '../electron/ipc-contract';

export const MAX_AGENT_IMAGES = 5;
export const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PREPARED_IMAGE_BYTES = 6 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set<NeuraCoAgentImageContext['mimeType']>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);

export interface NeuraCoPreparedImage extends NeuraCoAgentImageContext {
  preview: string;
}

export interface NeuraCoResizedImage extends NeuraCoImageStudioLocalOutput {
  preview: string;
  size: number;
}

const readFileAsDataUrl = (file: File): Promise<string> => (
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Impossible de lire cette image.'));
    reader.readAsDataURL(file);
  })
);

const loadImage = (source: string): Promise<HTMLImageElement> => (
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Cette image est illisible ou endommagée.'));
    image.src = source;
  })
);

const dataUrlBytes = (dataUrl: string): number => {
  const payload = dataUrl.split(',', 2)[1] || '';
  return Math.ceil(payload.length * 0.75);
};

const generatedImageName = (file: File, mimeType: string): string => {
  if (file.name && file.name !== 'image.png') return file.name;
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType.split('/')[1] || 'png';
  return `capture-neuraco-${Date.now()}.${extension}`;
};

export const formatImageBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

export const isSupportedImageFile = (
  file: Pick<File, 'type'> | null | undefined
): boolean => (
  Boolean(file)
  && SUPPORTED_IMAGE_TYPES.has(
    String(file?.type || '').toLowerCase() as NeuraCoAgentImageContext['mimeType']
  )
);

export const clipboardImageFiles = (clipboardData: DataTransfer | null): File[] => (
  Array.from(clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
);

export const droppedImageFiles = (dataTransfer: DataTransfer | null): File[] => (
  Array.from(dataTransfer?.files || []).filter(isSupportedImageFile)
);

export const prepareImageAttachment = async (
  file: File,
  onProgress?: (progress: number) => void
): Promise<NeuraCoPreparedImage> => {
  if (!isSupportedImageFile(file)) {
    throw new Error('Formats acceptés : PNG, JPEG, WEBP et GIF statique.');
  }
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(
      `L’image doit faire moins de ${formatImageBytes(MAX_SOURCE_IMAGE_BYTES)}.`
    );
  }

  onProgress?.(15);
  const original = await readFileAsDataUrl(file);
  onProgress?.(35);
  const image = await loadImage(original);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (!sourceWidth || !sourceHeight || sourceWidth > 20_000 || sourceHeight > 20_000) {
    throw new Error('Les dimensions de cette image ne sont pas valides.');
  }

  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  let preview = original;
  let mimeType = file.type as NeuraCoAgentImageContext['mimeType'];

  if (
    scale < 1
    || file.size > 2 * 1024 * 1024
    || file.type === 'image/gif'
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('La compression d’image est indisponible.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    onProgress?.(65);
    for (const quality of [0.92, 0.84, 0.74, 0.62]) {
      preview = canvas.toDataURL('image/webp', quality);
      if (dataUrlBytes(preview) <= MAX_PREPARED_IMAGE_BYTES) break;
    }
    mimeType = 'image/webp';
  }

  const size = dataUrlBytes(preview);
  if (!size || size > MAX_PREPARED_IMAGE_BYTES) {
    throw new Error(
      `L’image reste trop volumineuse après compression (${formatImageBytes(size)}).`
    );
  }

  onProgress?.(100);
  return {
    id: crypto.randomUUID(),
    name: generatedImageName(file, mimeType),
    mimeType,
    dataBase64: preview.split(',', 2)[1] || '',
    width,
    height,
    size,
    preview
  };
};

export const resizePreparedImage = async (
  source: NeuraCoPreparedImage,
  widthInput: number,
  heightInput: number,
  mimeType: NeuraCoImageStudioLocalOutput['mimeType'] = 'image/png'
): Promise<NeuraCoResizedImage> => {
  const width = Number(widthInput);
  const height = Number(heightInput);
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width > 20_000
    || height > 20_000
  ) {
    throw new Error('Les dimensions doivent être comprises entre 1 et 20 000 pixels.');
  }
  const image = await loadImage(source.preview);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: mimeType !== 'image/jpeg' });
  if (!context) throw new Error('Le redimensionnement local est indisponible.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (mimeType === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  const preview = canvas.toDataURL(mimeType, mimeType === 'image/png' ? undefined : 0.94);
  const size = dataUrlBytes(preview);
  if (!size || size > 25 * 1024 * 1024) {
    throw new Error('L’image redimensionnée dépasse la limite de 25 Mo.');
  }
  return {
    mimeType,
    dataBase64: preview.split(',', 2)[1] || '',
    width,
    height,
    preview,
    size
  };
};
