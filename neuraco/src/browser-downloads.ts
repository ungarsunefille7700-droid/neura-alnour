import type { NeuraCoBrowserDownload } from '../electron/ipc-contract';

export const formatBrowserBytes = (value: number): string => {
  const bytes = Math.max(0, Number.isFinite(value) ? value : 0);
  if (bytes < 1024) return `${Math.round(bytes)} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(1)} Go`;
};

export const browserDownloadProgress = (
  download: Pick<NeuraCoBrowserDownload, 'receivedBytes' | 'totalBytes'>
): number | null => {
  if (download.totalBytes <= 0) return null;
  return Math.min(100, Math.max(0, Math.round(
    (download.receivedBytes / download.totalBytes) * 100
  )));
};
