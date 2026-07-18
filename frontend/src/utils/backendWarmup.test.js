describe('backend warm-up', () => {
  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test('deduplicates concurrent wake-up requests', async () => {
    const { prewarmBackend } = require('./backendWarmup');
    const first = prewarmBackend();
    const second = prewarmBackend();
    expect(first).toBe(second);
    await expect(first).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/health'),
      expect.objectContaining({ cache: 'no-store', keepalive: true })
    );
  });

  test('lets Google navigation continue after the maximum wait', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(() => new Promise(() => {}));
    const { waitForBackendWarmup } = require('./backendWarmup');
    const result = waitForBackendWarmup(8000);
    jest.advanceTimersByTime(8000);
    await expect(result).resolves.toBe(false);
  });
});
