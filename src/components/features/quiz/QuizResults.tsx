import { Link } from 'react-router-dom';
import { Button, Card, Chip } from '@/components/ui';
import { formatDuration } from '@/core/progress';
import type { ExamLikelihood, QuizResult } from '@/core/quiz';
import type { ID } from '@/types';

const EXAM_LIKELIHOOD_META: Record<ExamLikelihood, { emoji: string; label: string; color: string }> = {
  high: { emoji: '🟢', label: 'Probabilité élevée', color: 'var(--mastery-3)' },
  medium: { emoji: '🟡', label: 'Probabilité moyenne', color: 'var(--mastery-2)' },
  low: { emoji: '🟠', label: 'Probabilité faible', color: 'var(--mastery-1)' },
};

/**
 * RÉSULTATS — score, erreurs, points faibles détectés, et une action
 * directe : réviser exactement les cartes ratées.
 *
 * Un chapitre n'apparaît en « point faible détecté » que s'il est
 * RÉELLEMENT sous 60 % sur CE quiz (voir `summarizeQuiz`) — jamais une
 * estimation, jamais tous les chapitres touchés par une erreur isolée.
 *
 * Les sections « Examen probable » (répartition par probabilité, notions
 * importantes mal maîtrisées, « Refaire les questions importantes ») ne
 * s'affichent que si CE quiz portait réellement des questions estimées —
 * un quiz QCM/Vrai-Faux ordinaire n'affiche rien de nouveau.
 */
export function QuizResults({
  result,
  onRestart,
  onRetryImportant,
}: {
  result: QuizResult;
  onRestart: () => void;
  /** « Refaire les questions importantes » — rejoue les cartes en probabilité élevée de CE quiz. */
  onRetryImportant?: (cardIds: ID[]) => void;
}) {
  const scoreColor =
    result.scorePct >= 80 ? 'var(--mastery-3)' : result.scorePct >= 60 ? 'var(--mastery-2)' : 'var(--mastery-0)';
  const missedCardIds = result.missed.map((answer) => answer.question.cardId);
  // Toujours affichées, indépendamment du score : « matières concernées »
  // est un fait du quiz, pas seulement un signal de faiblesse.
  const subjectNames = [...new Set(result.answers.map((answer) => answer.question.subjectName))];

  const examLikelyAnswers = result.answers.filter((answer) => answer.question.examLikelihood !== null);
  const isExamLikelyQuiz = examLikelyAnswers.length > 0;
  const tierBreakdown = (['high', 'medium', 'low'] as const).map((level) => {
    const answers = examLikelyAnswers.filter((answer) => answer.question.examLikelihood!.level === level);
    return { level, total: answers.length, correct: answers.filter((answer) => answer.correct).length };
  });
  const importantMissed = result.missed.filter((answer) => answer.question.examLikelihood?.level === 'high');
  const importantCardIds = [
    ...new Set(
      examLikelyAnswers
        .filter((answer) => answer.question.examLikelihood!.level === 'high')
        .map((answer) => answer.question.cardId),
    ),
  ];

  return (
    <div data-quiz-results>
      <Card className="text-center">
        <p className="text-[0.8rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">Score</p>
        <p className="mt-1 text-[2.4rem] font-semibold leading-none tabular-nums" style={{ color: scoreColor }} data-quiz-score>
          {result.scorePct} %
        </p>
        <p className="mt-2 text-[0.92rem] text-[var(--ink-soft)]">
          {result.correct}/{result.total} bonne{result.correct > 1 ? 's' : ''} réponse{result.correct > 1 ? 's' : ''}
          {' · '}
          {formatDuration(result.elapsedMs)}
        </p>
        <p className="mt-1.5 text-[0.82rem] text-[var(--ink-faint)]" data-quiz-subjects>
          {subjectNames.length > 1 ? 'Matières' : 'Matière'} : {subjectNames.join(', ')}
        </p>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-[0.95rem] font-semibold">Chapitres faibles détectés</h3>
          {result.weakChapters.length === 0 ? (
            <p className="mt-2 text-[0.84rem] leading-relaxed text-[var(--ink-faint)]">
              Aucun chapitre sous 60 % de réussite sur ce quiz.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2" data-quiz-weak-chapters>
              {result.weakChapters.map((chapter) => (
                <li key={`${chapter.subjectId}:${chapter.chapterId ?? 'orphan'}`} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[0.86rem]">
                    {chapter.chapterName ?? 'Sans chapitre'}
                    <span className="text-[var(--ink-faint)]"> · {chapter.subjectName}</span>
                  </span>
                  <span className="shrink-0 text-[0.82rem] font-medium tabular-nums" style={{ color: 'var(--mastery-0)' }}>
                    {chapter.correct}/{chapter.total}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="text-[0.95rem] font-semibold">Questions ratées</h3>
          {result.missed.length === 0 ? (
            <p className="mt-2 text-[0.84rem] leading-relaxed text-[var(--ink-faint)]">
              Aucune — sans faute sur ce quiz.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2" data-quiz-missed>
              {result.missed.map((answer) => (
                <li key={answer.question.id} className="text-[0.84rem] leading-snug">
                  <span className="block truncate font-medium">{answer.question.question}</span>
                  <span className="block text-[0.78rem] text-[var(--ink-faint)]">
                    Réponse : {answer.question.options[answer.question.correctIndex]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isExamLikelyQuiz && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2" data-quiz-exam-likely-results>
          <Card>
            <h3 className="text-[0.95rem] font-semibold">Par probabilité estimée</h3>
            <ul className="mt-2 flex flex-col gap-2" data-quiz-exam-likely-breakdown>
              {tierBreakdown
                .filter((row) => row.total > 0)
                .map((row) => (
                  <li key={row.level} className="flex items-center justify-between gap-2">
                    <Chip color={EXAM_LIKELIHOOD_META[row.level].color}>
                      {EXAM_LIKELIHOOD_META[row.level].emoji} {EXAM_LIKELIHOOD_META[row.level].label}
                    </Chip>
                    <span className="shrink-0 text-[0.82rem] font-medium tabular-nums text-[var(--ink-soft)]">
                      {row.correct}/{row.total}
                    </span>
                  </li>
                ))}
            </ul>
          </Card>

          <Card>
            <h3 className="text-[0.95rem] font-semibold">Notions probablement importantes mal maîtrisées</h3>
            {importantMissed.length === 0 ? (
              <p className="mt-2 text-[0.84rem] leading-relaxed text-[var(--ink-faint)]">
                Aucune — les questions en probabilité élevée ont toutes été réussies sur ce quiz.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2" data-quiz-important-missed>
                {importantMissed.map((answer) => (
                  <li key={answer.question.id} className="text-[0.84rem] leading-snug">
                    <span className="block truncate font-medium">{answer.question.question}</span>
                    <span className="block text-[0.78rem] text-[var(--ink-faint)]">
                      {answer.question.examLikelihood!.chapterName ?? answer.question.chapterName ?? 'Sans chapitre'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {missedCardIds.length > 0 && (
          <Link to={`/revisions?cards=${missedCardIds.join(',')}`}>
            <Button data-quiz-review-errors>Réviser mes erreurs</Button>
          </Link>
        )}
        {isExamLikelyQuiz && importantCardIds.length > 0 && onRetryImportant && (
          <Button
            variant="secondary"
            onClick={() => onRetryImportant(importantCardIds)}
            data-quiz-retry-important
          >
            Refaire les questions importantes
          </Button>
        )}
        <Button variant="secondary" onClick={onRestart} data-quiz-restart>
          Nouveau quiz
        </Button>
      </div>
    </div>
  );
}
