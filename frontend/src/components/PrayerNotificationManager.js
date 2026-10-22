import { useEffect, useState } from 'react';
import {
  getNotificationPreferences,
  getPrayerLocation,
  locateForPrayers,
  NOTIFICATION_PREFERENCES_EVENT,
  PRAYER_LOCATION_EVENT,
  getAdhanVoice,
  prayerReminderStorageKey,
} from '@/utils/notificationPreferences';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const NOTIFICATION_WORKER_URL = '/notification-sw.js';

// Desktop browsers accept `new Notification()`. Android Chrome (and the
// installed Android app) reject it and only allow notifications shown
// through a service worker registration.
export const showSystemNotification = async (title, options) => {
  try {
    new Notification(title, options);
    return true;
  } catch {
    // Fall back to the service worker below.
  }
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.register(NOTIFICATION_WORKER_URL);
    const ready = registration.active ? registration : await navigator.serviceWorker.ready;
    await ready.showNotification(title, options);
    return true;
  } catch {
    // Permission revoked or service workers unavailable.
    return false;
  }
};

// One Adhan at a time, shared with the "Écouter" button of the prayer page.
let adhanAudio = null;

export const stopAdhan = () => {
  if (adhanAudio) {
    adhanAudio.pause();
    adhanAudio = null;
  }
};

// Starts the Adhan. Resolves to false when the browser blocks the sound
// (no interaction with the page yet) or the file cannot be played.
export const startAdhan = async (onEnd, voice = getAdhanVoice()) => {
  stopAdhan();
  const audio = new Audio(voice.file);
  adhanAudio = audio;
  audio.addEventListener('ended', () => {
    if (adhanAudio === audio) adhanAudio = null;
    if (onEnd) onEnd();
  });
  try {
    await audio.play();
    return true;
  } catch {
    if (adhanAudio === audio) adhanAudio = null;
    return false;
  }
};

// At the prayer time: play the Adhan once per prayer and day, and show a
// notification when allowed (useful when the sound is blocked or the tab hidden).
const playAdhan = async (name, time, prayerAt) => {
  const playedKey = `${prayerReminderStorageKey(prayerAt, name)}_adhan`;
  try {
    if (window.localStorage.getItem(playedKey) === 'played') return;
    window.localStorage.setItem(playedKey, 'played');
  } catch {
    // Storage blocked: play anyway.
  }
  const played = await startAdhan();
  if ('Notification' in window && Notification.permission === 'granted') {
    await showSystemNotification(`C'est l'heure de la prière de ${name}`, {
      body: played ? `Adhan · ${time}` : `Horaire : ${time}. Ouvrez l'application pour entendre l'Adhan.`,
      icon: '/icons/icon-192.png',
      tag: playedKey,
    });
  }
};

