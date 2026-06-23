import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import { 
  Compass,
  MapPin,
  Sun,
  Moon,
  Home,
  Sparkles,
  Loader2,
  RefreshCw,
  Navigation
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const QiblahPage = () => {
  const { theme, toggleTheme } = useTheme();
  const [qiblahDirection, setQiblahDirection] = useState(null);
  const [deviceHeading, setDeviceHeading] = useState(0);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [locationName, setLocationName] = useState('');
  const [compassSupported, setCompassSupported] = useState(true);

  useEffect(() => {
    getLocation();
    
    // Check if device orientation is supported
    if (window.DeviceOrientationEvent) {
      // Request permission on iOS
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        setCompassSupported(true);
      }
      
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
    } else {
      setCompassSupported(false);
    }

    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, []);

  useEffect(() => {
    if (location) {
      fetchQiblah();
      fetchLocationName();
    }
  }, [location]);

  const handleOrientation = (event) => {
    let heading = event.alpha;
    
    // For iOS, we need to handle webkitCompassHeading
    if (event.webkitCompassHeading) {
      heading = event.webkitCompassHeading;
    }
    
    if (heading !== null) {
      setDeviceHeading(heading);
    }
  };

  const requestCompassPermission = async () => {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission === 'granted') {
          toast.success('Boussole activée');
        }
      } catch (error) {
        console.error('Compass permission error:', error);
        toast.error('Impossible d\'activer la boussole');
      }
    }
  };

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
          toast.info('Activez la géolocalisation pour une direction précise');
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

  const fetchQiblah = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/qiblah`, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude
        }
      });
      setQiblahDirection(response.data.direction);
    } catch (error) {
      console.error('Error fetching qiblah:', error);
      toast.error('Erreur lors du calcul de la Qiblah');
    } finally {
      setLoading(false);
    }
  };

  // Calculate the rotation for the Qiblah arrow
  const getQiblahRotation = () => {
    if (qiblahDirection === null) return 0;
    return qiblahDirection - deviceHeading;
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
        <div className="max-w-md mx-auto">
          {/* Hero */}
          <div className="text-center mb-8">
            <Compass className="w-16 h-16 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">القبلة</h1>
            <p className="text-xl text-muted-foreground">Direction de la Qiblah</p>
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

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Compass */}
              <Card className="p-8 mb-6">
                <div className="relative w-64 h-64 mx-auto">
                  {/* Compass Background */}
                  <div className="absolute inset-0 rounded-full border-4 border-muted">
                    {/* Cardinal directions */}
                    <span className="absolute top-2 left-1/2 -translate-x-1/2 text-sm font-bold">N</span>
                    <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-sm font-bold">S</span>
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm font-bold">O</span>
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold">E</span>
                  </div>
                  
                  {/* Qiblah Arrow */}
                  <div 
                    className="absolute inset-4 flex items-center justify-center transition-transform duration-300"
                    style={{ transform: `rotate(${getQiblahRotation()}deg)` }}
                  >
                    <div className="relative w-full h-full flex items-center justify-center">
                      {/* Arrow pointing to Qiblah */}
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[20px] border-l-transparent border-r-[20px] border-r-transparent border-b-[80px] border-b-primary" />
                      {/* Kaaba icon at center */}
                      <div className="w-12 h-12 bg-secondary rounded-lg flex items-center justify-center">
                        <span className="text-secondary-foreground font-arabic text-lg">🕋</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Direction info */}
                <div className="text-center mt-6">
                  <p className="text-sm text-muted-foreground">Direction de La Mecque</p>
                  <p className="text-3xl font-bold text-primary">{qiblahDirection?.toFixed(1)}°</p>
                </div>
              </Card>

              {/* iOS Permission Button */}
              {typeof DeviceOrientationEvent !== 'undefined' && 
               typeof DeviceOrientationEvent.requestPermission === 'function' && (
                <Button 
                  onClick={requestCompassPermission}
                  className="w-full mb-6 rounded-full"
                >
                  <Compass className="w-4 h-4 mr-2" />
                  Activer la boussole (iOS)
                </Button>
              )}

              {/* Instructions */}
              <Card className="p-6">
                <h3 className="font-semibold mb-4">Comment utiliser</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="text-primary">1.</span>
                    <span>Tenez votre téléphone à plat devant vous</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">2.</span>
                    <span>La flèche indique la direction de La Mecque (Kaaba)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">3.</span>
                    <span>Tournez-vous jusqu'à ce que la flèche pointe vers le haut</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">4.</span>
                    <span>Vous êtes maintenant face à la Qiblah pour prier</span>
                  </li>
                </ul>
              </Card>

              {/* Distance to Mecca */}
              {location && (
                <Card className="p-4 mt-6 text-center">
                  <p className="text-sm text-muted-foreground">Distance jusqu'à La Mecque</p>
                  <p className="text-xl font-bold">
                    {Math.round(
                      6371 * Math.acos(
                        Math.sin(location.latitude * Math.PI / 180) * Math.sin(21.4225 * Math.PI / 180) +
                        Math.cos(location.latitude * Math.PI / 180) * Math.cos(21.4225 * Math.PI / 180) *
                        Math.cos((39.8262 - location.longitude) * Math.PI / 180)
                      )
                    ).toLocaleString()} km
                  </p>
                </Card>
              )}
            </>
          )}

          {/* Back link */}
          <div className="text-center mt-8">
            <Link to="/prayer-times" className="text-primary hover:underline">
              ← Retour aux horaires de prière
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default QiblahPage;
