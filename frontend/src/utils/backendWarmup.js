const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

let warmupPromise = null;
let resetTimer = null;

export function prewarmBackend() {
  if (warmupPromise) return warmupPromise;

  warmupPromise = fetch(`${API}/health`, {
    cache: 'no-store',
    keepalive: true,
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        warmupPromise = null;
      }, 60000);
    });

  return warmupPromise;
}

export function waitForBackendWarmup(maxWaitMs = 8000) {
  return Promise.race([
    prewarmBackend(),
    new Promise((resolve) => window.setTimeout(() => resolve(false), maxWaitMs)),
  ]);
}
