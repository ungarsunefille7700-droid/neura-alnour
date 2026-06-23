import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import { 
  MapPin,
  Sun,
  Moon,
  Home,
  Sparkles,
  Loader2,
  RefreshCw,
  Navigation,
  ExternalLink,
  Building
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MosquesPage = () => {
  const { theme, toggleTheme } = useTheme();
  const [mosques, setMosques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [locationName, setLocationName] = useState('');
  const [radius, setRadius] = useState(5000);

  useEffect(() => {
    getLocation();
  }, []);

  useEffect(() => {
    if (location) {
      fetchMosques();
      fetchLocationName();
    }
  }, [location, radius]);

  const getLocation = () => {
    setLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => {
          console.error('Geolocation error:', error);
          setLocation({ latitude: 48.8566, longitude: 2.3522 });
          setLocationName('Paris, France (position par défaut)');
          toast.info('Activez la géolocalisation pour trouver les mosquées près de vous');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocation({ latitude: 48.8566, longitude: 2.3522 });
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
      setLocationName(`${city}${city && country ? ', ' : ''}${country}`);
    } catch (error) {
      console.error('Error fetching location name:', error);
    }
  };

  const fetchMosques = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/mosques/nearby`, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude,
          radius: radius
        }
      });
      setMosques(response.data);
    } catch (error) {
      console.error('Error fetching mosques:', error);
      toast.error('Erreur lors de la recherche des mosquées');
    } finally {
      setLoading(false);
    }
  };

  const formatDistance = (meters) => {
    if (meters < 1000) {
      return `${meters} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const openInMaps = (mosque) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${mosque.latitude},${mosque.longitude}`;
    window.open(url, '_blank');
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
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="pt-20 pb-12 px-4">
        <div className="max-w-2xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-8">
            <Building className="w-16 h-16 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">المساجد القريبة</h1>
            <p className="text-xl text-muted-foreground">Mosquées proches</p>
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

          {/* Radius Filter */}
          <div className="flex gap-2 mb-6 flex-wrap justify-center">
            {[2000, 5000, 10000, 20000].map((r) => (
              <Button
                key={r}
                variant={radius === r ? 'default' : 'outline'}
                size="sm"
                className="rounded-full"
                onClick={() => setRadius(r)}
              >
                {r < 1000 ? `${r} m` : `${r / 1000} km`}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Recherche des mosquées...</p>
            </div>
          ) : mosques.length === 0 ? (
            <Card className="p-8 text-center">
              <Building className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">Aucune mosquée trouvée</p>
              <p className="text-muted-foreground mb-4">
                Essayez d'augmenter le rayon de recherche
              </p>
              <Button onClick={() => setRadius(20000)} className="rounded-full">
                Rechercher dans 20 km
              </Button>
            </Card>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4 text-center">
                {mosques.length} mosquée{mosques.length > 1 ? 's' : ''} trouvée{mosques.length > 1 ? 's' : ''} dans un rayon de {formatDistance(radius)}
              </p>
              
              <div className="space-y-3">
                {mosques.map((mosque, index) => (
                  <Card 
                    key={mosque.id || index}
                    className="p-4 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-2xl">🕌</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold truncate">{mosque.name}</h3>
                          {(mosque.address || mosque.city) && (
                            <p className="text-sm text-muted-foreground truncate">
                              {[mosque.address, mosque.city].filter(Boolean).join(', ')}
                            </p>
                          )}
                          <p className="text-sm text-primary font-medium mt-1">
                            <Navigation className="w-3 h-3 inline mr-1" />
                            {formatDistance(mosque.distance)}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full flex-shrink-0"
                        onClick={() => openInMaps(mosque)}
                      >
                        <ExternalLink className="w-4 h-4 mr-1" />
                        Itinéraire
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {/* Info */}
          <p className="text-center text-sm text-muted-foreground mt-8">
            Données fournies par OpenStreetMap
          </p>

          {/* Back link */}
          <div className="text-center mt-4">
            <Link to="/prayer-times" className="text-primary hover:underline">
              ← Retour aux horaires de prière
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default MosquesPage;
