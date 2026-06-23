import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { 
  Brain, 
  CheckCircle, 
  XCircle,
  Trophy,
  Sun,
  Moon,
  Home,
  Sparkles,
  RefreshCw,
  Loader2,
  Target,
  ArrowRight,
  Award,
  RotateCcw
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const categoryNames = {
  piliers: 'Piliers',
  coran: 'Coran',
  priere: 'Prière',
  ramadan: 'Ramadan',
  prophetes: 'Prophètes',
  croyance: 'Croyance',
  general: 'Général'
};

const QuizPage = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, getAuthHeader } = useAuth();
  
  // Quiz states: 'idle' | 'loading' | 'playing' | 'result'
  const [quizState, setQuizState] = useState('idle');
  const [sessionId, setSessionId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answerResult, setAnswerResult] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [stats, setStats] = useState({ total_questions: 0, correct_answers: 0, accuracy: 0 });
  const [activeCategory, setActiveCategory] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const categories = ['piliers', 'coran', 'priere', 'ramadan', 'prophetes', 'croyance'];

  useEffect(() => {
    if (user) fetchStats();
  }, [user]);

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API}/quiz/stats`, { headers: getAuthHeader() });
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const startQuiz = async (category = null) => {
    setQuizState('loading');
    setActiveCategory(category);
    setCurrentIndex(0);
    setAnswers([]);
    setSelectedAnswer(null);
    setAnswerResult(null);

    try {
      const params = category ? `?category=${category}` : '';
      const response = await axios.post(`${API}/quiz/start${params}`);
      setSessionId(response.data.session_id);
      setQuestions(response.data.questions);
      setQuizState('playing');
    } catch (error) {
      console.error('Error starting quiz:', error);
      toast.error('Erreur lors de la génération du quiz');
      setQuizState('idle');
    }
  };

  const submitAnswer = async (answerIndex) => {
    if (selectedAnswer !== null || submitting) return;
    setSelectedAnswer(answerIndex);
    setSubmitting(true);

    try {
      const response = await axios.post(
        `${API}/quiz/session/${sessionId}/answer`,
        { question_index: currentIndex, answer: answerIndex },
        { headers: user ? getAuthHeader() : {} }
      );
      setAnswerResult(response.data);
      setAnswers(prev => [...prev, { index: currentIndex, answer: answerIndex, ...response.data }]);
    } catch (error) {
      console.error('Error submitting answer:', error);
      toast.error('Erreur lors de la soumission');
    } finally {
      setSubmitting(false);
    }
  };

  const nextQuestion = () => {
    if (currentIndex + 1 >= questions.length) {
      setQuizState('result');
      if (user) fetchStats();
    } else {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setAnswerResult(null);
    }
  };

  const correctCount = answers.filter(a => a.correct).length;
  const totalAnswered = answers.length;
  const scorePercent = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

  const currentQuestion = questions[currentIndex];

  // ====== IDLE STATE ======
  if (quizState === 'idle') {
    return (
      <div className="min-h-screen bg-background">
        <Header theme={theme} toggleTheme={toggleTheme} />
        <main className="pt-20 pb-12 px-4">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <Brain className="w-16 h-16 text-primary mx-auto mb-4" />
              <h1 className="text-4xl font-bold mb-2">Quiz Islamique</h1>
              <p className="text-muted-foreground">10 nouvelles questions à chaque tentative</p>
            </div>

            {user && (
              <div className="grid grid-cols-3 gap-4 mb-8">
                <Card className="p-4 text-center" data-testid="stat-total">
                  <p className="text-3xl font-bold text-primary">{stats.total_questions}</p>
                  <p className="text-sm text-muted-foreground">Questions</p>
                </Card>
                <Card className="p-4 text-center" data-testid="stat-accuracy">
                  <p className="text-3xl font-bold text-green-500">{stats.accuracy}%</p>
                  <p className="text-sm text-muted-foreground">Précision</p>
                </Card>
                <Card className="p-4 text-center" data-testid="stat-correct">
                  <p className="text-3xl font-bold text-secondary">{stats.correct_answers}</p>
                  <p className="text-sm text-muted-foreground">Bonnes</p>
                </Card>
              </div>
            )}

            <Card className="p-8 text-center mb-6">
              <Target className="w-12 h-12 text-primary mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Prêt à tester vos connaissances ?</h2>
              <p className="text-muted-foreground mb-6">
                10 questions générées par l'IA. Différentes à chaque fois !
              </p>
              <Button 
                size="lg" 
                className="rounded-full px-8 h-14 text-lg"
                onClick={() => startQuiz(null)}
                data-testid="start-quiz-btn"
              >
                <Brain className="w-5 h-5 mr-2" />
                Commencer le Quiz
              </Button>
            </Card>

            <div className="mb-6">
              <p className="text-sm text-muted-foreground text-center mb-3">Ou choisir une catégorie :</p>
              <div className="flex flex-wrap justify-center gap-2">
                {categories.map((cat) => (
                  <Button
                    key={cat}
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => startQuiz(cat)}
                    data-testid={`start-category-${cat}`}
                  >
                    {categoryNames[cat] || cat}
                  </Button>
                ))}
              </div>
            </div>

            <p className="text-center text-sm text-muted-foreground mt-8">
              {user ? 'Vos statistiques sont sauvegardées' : 'Connectez-vous pour sauvegarder vos statistiques'}
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ====== LOADING STATE ======
  if (quizState === 'loading') {
    return (
      <div className="min-h-screen bg-background">
        <Header theme={theme} toggleTheme={toggleTheme} />
        <main className="pt-20 pb-12 px-4">
          <div className="max-w-2xl mx-auto flex flex-col items-center justify-center py-20">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">Génération des questions...</p>
            <p className="text-sm text-muted-foreground mt-2">L'IA prépare votre quiz</p>
          </div>
        </main>
      </div>
    );
  }

  // ====== RESULT STATE ======
  if (quizState === 'result') {
    const emoji = scorePercent >= 80 ? '🌟' : scorePercent >= 50 ? '👍' : '📚';
    const message = scorePercent >= 80 
      ? 'Excellent ! Vous maîtrisez bien le sujet !' 
      : scorePercent >= 50 
      ? 'Bon travail ! Continuez à apprendre.' 
      : 'Continuez à étudier, vous progresserez !';

    return (
      <div className="min-h-screen bg-background">
        <Header theme={theme} toggleTheme={toggleTheme} />
        <main className="pt-20 pb-12 px-4">
          <div className="max-w-2xl mx-auto">
            <Card className="p-8 text-center mb-6" data-testid="quiz-results">
              <Award className="w-16 h-16 text-primary mx-auto mb-4" />
              <h1 className="text-3xl font-bold mb-2">Résultats du Quiz</h1>
              <p className="text-5xl font-bold text-primary my-6" data-testid="quiz-score">
                {correctCount}/{questions.length}
              </p>
              <p className="text-lg text-muted-foreground mb-2">{scorePercent}% de bonnes réponses</p>
              <p className="text-lg">{emoji} {message}</p>
            </Card>

            {/* Answers review */}
            <div className="space-y-3 mb-8">
              {answers.map((a, idx) => (
                <Card key={idx} className={`p-4 border-l-4 ${a.correct ? 'border-l-green-500' : 'border-l-red-500'}`}>
                  <div className="flex items-start gap-3">
                    {a.correct 
                      ? <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                      : <XCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{questions[a.index]?.question}</p>
                      {!a.correct && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                          Réponse correcte : {a.correct_option}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button 
                size="lg" 
                className="flex-1 rounded-full"
                onClick={() => startQuiz(activeCategory)}
                data-testid="restart-quiz-btn"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Nouveau Quiz
              </Button>
              <Button 
                variant="outline" 
                size="lg" 
                className="flex-1 rounded-full"
                onClick={() => { setQuizState('idle'); setActiveCategory(null); }}
                data-testid="back-to-menu-btn"
              >
                Retour au menu
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ====== PLAYING STATE ======
  return (
    <div className="min-h-screen bg-background">
      <Header theme={theme} toggleTheme={toggleTheme} />
      <main className="pt-20 pb-12 px-4">
        <div className="max-w-2xl mx-auto">
          {/* Progress */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">
                Question {currentIndex + 1} / {questions.length}
              </span>
              <span className="text-sm font-medium text-primary">
                {correctCount} bonne{correctCount !== 1 ? 's' : ''} / {totalAnswered} répondue{totalAnswered !== 1 ? 's' : ''}
              </span>
            </div>
            <Progress value={((currentIndex + 1) / questions.length) * 100} className="h-2" />
          </div>

          {/* Question Card */}
          {currentQuestion && (
            <Card className="p-6" data-testid="quiz-card">
              <div className="flex items-center justify-between mb-6">
                <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm">
                  {categoryNames[currentQuestion.category] || currentQuestion.category}
                </span>
                <span className="text-sm text-muted-foreground">
                  {currentIndex + 1}/{questions.length}
                </span>
              </div>

              <h2 className="text-xl font-semibold mb-6" data-testid="quiz-question-text">
                {currentQuestion.question}
              </h2>

              <div className="space-y-3">
                {currentQuestion.options.map((option, index) => {
                  let optionClass = 'border-border hover:border-primary/50 hover:bg-muted';
                  if (selectedAnswer !== null && answerResult) {
                    if (index === answerResult.correct_answer) {
                      optionClass = 'border-green-500 bg-green-500/10';
                    } else if (index === selectedAnswer && !answerResult.correct) {
                      optionClass = 'border-red-500 bg-red-500/10';
                    } else {
                      optionClass = 'border-border opacity-50';
                    }
                  }
                  return (
                    <button
                      key={index}
                      onClick={() => submitAnswer(index)}
                      disabled={selectedAnswer !== null}
                      className={`w-full p-4 rounded-xl border-2 text-left transition-all ${optionClass} ${selectedAnswer === null ? 'cursor-pointer' : 'cursor-default'}`}
                      data-testid={`quiz-option-${index}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                            {String.fromCharCode(65 + index)}
                          </span>
                          <span>{option}</span>
                        </div>
                        {selectedAnswer !== null && answerResult && index === answerResult.correct_answer && (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        )}
                        {selectedAnswer !== null && answerResult && index === selectedAnswer && !answerResult.correct && (
                          <XCircle className="w-5 h-5 text-red-500" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {answerResult && (
                <div className="mt-6 pt-6 border-t border-border">
                  <div className={`text-center p-4 rounded-xl mb-4 ${
                    answerResult.correct ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                  }`}>
                    {answerResult.correct ? (
                      <div className="flex items-center justify-center gap-2">
                        <CheckCircle className="w-5 h-5" />
                        <span className="font-semibold">Bonne réponse !</span>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-center gap-2 mb-1">
                          <XCircle className="w-5 h-5" />
                          <span className="font-semibold">Mauvaise réponse</span>
                        </div>
                        <p className="text-sm">La bonne réponse était : {answerResult.correct_option}</p>
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={nextQuestion}
                    className="w-full rounded-full"
                    data-testid="next-question-btn"
                  >
                    {currentIndex + 1 >= questions.length ? (
                      <>
                        <Trophy className="w-4 h-4 mr-2" />
                        Voir les résultats
                      </>
                    ) : (
                      <>
                        <ArrowRight className="w-4 h-4 mr-2" />
                        Question suivante
                      </>
                    )}
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

const Header = ({ theme, toggleTheme }) => (
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
);

export default QuizPage;
