import { act } from 'react';
import { createRoot } from 'react-dom/client';
import PrayerNotificationManager from './PrayerNotificationManager';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const timings = { fajr: '06:00', dhuhr: '12:01', asr: '15:30', maghrib: '18:45', isha: '20:10' };

const renderManager = async () => {
  await act(async () => { root.render(<PrayerNotificationManager />); });
  // Let the prayer-times request resolve and the timers be scheduled.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 14, 12, 0, 30));
  localStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => timings });
  global.Audio = jest.fn().mockImplementation(() => ({
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn(),
    addEventListener: jest.fn(),
  }));
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  jest.useRealTimers();
  delete global.fetch;
  delete global.Audio;
});

describe('Adhan at prayer time', () => {
  test('plays the Adhan file once when Dhuhr starts, without notification permission', async () => {
    localStorage.setItem('neura_adhan_enabled', 'true');
    await renderManager();
    expect(global.Audio).not.toHaveBeenCalled();

    await act(async () => { jest.advanceTimersByTime(31 * 1000); });
    expect(global.Audio).toHaveBeenCalledTimes(1);
    expect(global.Audio).toHaveBeenCalledWith('/audio/adhan-medine.mp3');
    expect(global.Audio.mock.results[0].value.play).toHaveBeenCalled();
    expect(localStorage.getItem('neura_prayer_reminder_2026-10-14_dhuhr_adhan')).toBe('played');
  });

  test('uses the voice chosen by the user', async () => {
    localStorage.setItem('neura_adhan_enabled', 'true');
    localStorage.setItem('neura_adhan_voice', 'andrewler');
    await renderManager();
    await act(async () => { jest.advanceTimersByTime(31 * 1000); });
    expect(global.Audio).toHaveBeenCalledWith('/audio/adhan-andrewler.mp3');
  });

  test('asks the prayer times for the device position, then follows a move', async () => {
    localStorage.setItem('neura_adhan_enabled', 'true');
    let coords = { latitude: 33.5731, longitude: -7.5898 }; // Casablanca
    navigator.permissions = { query: jest.fn().mockResolvedValue({ state: 'granted' }) };
    navigator.geolocation = {
      getCurrentPosition: jest.fn((success) => success({ coords })),
    };

    await renderManager();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const urls = () => global.fetch.mock.calls.map(([url]) => url);
    expect(urls().some((url) => url.includes('latitude=33.5731&longitude=-7.5898'))).toBe(true);

    // Travel to Lyon: the next position check reschedules with the new place.
    coords = { latitude: 45.764, longitude: 4.8357 };
    await act(async () => { jest.advanceTimersByTime(30 * 60 * 1000); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(urls().some((url) => url.includes('latitude=45.764&longitude=4.8357'))).toBe(true);

    delete navigator.permissions;
    delete navigator.geolocation;
  });

  test('never opens a location prompt in the background', async () => {
    localStorage.setItem('neura_adhan_enabled', 'true');
    navigator.permissions = { query: jest.fn().mockResolvedValue({ state: 'prompt' }) };
    navigator.geolocation = { getCurrentPosition: jest.fn() };
    await renderManager();
    await act(async () => { await Promise.resolve(); });
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    delete navigator.permissions;
    delete navigator.geolocation;
  });

  test('does nothing when the Adhan is disabled', async () => {
    await renderManager();
    await act(async () => { jest.advanceTimersByTime(60 * 60 * 1000); });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.Audio).not.toHaveBeenCalled();
  });

  test('does not replay an Adhan already played today (page reopened)', async () => {
    localStorage.setItem('neura_adhan_enabled', 'true');
    localStorage.setItem('neura_prayer_reminder_2026-10-14_dhuhr_adhan', 'played');
    await renderManager();
    await act(async () => { jest.advanceTimersByTime(31 * 1000); });
    expect(global.Audio).not.toHaveBeenCalled();
  });
});
