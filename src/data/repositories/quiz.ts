import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { dayKey } from '@/lib/date';
import type { QuizAnswerRecord } from '@/core/quiz';
import type { ReviewLog } from '@/types';

/**
 * Journalise un quiz terminé.
 *
 * Une ligne par question répondue, `itemKind: 'quiz'` — jamais `'card'` : ces
 * réponses alimentent les mêmes statistiques que les flashcards (taux de
 * réussite, points faibles, activité, régularité — voir `core/progress`),
 * mais ne touchent JAMAIS la table `flashcards` : aucune échéance SM-2,
 * aucun `ease`, aucun `interval` n'est modifié par un quiz. Une question sans
 * réponse choisie (temps écoulé, quiz abandonné) n'est pas journalisée : on
 * ne peut pas mesurer une réponse qui n'a pas été donnée.
 */
export async function recordQuizResults(answers: readonly QuizAnswerRecord[], now: Date = new Date()): Promise<void> {
  const logs: ReviewLog[] = answers
    .filter((answer) => answer.selectedIndex !== null)
    .map((answer) => ({
      id: uid('rev'),
      subjectId: answer.question.subjectId,
      chapterId: answer.question.chapterId,
      itemId: answer.question.cardId,
      itemKind: 'quiz',
      assessment: answer.question.format === 'recall' ? 'self' : 'choice',
      at: now.toISOString(),
      day: dayKey(now),
      correct: answer.correct,
      rating: null,
      confidence: null,
      elapsedMs: answer.elapsedMs,
    }));
  if (logs.length === 0) return;
  await db.reviewLogs.bulkAdd(logs);
}
