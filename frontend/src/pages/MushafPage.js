import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  Search,
  Settings2,
  Star,
  X,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const FIRST_PAGE = 1;
const LAST_PAGE = 604;
const READER_STORAGE_KEY = 'neura-mushaf-reader-v1';
const DEFAULT_PREFERENCES = {
  display: 'both',
  textSize: 32,
  lineHeight: 2.2,
  paper: 'light',
};

const readStoredReader = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(READER_STORAGE_KEY) || '{}');
    return {
      lastPage: Number.isInteger(stored.lastPage) && stored.lastPage >= FIRST_PAGE && stored.lastPage <= LAST_PAGE
        ? stored.lastPage
        : FIRST_PAGE,
      bookmarks: Array.isArray(stored.bookmarks) ? stored.bookmarks : [],
      favorites: Array.isArray(stored.favorites) ? stored.favorites : [],
      history: Array.isArray(stored.history) ? stored.history : [],
      preferences: { ...DEFAULT_PREFERENCES, ...(stored.preferences || {}) },
    };
  } catch {
    return { lastPage: FIRST_PAGE, bookmarks: [], favorites: [], history: [], preferences: DEFAULT_PREFERENCES };
  }
};

const MushafPage = () => {
  const navigate = useNavigate();
  const [readerData, setReaderData] = useState(readStoredReader);
  const [isOpen, setIsOpen] = useState(false);
  const [coverSide, setCoverSide] = useState(() => readStoredReader().lastPage === LAST_PAGE ? 'back' : 'front');
  const [pageNumber, setPageNumber] = useState(() => readStoredReader().lastPage);
  const [pageData, setPageData] = useState(null);
  const [facingPageData, setFacingPageData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [turnDirection, setTurnDirection] = useState('');
  const [savedOpen, setSavedOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [surahs, setSurahs] = useState([]);
  const [referenceType, setReferenceType] = useState('surah');
  const [reference, setReference] = useState('1');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchEdition, setSearchEdition] = useState('fr');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [toolError, setToolError] = useState('');
  const pointerStartX = useRef(null);

  useEffect(() => {
    window.localStorage.setItem(READER_STORAGE_KEY, JSON.stringify(readerData));
  }, [readerData]);

  useEffect(() => {
    if (!toolsOpen || surahs.length) return;
    axios.get(`${API}/mushaf/surahs`)
      .then((response) => setSurahs(response.data.surahs))
      .catch(() => setToolError("L'index authentifié des sourates est indisponible."));
  }, [toolsOpen, surahs.length]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const controller = new AbortController();
    const loadPage = async () => {
      setLoading(true);
      setError('');
      try {
        const requests = [axios.get(`${API}/mushaf/page/${pageNumber}`, {
          params: { translation: 'fr' },
          signal: controller.signal,
        })];
        if (pageNumber < LAST_PAGE) {
          requests.push(axios.get(`${API}/mushaf/page/${pageNumber + 1}`, {
            params: { translation: 'fr' },
            signal: controller.signal,
          }));
        }
        const responses = await Promise.all(requests);
        setPageData(responses[0].data);
        setFacingPageData(responses[1]?.data || null);
      } catch (requestError) {
        if (requestError.code !== 'ERR_CANCELED') {
          setPageData(null);
          setFacingPageData(null);
          setError(
            requestError.response?.data?.detail
              || "Le contenu authentifié n'a pas pu être chargé. Aucun texte de remplacement n'est affiché."
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadPage();
    return () => controller.abort();
  }, [isOpen, pageNumber]);

  useEffect(() => {
    if (!pageData || pageData.page !== pageNumber) return;
    setReaderData((current) => {
      const previous = current.history[0];
      const history = previous?.page === pageNumber
        ? current.history
        : [{ page: pageNumber, readAt: new Date().toISOString() }, ...current.history].slice(0, 30);
      return { ...current, lastPage: pageNumber, history };
    });
  }, [pageData, pageNumber]);

  const changePage = (nextPage) => {
    if (nextPage < FIRST_PAGE || nextPage > LAST_PAGE || nextPage === pageNumber) return;
    setTurnDirection(nextPage > pageNumber ? 'turn-forward' : 'turn-backward');
    setPageNumber(nextPage);
    window.setTimeout(() => setTurnDirection(''), 420);
  };

  const finishPageGesture = (clientX) => {
    if (pointerStartX.current === null) return;
    const distance = clientX - pointerStartX.current;
    pointerStartX.current = null;
    if (Math.abs(distance) < 60) return;
    changePage(distance < 0 ? pageNumber + 1 : pageNumber - 1);
  };

  const toggleBookmark = () => {
    setReaderData((current) => ({
      ...current,
      bookmarks: current.bookmarks.includes(pageNumber)
        ? current.bookmarks.filter((page) => page !== pageNumber)
        : [...current.bookmarks, pageNumber].sort((a, b) => a - b),
    }));
  };

  const toggleFavorite = (ayah, favoritePage = pageNumber) => {
    setReaderData((current) => {
      const exists = current.favorites.some((favorite) => favorite.ayah === ayah.number);
      return {
        ...current,
        favorites: exists
          ? current.favorites.filter((favorite) => favorite.ayah !== ayah.number)
          : [...current.favorites, {
              ayah: ayah.number,
              numberInSurah: ayah.numberInSurah,
              page: favoritePage,
              surahNumber: ayah.surah?.number,
              surahName: ayah.surah?.englishName,
            }],
      };
    });
  };

  const updatePreference = (key, value) => {
    setReaderData((current) => ({
      ...current,
      preferences: { ...current.preferences, [key]: value },
    }));
  };

  const locateReference = async () => {
    if (!reference) return;
    setToolError('');
    try {
      const response = await axios.get(`${API}/mushaf/locate/${referenceType}/${encodeURIComponent(reference)}`);
      changePage(response.data.page);
      setToolsOpen(false);
    } catch (requestError) {
      setToolError(requestError.response?.data?.detail || "Cette référence n'a pas pu être chargée.");
    }
  };

  const runSearch = async (event) => {
    event.preventDefault();
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    setToolError('');
    try {
      const response = await axios.get(`${API}/mushaf/search`, {
        params: { q: searchQuery.trim(), edition: searchEdition },
      });
      setSearchResults(response.data.results);
    } catch (requestError) {
      setSearchResults([]);
      setToolError(requestError.response?.data?.detail || 'La recherche authentifiée est indisponible.');
    } finally {
      setSearching(false);
    }
  };

  const preferences = readerData.preferences || DEFAULT_PREFERENCES;
  const darkPaper = preferences.paper === 'dark';

  return (
    <main className="min-h-screen bg-[#07100d] text-[#f5efdc] overflow-hidden">
      <header className="h-16 border-b border-emerald-100/10 flex items-center justify-between px-4 md:px-8">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="w-10 h-10 grid place-items-center rounded-md hover:bg-white/10 transition-colors"
          aria-label="Retour à l'accueil"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <h1 className="font-semibold text-base md:text-lg">Le Saint Coran</h1>
          <p className="text-[11px] text-emerald-100/60">Moushaf numérique authentifié</p>
        </div>
        <div className="w-10" aria-hidden="true" />
      </header>

      <section className="min-h-[calc(100vh-4rem)] px-3 py-6 md:p-8 flex items-center justify-center">
        {!isOpen ? (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="group relative w-[min(78vw,360px)] aspect-[3/4.35] text-left perspective-1000"
            data-testid="mushaf-open-cover"
          >
            <span className="absolute inset-y-3 -left-3 w-5 rounded-l-md bg-[#8b6b32] shadow-xl" />
            <span className="absolute inset-0 rounded-r-md border border-[#d5b76f]/70 bg-[#123d2d] shadow-2xl shadow-black/60 transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-1">
              <span className="absolute inset-4 rounded-sm border-2 border-[#c9a85f]" />
              <span className="absolute inset-7 rounded-sm border border-[#c9a85f]/70" />
              {coverSide === 'front' ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center text-center px-12">
                  <BookOpen className="w-10 h-10 text-[#d8bb72] mb-8" />
                  <span className="font-arabic text-4xl text-[#f2d891] leading-relaxed" lang="ar" dir="rtl">
                    القرآن الكريم
                  </span>
                  <span className="mt-5 text-sm tracking-[0.2em] uppercase text-[#e8d7a9]">
                    Le Saint Coran
                  </span>
                  <span className="mt-10 text-xs text-[#d8c69b]/70">Appuyer pour ouvrir</span>
                </span>
              ) : (
                <span className="absolute inset-0 flex flex-col items-center justify-center text-center px-12">
                  <span className="w-24 h-24 rotate-45 border border-[#c9a85f] grid place-items-center">
                    <span className="w-14 h-14 border border-[#c9a85f]/70" />
                  </span>
                  <span className="mt-14 text-sm tracking-[0.16em] uppercase text-[#e8d7a9]">Fin du Moushaf</span>
                  <span className="mt-4 text-xs text-[#d8c69b]/70">Appuyer pour le rouvrir</span>
                </span>
              )}
            </span>
          </button>
        ) : (
          <div className="w-full max-w-6xl">
            <div className="flex items-center justify-between gap-3 mb-4">
              <button
                type="button"
                onClick={() => {
                  setCoverSide(pageNumber === LAST_PAGE ? 'back' : 'front');
                  setIsOpen(false);
                }}
                className="inline-flex items-center gap-2 h-10 px-3 rounded-md border border-white/10 hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline">Fermer le livre</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleBookmark}
                  className={`w-10 h-10 grid place-items-center rounded-md border transition-colors ${readerData.bookmarks.includes(pageNumber) ? 'border-[#d8bb72] bg-[#d8bb72]/20 text-[#f2d891]' : 'border-white/10 hover:bg-white/10'}`}
                  aria-label={readerData.bookmarks.includes(pageNumber) ? 'Retirer le marque-page' : 'Ajouter un marque-page'}
                  title={readerData.bookmarks.includes(pageNumber) ? 'Retirer le marque-page' : 'Ajouter un marque-page'}
                >
                  <Bookmark className="w-4 h-4" fill={readerData.bookmarks.includes(pageNumber) ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  onClick={() => setSavedOpen((current) => !current)}
                  className="w-10 h-10 grid place-items-center rounded-md border border-white/10 hover:bg-white/10 transition-colors"
                  aria-label="Ouvrir les lectures enregistrées"
                  title="Lectures enregistrées"
                >
                  <History className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setToolsOpen((current) => !current)}
                  className="w-10 h-10 grid place-items-center rounded-md border border-white/10 hover:bg-white/10 transition-colors"
                  aria-label="Recherche et réglages"
                  title="Recherche et réglages"
                >
                  <Settings2 className="w-4 h-4" />
                </button>
              </div>
              <label className="flex items-center gap-2 text-sm text-emerald-50/70">
                <span>Page</span>
                <input
                  type="number"
                  min={FIRST_PAGE}
                  max={LAST_PAGE}
                  value={pageNumber}
                  onChange={(event) => changePage(Number(event.target.value))}
                  className="w-20 h-10 rounded-md border border-white/10 bg-black/20 px-2 text-center text-white outline-none focus:border-[#c9a85f]"
                  aria-label="Aller à une page"
                />
                <span>/ {LAST_PAGE}</span>
              </label>
            </div>

            {savedOpen && (
              <aside className="mb-4 rounded-md border border-white/10 bg-black/25 p-4" data-testid="mushaf-saved-panel">
                <div className="grid gap-5 md:grid-cols-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[#f2d891] mb-2">Dernière lecture</h2>
                    <button type="button" onClick={() => changePage(readerData.lastPage)} className="text-sm hover:underline">
                      Page {readerData.lastPage}
                    </button>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[#f2d891] mb-2">Marque-pages</h2>
                    {readerData.bookmarks.length === 0 ? (
                      <p className="text-xs text-white/50">Aucun marque-page</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {readerData.bookmarks.map((page) => (
                          <button key={page} type="button" onClick={() => changePage(page)} className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/15">
                            Page {page}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[#f2d891] mb-2">Historique récent</h2>
                    {readerData.history.length === 0 ? (
                      <p className="text-xs text-white/50">Aucune lecture</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {readerData.history.slice(0, 8).map((entry) => (
                          <button key={`${entry.page}-${entry.readAt}`} type="button" onClick={() => changePage(entry.page)} className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/15">
                            Page {entry.page}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-white/10">
                  <h2 className="text-sm font-semibold text-[#f2d891] mb-2">Versets favoris</h2>
                  {readerData.favorites.length === 0 ? (
                    <p className="text-xs text-white/50">Aucun favori</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {readerData.favorites.map((favorite) => (
                        <button key={favorite.ayah} type="button" onClick={() => changePage(favorite.page)} className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/15">
                          {favorite.surahName || `Sourate ${favorite.surahNumber}`} · verset {favorite.numberInSurah}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </aside>
            )}

            {toolsOpen && (
              <aside className="mb-4 rounded-md border border-white/10 bg-black/25 p-4" data-testid="mushaf-tools-panel">
                <div className="grid gap-6 lg:grid-cols-3">
                  <section>
                    <h2 className="text-sm font-semibold text-[#f2d891] mb-3">Aller directement à</h2>
                    <div className="flex gap-2">
                      <select
                        value={referenceType}
                        onChange={(event) => {
                          setReferenceType(event.target.value);
                          setReference(event.target.value === 'ayah' ? '2:255' : '1');
                        }}
                        className="h-10 rounded-md border border-white/10 bg-[#10251d] px-2 text-sm"
                        aria-label="Type de référence"
                      >
                        <option value="surah">Sourate</option>
                        <option value="juz">Juz</option>
                        <option value="hizb">Hizb</option>
                        <option value="ayah">Verset</option>
                        <option value="page">Page</option>
                      </select>
                      {referenceType === 'surah' && surahs.length ? (
                        <select value={reference} onChange={(event) => setReference(event.target.value)} className="min-w-0 flex-1 h-10 rounded-md border border-white/10 bg-[#10251d] px-2 text-sm" aria-label="Choisir une sourate">
                          {surahs.map((surah) => (
                            <option key={surah.number} value={surah.number}>{surah.number}. {surah.englishName} · {surah.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={referenceType === 'ayah' ? '2:255' : '1'} className="min-w-0 flex-1 h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm" aria-label="Référence" />
                      )}
                      <button type="button" onClick={locateReference} className="h-10 px-3 rounded-md bg-[#c9a85f] text-[#172018] text-sm font-medium">Aller</button>
                    </div>
                  </section>

                  <form onSubmit={runSearch}>
                    <h2 className="text-sm font-semibold text-[#f2d891] mb-3">Rechercher un mot</h2>
                    <div className="flex gap-2">
                      <select value={searchEdition} onChange={(event) => setSearchEdition(event.target.value)} className="h-10 rounded-md border border-white/10 bg-[#10251d] px-2 text-sm" aria-label="Édition de recherche">
                        <option value="fr">Français · Hamidullah</option>
                        <option value="ar">Arabe · Uthmani</option>
                      </select>
                      <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="min-w-0 flex-1 h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm" placeholder="Mot exact" aria-label="Mot à rechercher" />
                      <button type="submit" disabled={searching} className="w-10 h-10 grid place-items-center rounded-md bg-[#c9a85f] text-[#172018] disabled:opacity-50" aria-label="Lancer la recherche">
                        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      </button>
                    </div>
                  </form>

                  <section>
                    <h2 className="text-sm font-semibold text-[#f2d891] mb-3">Affichage</h2>
                    <div className="grid gap-3">
                      <select value={preferences.display} onChange={(event) => updatePreference('display', event.target.value)} className="h-10 rounded-md border border-white/10 bg-[#10251d] px-2 text-sm" aria-label="Mode d'affichage">
                        <option value="both">Arabe + français</option>
                        <option value="arabic">Arabe uniquement</option>
                        <option value="translation">Français uniquement</option>
                      </select>
                      <label className="text-xs text-white/70">Taille du texte : {preferences.textSize}px
                        <input type="range" min="24" max="48" step="2" value={preferences.textSize} onInput={(event) => updatePreference('textSize', Number(event.currentTarget.value))} className="block w-full mt-1" aria-label="Taille du texte" />
                      </label>
                      <label className="text-xs text-white/70">Espacement : {preferences.lineHeight}
                        <input type="range" min="1.6" max="2.8" step="0.2" value={preferences.lineHeight} onInput={(event) => updatePreference('lineHeight', Number(event.currentTarget.value))} className="block w-full mt-1" aria-label="Espacement des lignes" />
                      </label>
                      <select value={preferences.paper} onChange={(event) => updatePreference('paper', event.target.value)} className="h-10 rounded-md border border-white/10 bg-[#10251d] px-2 text-sm" aria-label="Thème des pages">
                        <option value="light">Pages claires</option>
                        <option value="dark">Pages sombres</option>
                      </select>
                    </div>
                  </section>
                </div>

                {toolError && <p className="mt-4 text-sm text-red-300">{toolError}</p>}
                {searchResults.length > 0 && (
                  <section className="mt-5 pt-4 border-t border-white/10">
                    <h2 className="text-sm font-semibold text-[#f2d891] mb-3">Résultats authentifiés</h2>
                    <div className="max-h-64 overflow-y-auto grid gap-2">
                      {searchResults.map((result) => (
                        <button key={`${searchEdition}-${result.number}`} type="button" onClick={() => { changePage(result.page); setToolsOpen(false); }} className="text-left p-3 rounded-md bg-white/5 hover:bg-white/10">
                          <span className="block text-xs text-[#d8bb72] mb-1">{result.surah.englishName} {result.surah.number}:{result.numberInSurah} · page {result.page}</span>
                          <span className={`block text-sm leading-6 ${searchEdition === 'ar' ? 'font-arabic text-right text-lg' : ''}`} dir={searchEdition === 'ar' ? 'rtl' : 'ltr'}>{result.text}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </aside>
            )}

            <div className="relative mx-auto flex max-w-6xl min-h-[68vh] rounded-md bg-[#6f5326] p-1.5 shadow-2xl shadow-black/70">
              <div className="absolute left-1/2 top-2 bottom-2 hidden md:block w-3 -translate-x-1/2 bg-gradient-to-r from-black/30 via-[#d8c492]/30 to-black/30 z-20 pointer-events-none" />
              {facingPageData && !loading && !error && (
                <article
                  className={`hidden md:block md:w-1/2 order-1 rounded-l-sm px-8 py-10 overflow-y-auto ${darkPaper ? 'bg-[#161915] text-[#eee7d1]' : 'bg-[#fbf5df] text-[#252015]'}`}
                  data-testid="mushaf-facing-page"
                >
                  <div className="mb-6 text-center border-b border-[#b7a77f]/45 pb-4">
                    <p className="text-xs uppercase tracking-wider text-[#766b52]">
                      Page {facingPageData.page} · Édition arabe {facingPageData.arabicEdition}
                    </p>
                    <p className="mt-1 text-xs text-[#766b52]">
                      Traduction : {facingPageData.translation.translator} ({facingPageData.translation.edition})
                    </p>
                  </div>
                  <div className="space-y-7">
                    {facingPageData.ayahs.map((ayah) => (
                      <section key={ayah.number} className="border-b border-[#b7a77f]/30 pb-6 last:border-0">
                        <div className="flex justify-end mb-1">
                          <button
                            type="button"
                            onClick={() => toggleFavorite(ayah, facingPageData.page)}
                            className="w-8 h-8 grid place-items-center rounded-md text-[#967b3d] hover:bg-[#967b3d]/10"
                            aria-label={readerData.favorites.some((favorite) => favorite.ayah === ayah.number) ? `Retirer le verset ${ayah.numberInSurah} des favoris` : `Ajouter le verset ${ayah.numberInSurah} aux favoris`}
                            title="Favori"
                          >
                            <Star className="w-4 h-4" fill={readerData.favorites.some((favorite) => favorite.ayah === ayah.number) ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                        {preferences.display !== 'translation' && <p
                          className={`font-arabic text-right ${darkPaper ? 'text-[#f4eddc]' : 'text-[#17130d]'}`}
                          lang="ar"
                          dir="rtl"
                          style={{ fontSize: `${preferences.textSize}px`, lineHeight: preferences.lineHeight }}
                        >
                          {ayah.arabic}
                          <span className="inline-grid place-items-center min-w-8 h-8 mx-2 rounded-full border border-[#967b3d] text-sm font-sans align-middle">
                            {ayah.numberInSurah}
                          </span>
                        </p>}
                        {preferences.display !== 'arabic' && <p className={`mt-4 text-base leading-8 ${darkPaper ? 'text-[#d4cdbb]' : 'text-[#514936]'}`}>
                          {ayah.translation}
                        </p>}
                      </section>
                    ))}
                  </div>
                  <footer className="mt-8 pt-4 border-t border-[#b7a77f]/45 text-center text-xs text-[#766b52]">
                    Source : {facingPageData.source}
                  </footer>
                </article>
              )}
              <article
                className={`relative w-full md:w-1/2 order-2 rounded-sm md:rounded-r-sm px-5 py-7 md:px-8 md:py-10 overflow-y-auto transition-colors ${darkPaper ? 'bg-[#161915] text-[#eee7d1]' : 'bg-[#fbf5df] text-[#252015]'} ${turnDirection}`}
                data-testid="mushaf-page"
                onPointerDown={(event) => { pointerStartX.current = event.clientX; }}
                onPointerUp={(event) => finishPageGesture(event.clientX)}
                onPointerCancel={() => { pointerStartX.current = null; }}
                style={{ touchAction: 'pan-y' }}
              >
                {loading && (
                  <div className={`absolute inset-0 z-30 grid place-items-center ${darkPaper ? 'bg-[#161915]' : 'bg-[#fbf5df]'}`}>
                    <div className="text-center text-[#71664f]">
                      <Loader2 className="w-7 h-7 animate-spin mx-auto mb-3" />
                      <p>Chargement de la page authentifiée...</p>
                    </div>
                  </div>
                )}

                {!loading && error && (
                  <div className="min-h-[55vh] grid place-items-center text-center">
                    <div className="max-w-lg">
                      <p className="font-semibold text-red-800 mb-2">Page indisponible</p>
                      <p className="text-sm text-[#71664f]">{error}</p>
                    </div>
                  </div>
                )}

                {!loading && pageData && (
                  <>
                    <div className="mb-6 text-center border-b border-[#b7a77f]/45 pb-4">
                      <p className="text-xs uppercase tracking-wider text-[#766b52]">
                        Page {pageData.page} · Édition arabe {pageData.arabicEdition}
                      </p>
                      <p className="mt-1 text-xs text-[#766b52]">
                        Traduction : {pageData.translation.translator} ({pageData.translation.edition})
                      </p>
                    </div>
                    <div className="space-y-7">
                      {pageData.ayahs.map((ayah) => (
                        <section key={ayah.number} className="border-b border-[#b7a77f]/30 pb-6 last:border-0">
                          <div className="flex justify-end mb-1">
                            <button
                              type="button"
                              onClick={() => toggleFavorite(ayah)}
                              className="w-8 h-8 grid place-items-center rounded-md text-[#967b3d] hover:bg-[#967b3d]/10"
                              aria-label={readerData.favorites.some((favorite) => favorite.ayah === ayah.number) ? `Retirer le verset ${ayah.numberInSurah} des favoris` : `Ajouter le verset ${ayah.numberInSurah} aux favoris`}
                              title="Favori"
                            >
                              <Star className="w-4 h-4" fill={readerData.favorites.some((favorite) => favorite.ayah === ayah.number) ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                          {preferences.display !== 'translation' && <p
                            className={`font-arabic text-right ${darkPaper ? 'text-[#f4eddc]' : 'text-[#17130d]'}`}
                            lang="ar"
                            dir="rtl"
                            style={{ fontSize: `${preferences.textSize}px`, lineHeight: preferences.lineHeight }}
                          >
                            {ayah.arabic}
                            <span className="inline-grid place-items-center min-w-8 h-8 mx-2 rounded-full border border-[#967b3d] text-sm font-sans align-middle">
                              {ayah.numberInSurah}
                            </span>
                          </p>}
                          {preferences.display !== 'arabic' && <p className={`mt-4 text-base md:text-lg leading-8 ${darkPaper ? 'text-[#d4cdbb]' : 'text-[#514936]'}`}>
                            {ayah.translation}
                          </p>}
                        </section>
                      ))}
                    </div>
                    <footer className="mt-8 pt-4 border-t border-[#b7a77f]/45 text-center text-xs text-[#766b52]">
                      Source : {pageData.source}
                    </footer>
                  </>
                )}
              </article>
            </div>

            <div className="flex items-center justify-center gap-4 mt-5">
              <button
                type="button"
                onClick={() => changePage(pageNumber - 1)}
                disabled={pageNumber === FIRST_PAGE || loading}
                className="w-11 h-11 grid place-items-center rounded-md border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Page précédente"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="min-w-24 text-center text-sm">{pageNumber} / {LAST_PAGE}</span>
              <button
                type="button"
                onClick={() => changePage(pageNumber + 1)}
                disabled={pageNumber === LAST_PAGE || loading}
                className="w-11 h-11 grid place-items-center rounded-md border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Page suivante"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </section>

      <style>{`
        .perspective-1000 { perspective: 1000px; }
        .turn-forward { animation: mushafTurnForward 420ms ease both; transform-origin: left center; }
        .turn-backward { animation: mushafTurnBackward 420ms ease both; transform-origin: right center; }
        @keyframes mushafTurnForward {
          0% { transform: rotateY(0deg); opacity: 1; }
          48% { transform: rotateY(-8deg) scaleX(.985); opacity: .55; }
          100% { transform: rotateY(0deg); opacity: 1; }
        }
        @keyframes mushafTurnBackward {
          0% { transform: rotateY(0deg); opacity: 1; }
          48% { transform: rotateY(8deg) scaleX(.985); opacity: .55; }
          100% { transform: rotateY(0deg); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .turn-forward, .turn-backward { animation: none; }
        }
      `}</style>
    </main>
  );
};

export default MushafPage;
