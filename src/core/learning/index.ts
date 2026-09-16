import type { FactAttempt, FactLearningStatus, LearnerFactState, LearningVerdict } from '@/types';

/**
 * Indicateur de maîtrise par fait.
 *
 * Ce calcul ne prétend pas modéliser le cerveau ni prédire une note. Il rend
 * simplement lisible l'historique réel : qualité des dernières réponses,
 * répétition et délai depuis la dernière réussite. Il est pur, déterministe
 * et partagé par la progression, les priorités et la session du jour.
 */

const RECENT_ATTEMPTS = 8;
const SECURE_AFTER_DAYS = 14;

const verdictValue = (verdict: LearningVerdict): number => {
  switch (verdict) {
    case 'correct': return 1;
    case 'partial': return 0.5;
    case 'incorrect': return 0;
    case 'unable-to-evaluate': return 0;
  }
};

function nextReview(last: FactAttempt | undefined, consecutiveCorrect: number): string | null {
  if (!last || last.verdict !== 'correct') return null;
  const days = consecutiveCorrect >= 4 ? 14 : consecutiveCorrect === 3 ? 7 : consecutiveCorrect === 2 ? 3 : 1;
  const date = new Date(last.at);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function statusFor(attempts: readonly FactAttempt[], mastery: number | null, streak: number, now: Date): FactLearningStatus {
  if (attempts.length === 0) return 'unseen';
  const last = attempts[attempts.length - 1]!;
  if (last.verdict === 'incorrect' || last.verdict === 'unable-to-evaluate') return 'fragile';
  // Une réponse partielle est un apprentissage incomplet, pas un échec : elle
  // doit donner une consigne de consolidation, sans étiqueter l'étudiant comme
  // « fragile » à sa première restitution incomplète.
  if ((mastery ?? 0) < 45 && last.verdict !== 'partial') return 'fragile';
  const daysSinceLast = (now.getTime() - new Date(last.at).getTime()) / 86_400_000;
  if (mastery !== null && mastery >= 75 && streak >= 3 && daysSinceLast >= 1) return 'secure';
  return 'learning';
}

/** Retourne la projection complète d'un fait à partir de toutes ses tentatives. */
export function deriveFactState(
  factId: string,
  attempts: readonly FactAttempt[],
  fallback: Pick<LearnerFactState, 'conceptId' | 'subjectId' | 'chapterId'>,
  now: Date = new Date(),
): LearnerFactState {
  const ordered = [...attempts].sort((a, b) => a.at.localeCompare(b.at));
  const recent = ordered.slice(-RECENT_ATTEMPTS);
  const counts = {
    correct: ordered.filter((attempt) => attempt.verdict === 'correct').length,
    partial: ordered.filter((attempt) => attempt.verdict === 'partial').length,
    incorrect: ordered.filter((attempt) => attempt.verdict === 'incorrect' || attempt.verdict === 'unable-to-evaluate').length,
  };
  const last = ordered[ordered.length - 1];
  let streak = 0;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (ordered[index]!.verdict !== 'correct') break;
    streak += 1;
  }

  // 70 % : les huit réponses les plus récentes (partiel = demi acquis).
  // 20 % : répétitions effectives, plafonnées après cinq essais.
  // 10 % : consolidation après un délai réel, jamais pour une carte vue à
  // l'instant. Les coefficients sont des poids d'affichage documentés, pas
  // une « chance de savoir » présentée comme scientifique.
  const quality = recent.length === 0 ? null : recent.reduce((sum, attempt) => sum + verdictValue(attempt.verdict), 0) / recent.length;
  const repetition = Math.min(1, ordered.length / 5);
  const ageDays = last ? Math.max(0, (now.getTime() - new Date(last.at).getTime()) / 86_400_000) : 0;
  const consolidation = streak > 0 ? Math.min(1, ageDays / SECURE_AFTER_DAYS) : 0;
  const mastery = quality === null ? null : Math.round((quality * 70 + repetition * 20 + consolidation * 10));

  return {
    factId,
    conceptId: fallback.conceptId,
    subjectId: fallback.subjectId,
    chapterId: fallback.chapterId,
    status: statusFor(ordered, mastery, streak, now),
    mastery,
    attempts: ordered.length,
    correctAttempts: counts.correct,
    partialAttempts: counts.partial,
    incorrectAttempts: counts.incorrect,
    lastAttemptAt: last?.at ?? null,
    nextReviewAt: nextReview(last, streak),
    updatedAt: now.toISOString(),
  };
}

export interface ConceptMasterySummary {
  conceptId: string;
  totalFacts: number;
  unseen: number;
  fragile: number;
  learning: number;
  secure: number;
  mastery: number | null;
}

/** Agrège les faits sans transformer une partie inconnue en réussite. */
export function summarizeConceptStates(states: readonly LearnerFactState[]): ConceptMasterySummary[] {
  const groups = new Map<string, LearnerFactState[]>();
  for (const state of states) {
    const group = groups.get(state.conceptId);
    if (group) group.push(state);
    else groups.set(state.conceptId, [state]);
  }
  return [...groups.entries()].map(([conceptId, group]) => {
    const measured = group.filter((state) => state.mastery !== null);
    return {
      conceptId,
      totalFacts: group.length,
      unseen: group.filter((state) => state.status === 'unseen').length,
      fragile: group.filter((state) => state.status === 'fragile').length,
      learning: group.filter((state) => state.status === 'learning').length,
      secure: group.filter((state) => state.status === 'secure').length,
      mastery: measured.length > 0 ? Math.round(measured.reduce((sum, state) => sum + (state.mastery ?? 0), 0) / measured.length) : null,
    };
  });
}
