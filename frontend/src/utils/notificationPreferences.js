const NOTIFICATIONS_KEY = 'neura_notifications_enabled';
const PRAYER_REMINDERS_KEY = 'neura_prayer_reminders_enabled';
const PRAYER_LOCATION_KEY = 'neura_prayer_location';
export const NOTIFICATION_PREFERENCES_EVENT = 'neura-notification-preferences';

const readBoolean = (key, fallback) => {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
};

const writeBoolean = (key, value) => {
  try {
    window.localStorage.setItem(key, String(Boolean(value)));
  } catch {
    // Preferences remain usable for the current session if storage is blocked.
  }
};

export const getNotificationPreferences = () => ({
  notifications: readBoolean(NOTIFICATIONS_KEY, false),
  prayerReminders: readBoolean(PRAYER_REMINDERS_KEY, false),
});

export const saveNotificationPreferences = ({ notifications, prayerReminders }) => {
  writeBoolean(NOTIFICATIONS_KEY, notifications);
  writeBoolean(PRAYER_REMINDERS_KEY, prayerReminders);
  window.dispatchEvent(new CustomEvent(NOTIFICATION_PREFERENCES_EVENT));
};

export const getPrayerLocation = () => {
  try {
    const value = JSON.parse(window.localStorage.getItem(PRAYER_LOCATION_KEY));
    if (Number.isFinite(value?.latitude) && Number.isFinite(value?.longitude)) return value;
  } catch {
    // Fall through to the same Paris fallback used by the prayer page.
  }
  return { latitude: 48.8566, longitude: 2.3522 };
};

export const savePrayerLocation = ({ latitude, longitude }) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  try {
    window.localStorage.setItem(PRAYER_LOCATION_KEY, JSON.stringify({ latitude, longitude }));
  } catch {
    // The current page still keeps the location if storage is unavailable.
  }
};

export const prayerReminderStorageKey = (date, prayerName) => {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
  return `neura_prayer_reminder_${day}_${prayerName.toLowerCase()}`;
};
