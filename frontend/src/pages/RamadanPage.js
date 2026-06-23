import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import { 
  Moon as MoonIcon, 
  Sun,
  Sunrise,
  Sunset,
  Home,
  Sparkles,
  Clock,
  UtensilsCrossed,
  BookOpen,
  Heart,
  Loader2,
  MapPin,
  Star
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const RamadanPage = () => {
  const { theme, toggleTheme } = useTheme();
  const [ramadanTimes, setRamadanTimes] = useState(null);
  const [tips, setTips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    getLocation();
    fetchTips();
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (location) {
      fetchRamadanTimes();
    }
  }, [location]);

  const getLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        () => {
          setLocation({ latitude: 48.8566, longitude: 2.3522 });
        }
      );
    } else {
      setLocation({ latitude: 48.8566, longitude: 2.3522 });
    }
  };

  const fetchRamadanTimes = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/ramadan/times`, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude
        }
      });
      setRamadanTimes(response.data);
    } catch (error) {
      console.error('Error fetching Ramadan times:', error);
      toast.error('Erreur lors du chargement des horaires');
    } finally {
      setLoading(false);
    }
  };

  const fetchTips = async () => {
    try {
      const response = await axios.get(`${API}/ramadan/tips`);
      setTips(response.data);
    } catch (error) {
      console.error('Error fetching tips:', error);
    }
  };

  const getTimeUntil = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':').map(Number);
    const now = currentTime;
    const targetDate = new Date(now);
    targetDate.setHours(hours, minutes, 0, 0);
    
    if (targetDate < now) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    
    const diff = targetDate - now;
    const hoursUntil = Math.floor(diff / (1000 * 60 * 60));
    const minutesUntil = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hoursUntil > 0) {
      return `${hoursUntil}h ${minutesUntil}min`;
    }
    return `${minutesUntil} min`;
  };

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
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="pt-20 pb-12 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-8">
            <MoonIcon className="w-16 h-16 text-secondary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">رمضان كريم</h1>
            <p className="text-xl text-muted-foreground">Ramadan Kareem</p>
          </div>

          {/* Current Time */}
          <Card className="p-6 mb-6 text-center glass">
            <p className="text-4xl font-bold font-mono">
              {currentTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-muted-foreground mt-2">
              {currentTime.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </Card>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Fasting Times */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                {/* Suhoor */}
                <Card className="p-6 bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/20">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-2xl bg-blue-500/20 flex items-center justify-center">
                      <Sunrise className="w-7 h-7 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Suhoor (Fin)</p>
                      <p className="font-arabic text-lg">السحور</p>
                    </div>
                  </div>
                  <p className="text-4xl font-bold font-mono mb-2">{ramadanTimes?.suhoor}</p>
                  <p className="text-sm text-muted-foreground">
                    <Clock className="w-4 h-4 inline mr-1" />
                    dans {getTimeUntil(ramadanTimes?.suhoor)}
                  </p>
                </Card>

                {/* Iftar */}
                <Card className="p-6 bg-gradient-to-br from-orange-500/10 to-transparent border-orange-500/20">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-2xl bg-orange-500/20 flex items-center justify-center">
                      <Sunset className="w-7 h-7 text-orange-400" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Iftar (Rupture)</p>
                      <p className="font-arabic text-lg">الإفطار</p>
                    </div>
                  </div>
                  <p className="text-4xl font-bold font-mono mb-2">{ramadanTimes?.iftar}</p>
                  <p className="text-sm text-muted-foreground">
                    <Clock className="w-4 h-4 inline mr-1" />
                    dans {getTimeUntil(ramadanTimes?.iftar)}
                  </p>
                </Card>
              </div>

              {/* Dua for Iftar */}
              <Card className="p-6 mb-8 text-center">
                <p className="text-sm text-muted-foreground mb-2">Invocation à la rupture du jeûne</p>
                <p className="font-arabic text-xl leading-relaxed rtl mb-4" dir="rtl">
                  ذَهَبَ الظَّمَأُ وَابْتَلَّتِ الْعُرُوقُ، وَثَبَتَ الْأَجْرُ إِنْ شَاءَ اللَّهُ
                </p>
                <p className="text-sm text-muted-foreground italic">
                  "La soif est partie, les veines se sont humidifiées et la récompense est confirmée si Allah le veut."
                </p>
              </Card>

              {/* Quick Links */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <Link to="/quran">
                  <Card className="p-4 text-center hover:shadow-md transition-all hover:-translate-y-1">
                    <BookOpen className="w-8 h-8 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium">Coran</p>
                  </Card>
                </Link>
                <Link to="/duas">
                  <Card className="p-4 text-center hover:shadow-md transition-all hover:-translate-y-1">
                    <Heart className="w-8 h-8 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium">Douas</p>
                  </Card>
                </Link>
                <Link to="/prayer-times">
                  <Card className="p-4 text-center hover:shadow-md transition-all hover:-translate-y-1">
                    <Clock className="w-8 h-8 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium">Prières</p>
                  </Card>
                </Link>
                <Link to="/quiz">
                  <Card className="p-4 text-center hover:shadow-md transition-all hover:-translate-y-1">
                    <Star className="w-8 h-8 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium">Quiz</p>
                  </Card>
                </Link>
              </div>

              {/* Tips */}
              <h2 className="text-2xl font-semibold mb-4">Conseils du Ramadan</h2>
              <div className="space-y-4">
                {tips.map((tip) => (
                  <Card key={tip.id} className="p-6" data-testid={`tip-${tip.id}`}>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <UtensilsCrossed className="w-5 h-5 text-primary" />
                      {tip.title}
                    </h3>
                    <p className="text-muted-foreground">{tip.content}</p>
                  </Card>
                ))}
              </div>
            </>
          )}

          {/* Info */}
          <p className="text-center text-sm text-muted-foreground mt-8">
            <MapPin className="w-4 h-4 inline mr-1" />
            Horaires basés sur votre position
          </p>
        </div>
      </main>
    </div>
  );
};

export default RamadanPage;
