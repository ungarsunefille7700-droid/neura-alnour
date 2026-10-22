import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import {
  ADHAN_VOICES,
  getAdhanVoice,
  getNotificationPreferences,
  hasSavedPrayerLocation,
  saveAdhanPreference,
  saveAdhanVoice,
  saveNotificationPreferences,
  savePrayerLocation,
} from '@/utils/notificationPreferences';
import { startAdhan, stopAdhan } from '@/components/PrayerNotificationManager';
import { 
  Clock, 
  MapPin, 
  Bell, 
  Sun, 
  Sunrise, 
  Sunset,
  Moon,
  Home,
  Sparkles,
  Loader2,
  RefreshCw,
  Volume2,
  Navigation,
  Compass,
  Play,
  Square
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PrayerTimesPage = () => {
  const { theme, toggleTheme } = useTheme();
  const [prayerTimes, setPrayerTimes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [locationName, setLocationName] = useState('');
  // True when geolocation is unavailable and the times are computed for Paris.
  const [usingFallback, setUsingFallback] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const initialNotificationPreferences = getNotificationPreferences();
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    initialNotificationPreferences.notifications &&
    'Notification' in window &&
    Notification.permission === 'granted'
  );
  const [qiblah, setQiblah] = useState(null);
  const [adhanEnabled, setAdhanEnabled] = useState(initialNotificationPreferences.adhan);
  const [adhanPreview, setAdhanPreview] = useState(false);
  const [adhanVoice, setAdhanVoice] = useState(getAdhanVoice);

  useEffect(() => {
    getLocation();
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (location) {
      fetchPrayerTimes();
      fetchQiblah();
      fetchLocationName();
    }
  }, [location]);

  const getLocation = () => {
    setLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const nextLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          savePrayerLocation(nextLocation);
          setUsingFallback(false);
          setLocation(nextLocation);
        },
        (error) => {
          console.error('Geolocation error:', error);
          // Default to Paris for display only: a real position saved earlier
          // keeps being used by the prayer reminders.
          const fallbackLocation = { latitude: 48.8566, longitude: 2.3522 };
          setUsingFallback(true);
          setLocation(fallbackLocation);
          setLocationName('Paris, France (position par défaut)');
          toast.info('Position par défaut: Paris. Activez la géolocalisation pour votre position exacte.');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      const fallbackLocation = { latitude: 48.8566, longitude: 2.3522 };
      setUsingFallback(true);
      setLocation(fallbackLocation);
      setLocationName('Paris, France (position par défaut)');
    }
  };

  const fetchLocationName = async () => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${location.latitude}&lon=${location.longitude}&zoom=10`
      );
      const data = await response.json();
      const city = data.address?.city || data.address?.town || data.address?.village || '';
      const country = data.address?.country || '';
      const name = `${city}${city && country ? ', ' : ''}${country}`;
      setLocationName(usingFallback ? `${name || 'Paris, France'} (position par défaut)` : name);
    } catch (error) {
      console.error('Error fetching location name:', error);
    }
  };

  const fetchPrayerTimes = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/prayer-times`, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude,
          method: 2  // ISNA method
        }
      });
      setPrayerTimes(response.data);
    } catch (error) {
      console.error('Error fetching prayer times:', error);
      toast.error('Erreur lors du chargement des horaires');
    } finally {
      setLoading(false);
    }
  };

  const fetchQiblah = async () => {
    try {
      const response = await axios.get(`${API}/qiblah`, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude
        }
      });
      setQiblah(response.data.direction);
    } catch (error) {
      console.error('Error fetching qiblah:', error);
    }
  };

  const enableNotifications = async () => {
    if (!('Notification' in window)) {
      toast.error('Les notifications ne sont pas disponibles dans ce navigateur.');
      return;
    }
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      saveNotificationPreferences({ notifications: false, prayerReminders: false });
      toast.success('Notifications désactivées');
      return;
    }

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission === 'granted') {
      setNotificationsEnabled(true);
      saveNotificationPreferences({ notifications: true, prayerReminders: true });
      toast.success('Notifications et rappels de prière activés');
    } else {
      toast.error("L'autorisation des notifications a été refusée.");
    }
  };

  const toggleAdhan = () => {
    const next = !adhanEnabled;
    setAdhanEnabled(next);
    saveAdhanPreference(next);
    if (next && usingFallback) {
      // This page asked for the position on load; it was refused or unavailable.
      toast.warning(hasSavedPrayerLocation()
        ? "Adhan activé sur votre dernière position connue : autorisez la localisation pour suivre vos déplacements."
        : "Adhan activé, mais sur les horaires de Paris : autorisez la localisation pour suivre votre position.");
      return;
    }
    toast.success(next
      ? "Adhan activé à l'heure des prières de votre position, tant que l'application est ouverte."
      : 'Adhan désactivé');
  };

  const toggleAdhanPreview = async () => {
    if (adhanPreview) {
      stopAdhan();
      setAdhanPreview(false);
      return;
    }
    // Played from a click, which also allows the browser to play it later at prayer time.
    const played = await startAdhan(() => setAdhanPreview(false), adhanVoice);
    if (!played) {
      toast.error("Impossible de lire l'Adhan sur cet appareil.");
      return;
    }
    setAdhanPreview(true);
  };

  const changeAdhanVoice = (id) => {
    stopAdhan();
    setAdhanPreview(false);
    saveAdhanVoice(id);
    setAdhanVoice(getAdhanVoice());
  };

  useEffect(() => () => stopAdhan(), []);

  const prayers = prayerTimes ? [
    { name: 'Fajr', arabic: 'الفجر', time: prayerTimes.fajr, icon: Sunrise, color: 'text-blue-400' },
    { name: 'Lever du soleil', arabic: 'الشروق', time: prayerTimes.sunrise, icon: Sun, color: 'text-yellow-400', isSunrise: true },
    { name: 'Dhuhr', arabic: 'الظهر', time: prayerTimes.dhuhr, icon: Sun, color: 'text-yellow-500' },
    { name: 'Asr', arabic: 'العصر', time: prayerTimes.asr, icon: Sun, color: 'text-orange-400' },
    { name: 'Maghrib', arabic: 'المغرب', time: prayerTimes.maghrib, icon: Sunset, color: 'text-orange-500' },
    { name: 'Isha', arabic: 'العشاء', time: prayerTimes.isha, icon: Moon, color: 'text-purple-400' },
  ] : [];

  const getNextPrayer = () => {
    if (!prayers.length) return null;
    
    const now = currentTime;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    for (const prayer of prayers) {
      if (prayer.isSunrise) continue;
      const [hours, minutes] = prayer.time.split(':').map(Number);
      const prayerMinutes = hours * 60 + minutes;
      if (prayerMinutes > currentMinutes) {
        return prayer;
      }
    }
    return prayers[0]; // Next day's Fajr
  };

  const getTimeUntil = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const now = currentTime;
    const prayerDate = new Date(now);
    prayerDate.setHours(hours, minutes, 0, 0);
    
    if (prayerDate < now) {
      prayerDate.setDate(prayerDate.getDate() + 1);
    }
    
    const diff = prayerDate - now;
    const hoursUntil = Math.floor(diff / (1000 * 60 * 60));
    const minutesUntil = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hoursUntil > 0) {
      return `${hoursUntil}h ${minutesUntil}min`;
    }
    return `${minutesUntil} min`;
  };

  const nextPrayer = getNextPrayer();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 glass">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold">NEURA</span>
          </Link>
          
          <div className="flex items-center gap-2">
            <Link to="/" className="p-2 rounded-full hover:bg-muted transition-colors">
              <Home className="w-5 h-5" />
            </Link>
            <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-muted transition-colors">
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="pt-20 pb-12 px-4">
        <div className="max-w-2xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-8">
            <Clock className="w-16 h-16 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">مواقيت الصلاة</h1>
            <p className="text-xl text-muted-foreground">Heures de Prière</p>
          </div>

          {/* Location */}
          <Card className="p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-primary" />
              <div>
                <p className="font-medium">{locationName || 'Chargement...'}</p>
                <p className="text-xs text-muted-foreground">
                  {location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : ''}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={getLocation}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </Card>

          {/* Current Time */}
          <Card className="p-6 mb-6 text-center glass">
            <p className="text-5xl font-bold font-mono">
              {currentTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-muted-foreground mt-2">
              {currentTime.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </Card>

          {/* Next Prayer */}
          {nextPrayer && (
            <Card className="p-6 mb-6 bg-primary/10 border-primary/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary font-medium mb-1">Prochaine prière</p>
                  <p className="text-2xl font-bold">{nextPrayer.name}</p>
                  <p className="font-arabic text-muted-foreground">{nextPrayer.arabic}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-primary">{nextPrayer.time}</p>
                  <p className="text-sm text-muted-foreground">dans {getTimeUntil(nextPrayer.time)}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Qiblah Direction */}
          {qiblah !== null && (
            <Card className="p-6 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-secondary/10 flex items-center justify-center">
                    <Compass className="w-7 h-7 text-secondary" />
                  </div>
                  <div>
                    <p className="font-semibold">Direction de la Qiblah</p>
                    <p className="text-sm text-muted-foreground">Vers La Mecque</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-secondary">{qiblah.toFixed(1)}°</p>
                  <Link to="/qiblah" className="text-sm text-primary hover:underline">
                    Voir la boussole →
                  </Link>
                </div>
              </div>
            </Card>
          )}

          {/* Prayer Times List */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-3">
              {prayers.map((prayer, index) => (
                <Card 
                  key={index}
                  className={`
                    p-4 transition-all hover:shadow-md
                    ${nextPrayer?.name === prayer.name && !prayer.isSunrise ? 'ring-2 ring-primary' : ''}
                    ${prayer.isSunrise ? 'opacity-60' : ''}
                  `}
                  data-testid={`prayer-${prayer.name.toLowerCase().replace(' ', '-')}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl bg-muted flex items-center justify-center ${prayer.color}`}>
                        <prayer.icon className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="font-semibold">{prayer.name}</p>
                        <p className="text-sm text-muted-foreground font-arabic">{prayer.arabic}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold font-mono">{prayer.time}</p>
                      {!prayer.isSunrise && nextPrayer?.name !== prayer.name && (
                        <p className="text-xs text-muted-foreground">dans {getTimeUntil(prayer.time)}</p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Notifications */}
          <Card className="p-6 mt-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-secondary/10 flex items-center justify-center text-secondary">
                  <Bell className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-semibold">Notifications & Adhan</p>
                  <p className="text-sm text-muted-foreground">Recevez l'appel à la prière</p>
                </div>
              </div>
              <Button 
                onClick={enableNotifications}
                variant={notificationsEnabled ? "outline" : "default"}
                className="rounded-full"
                data-testid="enable-notifications-btn"
              >
                {notificationsEnabled ? (
                  <>
                    <Volume2 className="w-4 h-4 mr-2" />
                    Activé
                  </>
                ) : (
                  'Activer'
                )}
              </Button>
            </div>
            <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">Adhan à l'heure de la prière</p>
                <p className="text-sm text-muted-foreground">
                  Joué quand l'application est ouverte (limite des navigateurs).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={adhanVoice.id}
                  onChange={(e) => changeAdhanVoice(e.target.value)}
                  className="h-9 max-w-full rounded-full border border-border bg-background px-3 text-sm outline-none"
                  aria-label="Voix de l'Adhan"
                  data-testid="adhan-voice-select"
                >
                  {ADHAN_VOICES.map((voice) => (
                    <option key={voice.id} value={voice.id}>{voice.label}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAdhanPreview}
                  className="rounded-full"
                  data-testid="adhan-preview-btn"
                >
                  {adhanPreview ? <Square className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
                  {adhanPreview ? 'Arrêter' : 'Écouter'}
                </Button>
                <Button
                  size="sm"
                  variant={adhanEnabled ? 'outline' : 'default'}
                  onClick={toggleAdhan}
                  className="rounded-full"
                  data-testid="adhan-toggle-btn"
                  aria-pressed={adhanEnabled}
                >
                  {adhanEnabled ? 'Activé' : 'Activer'}
                </Button>
              </div>
              <a
                href={adhanVoice.source}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-xs text-muted-foreground hover:underline"
                data-testid="adhan-credit"
              >
                {adhanVoice.credit} (Wikimedia Commons)
              </a>
            </div>
          </Card>

          {/* Quick Links */}
          <div className="grid grid-cols-2 gap-4 mt-8">
            <Link to="/qiblah">
              <Card className="p-4 text-center hover:shadow-md transition-all hover:-translate-y-1">
                <Compass className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="font-medium">Boussole Qiblah</p>
              </Card>
            </Link>
            <Link to="/mosques">
              <Card className="p-4 text-center hover:shadow-md transition-all hover:-translate-y-1">
                <Navigation className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="font-medium">Mosquées proches</p>
              </Card>
            </Link>
          </div>

          {/* Info */}
          <p className="text-center text-sm text-muted-foreground mt-8">
            Horaires calculés selon la méthode ISNA • {usingFallback ? 'Position par défaut : Paris' : 'Basés sur votre position GPS'}
          </p>
        </div>
      </main>
    </div>
  );
};

export default PrayerTimesPage;
