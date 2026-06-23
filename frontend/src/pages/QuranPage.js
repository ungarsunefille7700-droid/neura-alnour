import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import { 
  BookOpen, 
  Play, 
  Pause, 
  ChevronLeft, 
  ChevronRight, 
  Search,
  Moon,
  Sun,
  Home,
  Sparkles,
  Volume2,
  SkipBack,
  SkipForward,
  Loader2,
  Repeat
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const QuranPage = () => {
  const { surahNumber } = useParams();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  
  const [surahs, setSurahs] = useState([]);
  const [currentSurah, setCurrentSurah] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [playing, setPlaying] = useState(false);
  const [currentAyah, setCurrentAyah] = useState(0);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [audioLoading, setAudioLoading] = useState(false);
  
  const audioRef = useRef(null);

  useEffect(() => {
    fetchSurahs();
  }, []);

  useEffect(() => {
    if (surahNumber) {
      fetchSurah(parseInt(surahNumber));
    } else {
      setCurrentSurah(null);
    }
  }, [surahNumber]);

  const fetchSurahs = async () => {
    try {
      const response = await axios.get(`${API}/quran/surahs`);
      setSurahs(response.data);
    } catch (error) {
      console.error('Error fetching surahs:', error);
      toast.error('Erreur lors du chargement des sourates');
    }
  };

  const fetchSurah = async (number) => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/quran/surah/${number}`);
      setCurrentSurah(response.data);
      setCurrentAyah(0);
      setPlaying(false);
    } catch (error) {
      console.error('Error fetching surah:', error);
      toast.error('Erreur lors du chargement de la sourate');
    } finally {
      setLoading(false);
    }
  };

  const playAyah = (ayahNum) => {
    if (!currentSurah) return;
    
    const surahStr = String(currentSurah.number).padStart(3, '0');
    const ayahStr = String(ayahNum).padStart(3, '0');
    const audioUrl = `https://everyayah.com/data/Alafasy_128kbps/${surahStr}${ayahStr}.mp3`;
    
    if (audioRef.current) {
      setAudioLoading(true);
      audioRef.current.src = audioUrl;
      audioRef.current.play()
        .then(() => {
          setPlaying(true);
          setCurrentAyah(ayahNum);
          setAudioLoading(false);
        })
        .catch(err => {
          console.error('Audio play error:', err);
          setAudioLoading(false);
          toast.error('Erreur de lecture audio');
        });
    }
  };

  const playAll = () => {
    if (!currentSurah || currentSurah.ayahs.length === 0) return;
    playAyah(1);
  };

  const handleAudioEnd = () => {
    if (!currentSurah) return;
    
    // If there are more ayahs in the current surah
    if (currentAyah < currentSurah.ayahs.length) {
      playAyah(currentAyah + 1);
    } 
    // If surah is finished and auto-play is enabled
    else if (autoPlayNext && currentSurah.number < 114) {
      // Play next surah
      toast.info(`Passage à la sourate ${currentSurah.number + 1}...`);
      navigate(`/quran/${currentSurah.number + 1}`);
      // The useEffect will fetch the new surah, then we start playing
      setTimeout(() => {
        playAyah(1);
      }, 2000);
    } else {
      setPlaying(false);
      setCurrentAyah(0);
      if (currentSurah.number >= 114) {
        toast.success('Fin du Coran! ما شاء الله');
      }
    }
  };

  const pauseAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }
  };

  const togglePlay = () => {
    if (playing) {
      pauseAudio();
    } else if (currentAyah > 0) {
      audioRef.current?.play();
      setPlaying(true);
    } else {
      playAll();
    }
  };

  const skipPrevious = () => {
    if (currentAyah > 1) {
      playAyah(currentAyah - 1);
    } else if (currentSurah && currentSurah.number > 1) {
      navigate(`/quran/${currentSurah.number - 1}`);
    }
  };

  const skipNext = () => {
    if (currentSurah && currentAyah < currentSurah.ayahs.length) {
      playAyah(currentAyah + 1);
    } else if (currentSurah && currentSurah.number < 114) {
      navigate(`/quran/${currentSurah.number + 1}`);
    }
  };

  const filteredSurahs = surahs.filter(surah => 
    surah.name.includes(searchQuery) ||
    surah.englishName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    surah.frenchName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(surah.number).includes(searchQuery)
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 glass">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
            </Link>
            {currentSurah && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => navigate('/quran')}
                className="flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                Sourates
              </Button>
            )}
          </div>
          
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

      <main className="pt-20 pb-32 px-4">
        {!currentSurah ? (
          /* Surahs List View */
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <BookOpen className="w-16 h-16 text-primary mx-auto mb-4" />
              <h1 className="text-4xl font-bold mb-2">القرآن الكريم</h1>
              <p className="text-xl text-muted-foreground">Le Noble Coran</p>
            </div>

            {/* Search */}
            <div className="relative mb-8 max-w-md mx-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher une sourate..."
                className="pl-10 rounded-full"
                data-testid="surah-search"
              />
            </div>

            {/* Surahs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSurahs.map((surah) => (
                <Card
                  key={surah.number}
                  className="p-4 hover:shadow-lg transition-all cursor-pointer hover:-translate-y-1 group"
                  onClick={() => navigate(`/quran/${surah.number}`)}
                  data-testid={`surah-card-${surah.number}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      {surah.number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{surah.frenchName}</h3>
                      <p className="text-sm text-muted-foreground">{surah.ayahs} versets</p>
                    </div>
                    <div className="text-right font-arabic text-xl">
                      {surah.name}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          /* Surah Detail View */
          <div className="max-w-3xl mx-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {/* Surah Header */}
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary font-bold text-2xl mb-4">
                    {currentSurah.number}
                  </div>
                  <h1 className="font-arabic text-4xl mb-2">{currentSurah.name}</h1>
                  <p className="text-xl text-muted-foreground">{currentSurah.englishName}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {currentSurah.ayahs?.length} versets • {currentSurah.revelationType === 'Meccan' ? 'Mecquoise' : 'Médinoise'}
                  </p>
                </div>

                {/* Audio Player */}
                <Card className="p-4 mb-8 glass">
                  <div className="flex flex-col items-center gap-4">
                    {/* Controls */}
                    <div className="flex items-center gap-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={skipPrevious}
                        disabled={currentAyah <= 1 && currentSurah.number <= 1}
                        data-testid="prev-btn"
                      >
                        <SkipBack className="w-5 h-5" />
                      </Button>
                      
                      <Button
                        size="lg"
                        className="rounded-full w-14 h-14"
                        onClick={togglePlay}
                        disabled={audioLoading}
                        data-testid="play-btn"
                      >
                        {audioLoading ? (
                          <Loader2 className="w-6 h-6 animate-spin" />
                        ) : playing ? (
                          <Pause className="w-6 h-6" />
                        ) : (
                          <Play className="w-6 h-6 ml-1" />
                        )}
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={skipNext}
                        disabled={currentSurah.number >= 114 && currentAyah >= currentSurah.ayahs?.length}
                        data-testid="next-btn"
                      >
                        <SkipForward className="w-5 h-5" />
                      </Button>
                    </div>
                    
                    {/* Info */}
                    <p className="text-center text-sm text-muted-foreground">
                      <Volume2 className="w-4 h-4 inline mr-1" />
                      Récitateur: Mishary Rashid Alafasy
                      {currentAyah > 0 && ` • Verset ${currentAyah}/${currentSurah.ayahs?.length}`}
                    </p>
                    
                    {/* Auto-play toggle */}
                    <div className="flex items-center gap-2">
                      <Switch
                        id="autoplay"
                        checked={autoPlayNext}
                        onCheckedChange={setAutoPlayNext}
                        data-testid="autoplay-toggle"
                      />
                      <Label htmlFor="autoplay" className="text-sm flex items-center gap-1">
                        <Repeat className="w-4 h-4" />
                        Lecture automatique de la sourate suivante
                      </Label>
                    </div>
                  </div>
                </Card>

                {/* Bismillah */}
                {currentSurah.number !== 9 && currentSurah.number !== 1 && (
                  <div className="text-center py-6 mb-6 border-b border-border">
                    <p className="font-arabic text-2xl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</p>
                    <p className="text-sm text-muted-foreground mt-2">Au nom d'Allah, le Tout Miséricordieux, le Très Miséricordieux</p>
                  </div>
                )}

                {/* Ayahs */}
                <div className="space-y-8">
                  {currentSurah.ayahs?.map((ayah) => (
                    <div 
                      key={ayah.number}
                      className={`
                        p-6 rounded-2xl transition-all cursor-pointer
                        ${currentAyah === ayah.number ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted'}
                      `}
                      onClick={() => playAyah(ayah.number)}
                      data-testid={`ayah-${ayah.number}`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary text-sm font-medium">
                          {ayah.number}
                        </div>
                        <div className="flex-1">
                          <p className="font-arabic text-2xl leading-loose text-right mb-4 rtl" dir="rtl">
                            {ayah.arabic}
                          </p>
                          <p className="text-muted-foreground leading-relaxed">
                            {ayah.french}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between mt-12 pt-8 border-t border-border">
                  <Button
                    variant="outline"
                    onClick={() => currentSurah.number > 1 && navigate(`/quran/${currentSurah.number - 1}`)}
                    disabled={currentSurah.number <= 1}
                    className="rounded-full"
                  >
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Précédente
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => currentSurah.number < 114 && navigate(`/quran/${currentSurah.number + 1}`)}
                    disabled={currentSurah.number >= 114}
                    className="rounded-full"
                  >
                    Suivante
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        onEnded={handleAudioEnd}
        onError={() => {
          toast.error('Erreur de lecture audio');
          setAudioLoading(false);
        }}
        preload="auto"
      />
    </div>
  );
};

export default QuranPage;
