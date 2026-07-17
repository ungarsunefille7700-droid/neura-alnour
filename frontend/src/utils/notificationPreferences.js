const NOTIFICATIONS_KEY = 'neura_notifications_enabled';
const PRAYER_REMINDERS_KEY = 'neura_prayer_reminders_enabled';

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
};

export const prayerReminderStorageKey = (date, prayerName) => {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
  return `neura_prayer_reminder_${day}_${prayerName.toLowerCase()}`;
};
