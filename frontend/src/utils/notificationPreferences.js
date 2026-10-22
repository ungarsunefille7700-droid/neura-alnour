const NOTIFICATIONS_KEY = 'neura_notifications_enabled';
const PRAYER_REMINDERS_KEY = 'neura_prayer_reminders_enabled';
const PRAYER_LOCATION_KEY = 'neura_prayer_location';
const ADHAN_KEY = 'neura_adhan_enabled';
const ADHAN_VOICE_KEY = 'neura_adhan_voice';

// Freely licensed recordings from Wikimedia Commons, served by the app itself
// (licences detailed in public/audio/CREDITS.txt).
export const ADHAN_VOICES = [
  {
    id: 'medine',
    label: 'Mosquée du Prophète ﷺ (Médine)',
    file: '/audio/adhan-medine.mp3',
    credit: 'Enregistrement : ejaz215 · CC BY 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:33937_ejaz215_call-to-prayer-from-the-prophet-s-mo.ogg',
  },
  {
    id: 'andrewler',
    label: 'Adhan classique',
    file: '/audio/adhan-andrewler.mp3',
    credit: 'Enregistrement : Andrewler · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Azan.ogg',
  },
  {
    id: 'aaqib-azeez',
    label: 'Aaqib Azeez',
    file: '/audio/adhan-aaqib-azeez.mp3',
    credit: 'Enregistrement : Atcovi · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:The_Adhan_-_Muslim_Call_to_Prayer_-_Aaqib_Azeez.mp3',
  },
  {
    id: 'doux',
    label: 'Adhan doux',
    file: '/audio/adhan-cc0.mp3',
    credit: 'Enregistrement : Adam-synagda · domaine public (CC0)',
    source: 'https://commons.wikimedia.org/wiki/File:Beautiful_adhan.ogg',
  },
];

export const getAdhanVoice = () => {
  let id = null;
  try {
    id = window.localStorage.getItem(ADHAN_VOICE_KEY);
  } catch {
    // Default voice below.
  }
  return ADHAN_VOICES.find((voice) => voice.id === id) || ADHAN_VOICES[0];
};

export const saveAdhanVoice = (id) => {
  if (!ADHAN_VOICES.some((voice) => voice.id === id)) return;
  try {
    window.localStorage.setItem(ADHAN_VOICE_KEY, id);
  } catch {
    // The choice applies for this visit only.
  }
};
export const NOTIFICATION_PREFERENCES_EVENT = 'neura-notification-preferences';
export const PRAYER_LOCATION_EVENT = 'neura-prayer-location';

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
  adhan: readBoolean(ADHAN_KEY, false),
});

// `adhan` is optional so existing callers keep the current Adhan setting.
export const saveNotificationPreferences = ({ notifications, prayerReminders, adhan }) => {
  writeBoolean(NOTIFICATIONS_KEY, notifications);
  writeBoolean(PRAYER_REMINDERS_KEY, prayerReminders);
  if (adhan !== undefined) writeBoolean(ADHAN_KEY, adhan);
  window.dispatchEvent(new CustomEvent(NOTIFICATION_PREFERENCES_EVENT));
};

export const saveAdhanPreference = (enabled) => {
  writeBoolean(ADHAN_KEY, enabled);
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

// Distance in metres between two positions (haversine).
const distanceMeters = (a, b) => {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

export const hasSavedPrayerLocation = () => {
  try {
    const value = JSON.parse(window.localStorage.getItem(PRAYER_LOCATION_KEY));
    return Number.isFinite(value?.latitude) && Number.isFinite(value?.longitude);
  } catch {
    return false;
  }
};

export const savePrayerLocation = ({ latitude, longitude }) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  const previous = hasSavedPrayerLocation() ? getPrayerLocation() : null;
  try {
    window.localStorage.setItem(PRAYER_LOCATION_KEY, JSON.stringify({ latitude, longitude }));
  } catch {
    // The current page still keeps the location if storage is unavailable.
  }
  // Prayer times only change noticeably over kilometres: small GPS jitter
  // must not reschedule the reminders and the Adhan.
  if (!previous || distanceMeters(previous, { latitude, longitude }) >= 1000) {
    window.dispatchEvent(new CustomEvent(PRAYER_LOCATION_EVENT));
  }
};

// Updates the saved prayer position from the device location.
// Without `allowPrompt`, it only runs when geolocation is already allowed, so
// it never opens a permission request in the background.
// Resolves to 'located', 'denied' or 'unavailable'.
export const locateForPrayers = async ({ allowPrompt = false } = {}) => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unavailable';
  if (!allowPrompt) {
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' });
      if (status?.state !== 'granted') return 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        savePrayerLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        resolve('located');
      },
      (error) => resolve(error?.code === 1 ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
    );
  });
};

export const prayerReminderStorageKey = (date, prayerName) => {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
  return `neura_prayer_reminder_${day}_${prayerName.toLowerCase()}`;
};
