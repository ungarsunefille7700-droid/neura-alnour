import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock3, Heart, Play, RotateCcw, Search, Video } from 'lucide-react';
import { REMINDERS } from '@/data/reminders';

const FAVORITES_KEY = 'neura_reminder_favorites';
const HISTORY_KEY = 'neura_reminder_history';

function readStoredList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

export default function RemindersPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(REMINDERS[0]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Tous');
  const [favorites, setFavorites] = useState(() => readStoredList(FAVORITES_KEY));
  const [history, setHistory] = useState(() => readStoredList(HISTORY_KEY));
  const [mediaError, setMediaError] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);

  const categories = useMemo(
    () => ['Tous', ...new Set(REMINDERS.map((item) => item.category))],
    []
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr');
    return REMINDERS.filter((item) => (
      (category === 'Tous' || item.category === category)
      && (!normalized || `${item.title} ${item.description}`.toLocaleLowerCase('fr').includes(normalized))
    ));
  }, [category, query]);

  const selectVideo = (item) => {
    setSelected(item);
    setMediaError(false);
    setPlayerKey((value) => value + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const rememberWatched = () => {
    if (history.includes(selected.id)) return;
    const next = [selected.id, ...history].slice(0, 20);
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  };

  const toggleFavorite = (id) => {
    const next = favorites.includes(id)
      ? favorites.filter((item) => item !== id)
      : [id, ...favorites];
    setFavorites(next);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  };

  const retry = () => {
    setMediaError(false);
    setPlayerKey((value) => value + 1);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-muted" aria-label="Retour">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Video className="w-5 h-5 text-primary" />
          <h1 className="font-bold text-lg sm:text-xl">Rappels</h1>
          <span className="ml-auto text-xs sm:text-sm text-muted-foreground">{REMINDERS.length} vidéos</span>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        <div className="aspect-video w-full bg-black overflow-hidden rounded-lg relative">
          {!mediaError ? (
            <video
              key={playerKey}
              className="w-full h-full object-contain"
              controls
              preload="none"
              poster={selected.poster}
              playsInline
              onPlay={rememberWatched}
              onError={() => setMediaError(true)}
              data-testid="reminder-player"
            >
              <source src={selected.videoUrl} type="video/mp4" />
              Votre navigateur ne prend pas en charge la lecture vidéo.
            </video>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-6 bg-muted/20">
              <p>Cette vidéo n’a pas pu être chargée.</p>
              <button onClick={retry} className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2">
                <RotateCcw className="w-4 h-4" /> Réessayer
              </button>
            </div>
          )}
        </div>
        <div className="py-4 flex items-start gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-primary mb-1">{selected.category}</p>
            <h2 className="text-xl sm:text-2xl font-bold">{selected.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{selected.description}</p>
          </div>
          <button
            onClick={() => toggleFavorite(selected.id)}
            className="ml-auto shrink-0 p-2 rounded-full border border-border hover:bg-muted"
            aria-label={favorites.includes(selected.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            title={favorites.includes(selected.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            <Heart className={`w-5 h-5 ${favorites.includes(selected.id) ? 'fill-primary text-primary' : ''}`} />
          </button>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-12">
        <div className="py-4 border-y border-border flex flex-col md:flex-row gap-3 md:items-center">
          <label className="relative flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un rappel…"
              className="w-full h-10 rounded-md bg-muted border border-border pl-10 pr-3 outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`h-10 px-3 rounded-md whitespace-nowrap text-sm ${category === item ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {filtered.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pt-6">
            {filtered.map((item) => (
              <article key={item.id} className="border border-border rounded-lg overflow-hidden bg-card">
                <button onClick={() => selectVideo(item)} className="block w-full text-left group">
                  <div className="aspect-video relative bg-black overflow-hidden">
                    <img src={item.poster} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25 transition-colors">
                      <span className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </span>
                    </span>
                    <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                      <Clock3 className="w-3 h-3" /> {item.duration}
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-tight">{item.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                      </div>
                      {history.includes(item.id) && <span className="text-[10px] text-primary shrink-0">Vu</span>}
                    </div>
                  </div>
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="py-12 text-center text-muted-foreground">Aucun rappel ne correspond à cette recherche.</p>
        )}
      </section>
    </main>
  );
}
