import { useEffect, useState } from 'react';
import {
  getNotificationPreferences,
  getPrayerLocation,
  NOTIFICATION_PREFERENCES_EVENT,
  prayerReminderStorageKey,
} from '@/utils/notificationPreferences';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PrayerNotificationManager = () => {
  const [preferences, setPreferences] = useState(getNotificationPreferences);

  useEffect(() => {
    const refreshPreferences = () => setPreferences(getNotificationPreferences());
    window.addEventListener('storage', refreshPreferences);
    window.addEventListener(NOTIFICATION_PREFERENCES_EVENT, refreshPreferences);
    return () => {
      window.removeEventListener('storage', refreshPreferences);
      window.removeEventListener(NOTIFICATION_PREFERENCES_EVENT, refreshPreferences);
    };
  }, []);

  useEffect(() => {
    if (
      !preferences.notifications ||
      !preferences.prayerReminders ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) return undefined;

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
      const reminderAt = new Date(prayerAt.getTime() - 5 * 60 * 1000);
      const delay = reminderAt.getTime() - now.getTime();
      if (prayerAt <= now || delay <= -5 * 60 * 1000) return;

      const notify = () => {
        const current = getNotificationPreferences();
        if (!current.notifications || !current.prayerReminders) return;
        const sentKey = prayerReminderStorageKey(prayerAt, name);
        if (window.localStorage.getItem(sentKey) === 'sent') return;
        try {
          new Notification(`Prière de ${name} dans 5 minutes`, {
            body: `Horaire prévu : ${time}`,
            icon: '/favicon.ico',
            tag: sentKey,
          });
          window.localStorage.setItem(sentKey, 'sent');
        } catch {
          // A browser can revoke permission while the application is open.
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

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(refreshTimer);
      clearNotificationTimers();
    };
  }, [preferences.notifications, preferences.prayerReminders]);

  return null;
};

export default PrayerNotificationManager;
