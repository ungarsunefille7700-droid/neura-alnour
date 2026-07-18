import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { 
  BookOpen,
  Sun,
  Moon,
  Home,
  Sparkles,
  Loader2,
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  Circle,
  GraduationCap,
  Droplets,
  Clock,
  Heart,
  Star
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const categoryIcons = {
  bases: Star,
  priere: Clock,
  coran: BookOpen,
  douas: Heart
};

const LearnPage = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, getAuthHeader } = useAuth();
  const { t } = useLanguage();
  const [lessons, setLessons] = useState([]);
  const [currentLesson, setCurrentLesson] = useState(null);
  const [currentSection, setCurrentSection] = useState(0);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLessons();
    if (user) {
      fetchProgress();
    }
  }, [user]);

  const fetchLessons = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/learn/lessons`);
      setLessons(response.data);
    } catch (error) {
      console.error('Error fetching lessons:', error);
      toast.error('Erreur lors du chargement des leçons');
    } finally {
      setLoading(false);
    }
  };

  const fetchProgress = async () => {
    try {
      const response = await axios.get(`${API}/learn/progress`, {
        headers: getAuthHeader()
      });
      setProgress(response.data);
    } catch (error) {
      console.error('Error fetching progress:', error);
    }
  };

  const openLesson = (lesson) => {
    // Get saved position
    const savedPosition = progress?.last_position?.[lesson.id] || 0;
    setCurrentSection(savedPosition);
    setCurrentLesson(lesson);
  };

  const saveProgress = async (lessonId, sectionIndex, completed = false) => {
    if (!user) return;
    
    try {
      await axios.post(`${API}/learn/progress?lesson_id=${lessonId}&section_index=${sectionIndex}&completed=${completed}`, {}, {
        headers: getAuthHeader()
      });
      
      // Update local progress
      setProgress(prev => ({
        ...prev,
        current_lesson: lessonId,
        last_position: {
          ...(prev?.last_position || {}),
          [lessonId]: sectionIndex
        },
        completed_lessons: completed 
          ? [...(prev?.completed_lessons || []).filter(id => id !== lessonId), lessonId]
          : (prev?.completed_lessons || [])
      }));
    } catch (error) {
      console.error('Error saving progress:', error);
    }
  };

  const nextSection = () => {
    if (currentLesson && currentSection < currentLesson.content.length - 1) {
      const newSection = currentSection + 1;
      setCurrentSection(newSection);
      saveProgress(currentLesson.id, newSection);
    } else if (currentLesson) {
      // Mark as completed
      saveProgress(currentLesson.id, currentLesson.content.length - 1, true);
      toast.success('Leçon terminée! 🎉');
    }
  };

  const prevSection = () => {
    if (currentSection > 0) {
      const newSection = currentSection - 1;
      setCurrentSection(newSection);
      saveProgress(currentLesson.id, newSection);
    }
  };

  const isLessonCompleted = (lessonId) => {
    return progress?.completed_lessons?.includes(lessonId);
  };

  const getLessonProgress = (lesson) => {
    if (isLessonCompleted(lesson.id)) return 100;
    const position = progress?.last_position?.[lesson.id] || 0;
    return Math.round((position / (lesson.content.length - 1)) * 100);
  };

  const totalProgress = lessons.length > 0 
    ? Math.round((progress?.completed_lessons?.length || 0) / lessons.length * 100)
    : 0;

  if (currentLesson) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="fixed top-0 w-full z-50 glass">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <button 
              onClick={() => setCurrentLesson(null)}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-5 h-5" />
              <span>{t('common.back')}</span>
            </button>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {currentSection + 1} / {currentLesson.content.length}
              </span>
              <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-muted transition-colors">
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </header>

        <main className="pt-20 pb-32 px-4">
          <div className="max-w-2xl mx-auto">
            {/* Lesson Title */}
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold mb-2">{currentLesson.title}</h1>
              <p className="font-arabic text-lg text-muted-foreground">{currentLesson.arabic}</p>
            </div>

            {/* Progress */}
            <div className="mb-8">
              <Progress value={(currentSection / (currentLesson.content.length - 1)) * 100} className="h-2" />
            </div>

            {/* Content */}
            <Card className="p-6 mb-8">
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-primary">
                  {currentLesson.content[currentSection].subtitle}
                </h2>
                
                {currentLesson.content[currentSection].text && (
                  <div className="p-4 bg-muted rounded-xl">
                    <p className="font-arabic text-xl leading-loose text-center rtl" dir="rtl">
                      {currentLesson.content[currentSection].text}
                    </p>
                  </div>
                )}
                
                {currentLesson.content[currentSection].translation && (
                  <div className="p-4 bg-primary/5 rounded-xl">
                    <p className="text-center italic">
                      {currentLesson.content[currentSection].translation}
                    </p>
                  </div>
                )}
                
                {currentLesson.content[currentSection].details && (
                  <p className="text-muted-foreground leading-relaxed">
                    {currentLesson.content[currentSection].details}
                  </p>
                )}
              </div>
            </Card>

            {/* Navigation */}
            <div className="flex items-center justify-between gap-4">
              <Button
                variant="outline"
                onClick={prevSection}
                disabled={currentSection === 0}
                className="rounded-full"
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Précédent
              </Button>
              
              <Button
                onClick={nextSection}
                className="rounded-full"
              >
                {currentSection === currentLesson.content.length - 1 ? (
                  <>
                    Terminer
                    <CheckCircle className="w-4 h-4 ml-2" />
                  </>
                ) : (
                  <>
                    Suivant
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

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
            <GraduationCap className="w-16 h-16 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">تعلم الإسلام</h1>
            <p className="text-xl text-muted-foreground">Apprendre l'Islam</p>
          </div>

          {/* Overall Progress */}
          {user && (
            <Card className="p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-semibold">Votre progression</p>
                  <p className="text-sm text-muted-foreground">
                    {progress?.completed_lessons?.length || 0} / {lessons.length} leçons terminées
                  </p>
                </div>
                <div className="text-3xl font-bold text-primary">
                  {totalProgress}%
                </div>
              </div>
              <Progress value={totalProgress} className="h-3" />
            </Card>
          )}

          {!user && (
            <Card className="p-6 mb-8 bg-primary/5 border-primary/20">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Connectez-vous pour sauvegarder votre progression</p>
                  <p className="text-sm text-muted-foreground">
                    Reprenez exactement là où vous vous êtes arrêté
                  </p>
                </div>
                <Link to="/auth">
                  <Button className="rounded-full">Connexion</Button>
                </Link>
              </div>
            </Card>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              {lessons.map((lesson, index) => {
                const Icon = categoryIcons[lesson.category] || BookOpen;
                const completed = isLessonCompleted(lesson.id);
                const lessonProgress = getLessonProgress(lesson);
                
                return (
                  <Card
                    key={lesson.id}
                    className={`p-4 cursor-pointer hover:shadow-md transition-all hover:-translate-y-1 ${
                      completed ? 'border-green-500/50 bg-green-500/5' : ''
                    }`}
                    onClick={() => openLesson(lesson)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`
                        w-14 h-14 rounded-xl flex items-center justify-center
                        ${completed ? 'bg-green-500/20 text-green-500' : 'bg-primary/10 text-primary'}
                      `}>
                        {completed ? (
                          <CheckCircle className="w-7 h-7" />
                        ) : (
                          <span className="text-2xl font-bold">{index + 1}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold">{lesson.title}</h3>
                        <p className="text-sm text-muted-foreground font-arabic">{lesson.arabic}</p>
                        {lessonProgress > 0 && lessonProgress < 100 && (
                          <div className="mt-2">
                            <Progress value={lessonProgress} className="h-1" />
                          </div>
                        )}
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Info */}
          <p className="text-center text-sm text-muted-foreground mt-8">
            Apprenez à votre rythme • Votre progression est sauvegardée automatiquement
          </p>
        </div>
      </main>
    </div>
  );
};

export default LearnPage;
