import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { dayKey } from '@/lib/date';
import { comparisonKey } from '@/core/text';
import type { QuizAnswerRecord } from '@/core/quiz';
import type { QuizRun, ReviewLog } from '@/types';

/** Les dernières options mémorisées servent au générateur suivant, pas aux statistiques. */
export async function listRecentQuizOptionKeys(limit = 48): Promise<string[]> {
  const runs = (await db.quizRuns.orderBy('completedAt').reverse().toArray())
    .filter((run) => run.completedAt !== null)
    .slice(0, 8);
  const seen = new Set<string>();
  for (const run of runs) {
    for (const key of [...run.usedCorrectAnswerKeys, ...run.usedDistractorKeys]) {
      if (seen.size >= limit) return [...seen];
      seen.add(key);
    }
  }
  return [...seen];
}

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
  const usedCorrectAnswerKeys = answers.map((answer) => comparisonKey(answer.question.options[answer.question.correctIndex] ?? ''));
  const usedDistractorKeys = answers.flatMap((answer) =>
    answer.question.options
      .filter((_, index) => index !== answer.question.correctIndex)
      .map(comparisonKey),
  );
  const optionFrequency: Record<string, number> = {};
  for (const key of [...usedCorrectAnswerKeys, ...usedDistractorKeys]) {
    if (key) optionFrequency[key] = (optionFrequency[key] ?? 0) + 1;
  }
  const cards = await db.flashcards.bulkGet([...new Set(answers.map((answer) => answer.question.cardId))]);
  const concepts = cards.flatMap((card) => (card?.knowledgeConceptId ? [card.knowledgeConceptId] : []));
  const run: QuizRun = {
    id: uid('qzr'),
    createdAt: now.toISOString(),
    completedAt: now.toISOString(),
    subjectIds: [...new Set(answers.map((answer) => answer.question.subjectId))],
    questionCardIds: answers.map((answer) => answer.question.cardId),
    testedConceptIds: [...new Set(concepts)],
    usedCorrectAnswerKeys: usedCorrectAnswerKeys.filter(Boolean),
    usedDistractorKeys: usedDistractorKeys.filter(Boolean),
    optionFrequency,
  };
  await db.transaction('rw', [db.reviewLogs, db.quizRuns], async () => {
    await db.reviewLogs.bulkAdd(logs);
    await db.quizRuns.add(run);
  });
}
