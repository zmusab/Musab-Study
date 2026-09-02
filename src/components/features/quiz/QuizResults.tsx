import { Link } from 'react-router-dom';
import { Button, Card } from '@/components/ui';
import { formatDuration } from '@/core/progress';
import type { QuizResult } from '@/core/quiz';

/**
 * RÉSULTATS — score, erreurs, points faibles détectés, et une action
 * directe : réviser exactement les cartes ratées.
 *
 * Un chapitre n'apparaît en « point faible détecté » que s'il est
 * RÉELLEMENT sous 60 % sur CE quiz (voir `summarizeQuiz`) — jamais une
 * estimation, jamais tous les chapitres touchés par une erreur isolée.
 */
export function QuizResults({
  result,
  onRestart,
}: {
  result: QuizResult;
  onRestart: () => void;
}) {
  const scoreColor =
    result.scorePct >= 80 ? 'var(--mastery-3)' : result.scorePct >= 60 ? 'var(--mastery-2)' : 'var(--mastery-0)';
  const missedCardIds = result.missed.map((answer) => answer.question.cardId);
  // Toujours affichées, indépendamment du score : « matières concernées »
  // est un fait du quiz, pas seulement un signal de faiblesse.
  const subjectNames = [...new Set(result.answers.map((answer) => answer.question.subjectName))];

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

      <div className="mt-4 flex flex-wrap gap-2">
        {missedCardIds.length > 0 && (
          <Link to={`/revisions?cards=${missedCardIds.join(',')}`}>
            <Button data-quiz-review-errors>Réviser mes erreurs</Button>
          </Link>
        )}
        <Button variant="secondary" onClick={onRestart} data-quiz-restart>
          Nouveau quiz
        </Button>
      </div>
    </div>
  );
}