const PrayerNotificationManager = () => {
  const [preferences, setPreferences] = useState(getNotificationPreferences);
  const [locationVersion, setLocationVersion] = useState(0);

  useEffect(() => {
    const refreshPreferences = () => setPreferences(getNotificationPreferences());
    // A new position saved by the prayer page reschedules today's reminders.
    const refreshLocation = () => setLocationVersion((version) => version + 1);
    window.addEventListener('storage', refreshPreferences);
    window.addEventListener(NOTIFICATION_PREFERENCES_EVENT, refreshPreferences);
    window.addEventListener(PRAYER_LOCATION_EVENT, refreshLocation);
    return () => {
      window.removeEventListener('storage', refreshPreferences);
      window.removeEventListener(NOTIFICATION_PREFERENCES_EVENT, refreshPreferences);
      window.removeEventListener(PRAYER_LOCATION_EVENT, refreshLocation);
    };
  }, []);

  useEffect(() => {
    const remindersActive = Boolean(
      preferences.notifications &&
      preferences.prayerReminders &&
      'Notification' in window &&
      Notification.permission === 'granted'
    );
    // The Adhan is played by the page itself and needs no notification permission.
    if (!remindersActive && !preferences.adhan) return undefined;

    let cancelled = false;
    let refreshTimer;
    let notificationTimers = [];
    const controller = new AbortController();

    const clearNotificationTimers = () => {
      notificationTimers.forEach((timer) => window.clearTimeout(timer));
      notificationTimers = [];
    };

    const schedulePrayer = (name, time) => {
      if (!time || cancelled) return;
      const now = new Date();
      const [hours, minutes] = time.split(':').map(Number);
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;

      const prayerAt = new Date(now);
      prayerAt.setHours(hours, minutes, 0, 0);

      if (preferences.adhan) {
        const adhanDelay = prayerAt.getTime() - now.getTime();
        // Still sounds if the page was (re)opened less than a minute late.
        if (adhanDelay > -60 * 1000) {
          const callAdhan = () => {
            if (!getNotificationPreferences().adhan) return;
            playAdhan(name, time, prayerAt);
          };
          if (adhanDelay <= 0) callAdhan();
          else notificationTimers.push(window.setTimeout(callAdhan, adhanDelay));
        }
      }

      if (!remindersActive) return;
      const reminderAt = new Date(prayerAt.getTime() - 5 * 60 * 1000);
      const delay = reminderAt.getTime() - now.getTime();
      if (prayerAt <= now || delay <= -5 * 60 * 1000) return;

      const notify = async () => {
        const current = getNotificationPreferences();
        if (!current.notifications || !current.prayerReminders) return;
        const sentKey = prayerReminderStorageKey(prayerAt, name);
        try {
          if (window.localStorage.getItem(sentKey) === 'sent') return;
        } catch {
          // Storage blocked: the notification tag still prevents duplicates.
        }
        const shown = await showSystemNotification(`Prière de ${name} dans 5 minutes`, {
          body: `Horaire prévu : ${time}`,
          icon: '/icons/icon-192.png',
          tag: sentKey,
        });
        if (!shown) return;
        try {
          window.localStorage.setItem(sentKey, 'sent');
        } catch {
          // Nothing else to do without storage.
        }
      };

      if (delay <= 0) notify();
      else notificationTimers.push(window.setTimeout(notify, delay));
    };

    const loadAndSchedule = async () => {
      clearNotificationTimers();
      const { latitude, longitude } = getPrayerLocation();
      try {
        const response = await fetch(
          `${API}/prayer-times?latitude=${latitude}&longitude=${longitude}&method=2`,
          { cache: 'no-store', signal: controller.signal }
        );
        if (!response.ok || cancelled) return;
        const timings = await response.json();
        [
          ['Fajr', timings.fajr],
          ['Dhuhr', timings.dhuhr],
          ['Asr', timings.asr],
          ['Maghrib', timings.maghrib],
          ['Isha', timings.isha],
        ].forEach(([name, time]) => schedulePrayer(name, time));
      } catch {
        // Prayer notifications degrade silently; the rest of the app stays usable.
      }
    };

    const scheduleMidnightRefresh = () => {
      const now = new Date();
      const nextDay = new Date(now);
      nextDay.setHours(24, 0, 5, 0);
      refreshTimer = window.setTimeout(async () => {
        await loadAndSchedule();
        if (!cancelled) scheduleMidnightRefresh();
      }, nextDay.getTime() - now.getTime());
    };

    loadAndSchedule();
    scheduleMidnightRefresh();
    // Follow the person: refresh the position now and every 30 minutes while
    // the app is open. A move of 1 km or more reschedules today's prayers.
    locateForPrayers();
    const locationTimer = window.setInterval(() => locateForPrayers(), 30 * 60 * 1000);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(refreshTimer);
      window.clearInterval(locationTimer);
      clearNotificationTimers();
    };
  }, [preferences.notifications, preferences.prayerReminders, preferences.adhan, locationVersion]);

  return null;
};

export default PrayerNotificationManager;
