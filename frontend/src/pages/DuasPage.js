import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTheme } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import { 
  Heart, 
  Play, 
  Pause,
  Sun,
  Moon,
  Utensils,
  Shield,
  Plane,
  Sparkles,
  Home,
  Loader2,
  Volume2
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const categoryIcons = {
  morning: Sun,
  evening: Moon,
  sleep: Moon,
  food: Utensils,
  protection: Shield,
  travel: Plane,
  ramadan: Moon,
  eid: Sparkles
};

const categoryNames = {
  morning: 'Matin',
  evening: 'Soir',
  sleep: 'Sommeil',
  food: 'Repas',
  protection: 'Protection',
  travel: 'Voyage',
  ramadan: 'Ramadan',
  eid: 'Aïd'
};

const DuasPage = () => {
  const { theme, toggleTheme } = useTheme();
  const [duas, setDuas] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [playingDua, setPlayingDua] = useState(null);

  useEffect(() => {
    fetchDuas();
    fetchCategories();
  }, []);

  const fetchDuas = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/duas`);
      setDuas(response.data);
    } catch (error) {
      console.error('Error fetching duas:', error);
      toast.error('Erreur lors du chargement des invocations');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await axios.get(`${API}/duas/categories`);
      setCategories(response.data);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const filteredDuas = activeCategory === 'all' 
    ? duas 
    : duas.filter(dua => dua.category === activeCategory);

  const speakDua = (dua) => {
    if ('speechSynthesis' in window) {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      
      if (playingDua === dua.id) {
        setPlayingDua(null);
        return;
      }
      
      const utterance = new SpeechSynthesisUtterance(dua.arabic);
      utterance.lang = 'ar-SA';
      utterance.rate = 0.8;
      
      utterance.onend = () => setPlayingDua(null);
      utterance.onerror = () => {
        setPlayingDua(null);
        toast.error('Erreur de lecture audio');
      };
      
      setPlayingDua(dua.id);
      window.speechSynthesis.speak(utterance);
    } else {
      toast.error('Synthèse vocale non supportée');
    }
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
        <div className="max-w-3xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-8">
            <Heart className="w-16 h-16 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">الأذكار</h1>
            <p className="text-xl text-muted-foreground">Invocations (Douas)</p>
          </div>

          {/* Categories */}
          <div className="mb-8">
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant={activeCategory === 'all' ? 'default' : 'outline'}
                size="sm"
                className="rounded-full"
                onClick={() => setActiveCategory('all')}
                data-testid="category-all"
              >
                Toutes
              </Button>
              {categories.map((category) => {
                const Icon = categoryIcons[category] || Heart;
                return (
                  <Button
                    key={category}
                    variant={activeCategory === category ? 'default' : 'outline'}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setActiveCategory(category)}
                    data-testid={`category-${category}`}
                  >
                    <Icon className="w-4 h-4 mr-1" />
                    {categoryNames[category]}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Duas List */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDuas.map((dua) => {
                const Icon = categoryIcons[dua.category] || Heart;
                return (
                  <Card 
                    key={dua.id}
                    className="p-6 hover:shadow-lg transition-all"
                    data-testid={`dua-${dua.id}`}
                  >
                    {/* Category Badge */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Icon className="w-4 h-4" />
                        <span>{categoryNames[dua.category]}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => speakDua(dua)}
                        className={playingDua === dua.id ? 'text-primary' : ''}
                        data-testid={`play-dua-${dua.id}`}
                      >
                        {playingDua === dua.id ? (
                          <Pause className="w-5 h-5" />
                        ) : (
                          <Volume2 className="w-5 h-5" />
                        )}
                      </Button>
                    </div>

                    {/* Arabic */}
                    <div className="text-center mb-6">
                      <p className="font-arabic text-2xl leading-loose rtl" dir="rtl">
                        {dua.arabic}
                      </p>
                    </div>

                    {/* Transliteration */}
                    <p className="text-sm text-muted-foreground italic mb-4 text-center">
                      {dua.transliteration}
                    </p>

                    {/* French Translation */}
                    <div className="pt-4 border-t border-border">
                      <p className="text-foreground leading-relaxed">
                        {dua.french}
                      </p>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {filteredDuas.length === 0 && !loading && (
            <div className="text-center py-20 text-muted-foreground">
              <Heart className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Aucune invocation trouvée dans cette catégorie</p>
            </div>
          )}

          {/* Info */}
          <p className="text-center text-sm text-muted-foreground mt-8">
            Récitez ces invocations régulièrement pour la protection et la bénédiction
          </p>
        </div>
      </main>
    </div>
  );
};

export default DuasPage;
