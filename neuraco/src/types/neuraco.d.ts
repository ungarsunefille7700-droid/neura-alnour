import type { NeuraCoDesktopApi } from '../../electron/ipc-contract';

declare global {
  interface Window {
    neuraco?: NeuraCoDesktopApi;
  }
}

export {};
