import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp } from '@/components/motion/Motion';
import { Button, EmptyState, Icon, useConfirm } from '@/components/ui';
import { QuizSetup } from '@/components/features/quiz/QuizSetup';
import { QuizSession } from '@/components/features/quiz/QuizSession';
import { QuizResults } from '@/components/features/quiz/QuizResults';
import { useProgress } from '@/hooks/useProgress';
import { recordQuizResults } from '@/data/repositories/quiz';
import { weakPoints } from '@/core/progress';
import { upcomingEvaluations } from '@/core/progress/exam';
import {
  buildQuiz,
  summarizeQuiz,
  type QuizAnswerRecord,
  type QuizBuildResult,
  type QuizDifficulty,
  type QuizFormat,
  type QuizResult,
  type QuizScope,
} from '@/core/quiz';
import type { ID } from '@/types';

/**
 * QUIZ — choisir ce que je veux tester → commencer → question / réponse /
 * correction → résultats.
 *
 * Machine à trois écrans, comme la séance de révision (`RevisionsPage`) :
 * `setup` (aucun quiz en cours), `session` (questions en cours), `results`
 * (quiz terminé, déjà enregistré). Il n'y a jamais d'état intermédiaire
 * flou : soit on choisit, soit on répond, soit on regarde le résultat.
 *
 * Rien n'est écrit en base tant que la DERNIÈRE question n'a pas reçu de
 * réponse — un quiz interrompu ne laisse aucune trace partielle.
 */
export function QuizPage() {
  const source = useProgress();
  const confirm = useConfirm();

  const [built, setBuilt] = useState<QuizBuildResult | null>(null);
  const [answers, setAnswers] = useState<QuizAnswerRecord[]>([]);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const cardCountBySubject = useMemo(() => {
    const map = new Map<ID, number>();
    for (const card of source?.tables.cards ?? []) {
      map.set(card.subjectId, (map.get(card.subjectId) ?? 0) + 1);
    }
    return map;
  }, [source]);

  const weakCardCount = useMemo(() => {
    if (!source) return 0;
    const points = weakPoints(source.tables.subjects, source.tables.chapters, source.tables.cards, source.tables.logs, 20);
    return new Set(points.flatMap((point) => point.cardIds)).size;
  }, [source]);

  const dueCardCount = useMemo(() => {
    if (!source) return 0;
    const nowIso = new Date(source.loadedAt).toISOString();
    return source.tables.cards.filter((card) => card.due <= nowIso).length;
  }, [source]);

  const examEvaluations = useMemo(() => {
    if (!source) return [];
    const now = new Date(source.loadedAt);
    const evaluations = upcomingEvaluations(source.tables.events, source.tables.subjects, now);
    const bySubject = new Map<ID, (typeof evaluations)[number]>();
    for (const evaluation of evaluations) {
      if (!evaluation.subjectId || bySubject.has(evaluation.subjectId)) continue;
      bySubject.set(evaluation.subjectId, evaluation);
    }
    return [...bySubject.entries()].map(([subjectId, evaluation]) => ({
      subjectId,
      subjectName: evaluation.subjectName ?? 'Matière',
      evaluation,
    }));
  }, [source]);

  if (!source) return null;

  if (source.tables.subjects.length === 0) {
    return (
      <PageTransition>
        <PageHeader title="Quiz" />
        <EmptyState
          icon={<Icon name="quiz" size={30} />}
          title="Le quiz se construit à partir de tes flashcards"
          description="Crée une matière et quelques flashcards : le quiz choisit alors une question parmi tes cartes réelles et forme ses propositions avec de vraies réponses, jamais inventées."
          action={
            <Link to="/cours">
              <Button>Créer ma première matière</Button>
            </Link>
          }
        />
      </PageTransition>
    );
  }

  const start = (scope: QuizScope, count: number, difficulty: QuizDifficulty, format: QuizFormat) => {
    const generated = buildQuiz(scope, source.tables, {
      count,
      difficulty,
      format,
      now: new Date(source.loadedAt),
    });
    if (generated.blocked) {
      setBlockedMessage(generated.blocked);
      return;
    }
    setBlockedMessage(null);
    setBuilt(generated);
    setAnswers([]);
    setResult(null);
  };

  const restart = () => {
    setBuilt(null);
    setAnswers([]);
    setResult(null);
    setBlockedMessage(null);
  };

  const handleAnswer = async (record: QuizAnswerRecord) => {
    const next = [...answers, record];
    if (built && next.length < built.questions.length) {
      setAnswers(next);
      return;
    }
    // Dernière question : on journalise puis on affiche le résultat.
    await recordQuizResults(next, new Date());
    setResult(summarizeQuiz(next));
    setAnswers([]);
  };

  const quitSession = async () => {
    const ok = await confirm({
      title: 'Quitter ce quiz ?',
      description: 'Les réponses déjà données ne seront pas enregistrées.',
      confirmLabel: 'Quitter',
      destructive: true,
    });
    if (ok) restart();
  };

  return (
    <PageTransition>
      <PageHeader
        title="Quiz"
        subtitle={
          built && !result
            ? undefined
            : 'Évalue tes connaissances avec de vrais QCM tirés de tes flashcards — un système distinct de la répétition espacée.'
        }
        action={
          built && !result ? (
            <Button variant="ghost" size="sm" onClick={() => void quitSession()}>
              Quitter
            </Button>
          ) : undefined
        }
      />

      {result ? (
        <QuizResults result={result} onRestart={restart} />
      ) : built ? (
        <QuizSession questions={built.questions} index={answers.length} onAnswer={(r) => void handleAnswer(r)} />
      ) : (
        <>
          {blockedMessage && (
            <FadeUp className="mb-5 rounded-[var(--radius-card)] border border-[var(--mastery-1)]/40 bg-[var(--warning-tint)] p-4">
              <p className="text-[0.88rem] text-[var(--ink-soft)]" data-quiz-blocked>
                {blockedMessage}
              </p>
            </FadeUp>
          )}
          <QuizSetup
            subjects={source.tables.subjects}
            chapters={source.tables.chapters}
            cardCountBySubject={cardCountBySubject}
            weakCardCount={weakCardCount}
            dueCardCount={dueCardCount}
            examEvaluations={examEvaluations}
            onStart={start}
          />
        </>
      )}
    </PageTransition>
  );
}
