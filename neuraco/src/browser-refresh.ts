export const BROWSER_REFRESH_INTERVALS = [0, 2_000, 5_000, 10_000, 30_000] as const;

export const normalizeBrowserRefreshInterval = (value: number): number => (
  BROWSER_REFRESH_INTERVALS.includes(
    value as (typeof BROWSER_REFRESH_INTERVALS)[number]
  ) ? value : 0
);
