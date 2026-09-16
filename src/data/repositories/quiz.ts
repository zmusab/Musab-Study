import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { dayKey } from '@/lib/date';
import { comparisonKey } from '@/core/text';
import { recordFactAttempt } from './learning';
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
  const answered = answers.filter((answer) => answer.selectedIndex !== null);
  const logs: ReviewLog[] = answered
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
      knowledgeFactIds: answer.question.factIds,
      verdict: answer.verdict ?? (answer.correct ? 'correct' : 'incorrect'),
      elapsedMs: answer.elapsedMs,
    }));
  if (logs.length === 0) return;
  const usedCorrectAnswerKeys = answered.map((answer) => comparisonKey(answer.question.options[answer.question.correctIndex] ?? ''));
  const usedDistractorKeys = answered.flatMap((answer) =>
    answer.question.options
      .filter((_, index) => index !== answer.question.correctIndex)
      .map(comparisonKey),
  );
  const optionFrequency: Record<string, number> = {};
  for (const key of [...usedCorrectAnswerKeys, ...usedDistractorKeys]) {
    if (key) optionFrequency[key] = (optionFrequency[key] ?? 0) + 1;
  }
  const concepts = answers.flatMap((answer) => answer.question.conceptIds);
  const run: QuizRun = {
    id: uid('qzr'),
    createdAt: now.toISOString(),
    completedAt: now.toISOString(),
    subjectIds: [...new Set(answered.map((answer) => answer.question.subjectId))],
    questionCardIds: answered.map((answer) => answer.question.cardId),
    testedConceptIds: [...new Set(concepts)],
    usedCorrectAnswerKeys: usedCorrectAnswerKeys.filter(Boolean),
    usedDistractorKeys: usedDistractorKeys.filter(Boolean),
    optionFrequency,
  };
  await db.transaction('rw', [db.reviewLogs, db.quizRuns], async () => {
    await db.reviewLogs.bulkAdd(logs);
    await db.quizRuns.add(run);
  });
  // Même lorsqu'une question provient directement d'un fait (donc sans
  // flashcard persistée), la tentative alimente la maîtrise de ce fait.
  await Promise.all(answered.map((answer, index) =>
    recordFactAttempt({
      factIds: answer.question.factIds,
      subjectId: answer.question.subjectId,
      chapterId: answer.question.chapterId,
      kind: answer.question.format === 'vf' ? 'true-false' : answer.question.format === 'recall' ? 'recall' : 'quiz',
      verdict: answer.verdict ?? (answer.correct ? 'correct' : 'incorrect'),
      at: now,
      elapsedMs: answer.elapsedMs,
      sourceItemId: logs[index]?.id ?? null,
    }),
  ));
}
