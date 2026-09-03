import type { Flashcard, ReviewLog } from '@/types';
import type { SchedulingState } from '@/core/srs';
import { MIN_EASE, MAX_EASE } from '@/core/srs';

/**
 * Maîtrise — quel pourcentage d'une notion est réellement acquis.
 *
 * Deux composantes : l'intervalle atteint (70 %) traduit la rétention prouvée
 * dans le temps, l'ease (30 %) traduit la facilité ressentie. Une carte jamais
 * révisée vaut 0 %, jamais une valeur par défaut flatteuse.
 */

export const MASTERY_LEVELS = 5;
export type MasteryLevel = 0 | 1 | 2 | 3 | 4;

export const MASTERY_LABELS: readonly string[] = [
  'Très faible',
  'Faible',
  'Moyen',
  'Bon',
  'Maîtrisé',
];

/** Variables CSS, définies dans src/styles/theme.css. */
export const MASTERY_COLOR_VARS: readonly string[] = [
  'var(--mastery-0)',
  'var(--mastery-1)',
  'var(--mastery-2)',
  'var(--mastery-3)',
  'var(--mastery-4)',
];

/** Intervalle (en jours) à partir duquel la composante « rétention » sature. */
const INTERVAL_CEILING_DAYS = 60;

export function masteryPct(state: Pick<SchedulingState, 'ease' | 'interval' | 'reps'>): number {
  if (state.reps === 0 && state.interval === 0) return 0;
  const retention = Math.min(1, state.interval / INTERVAL_CEILING_DAYS) * 70;
  const easeSpan = MAX_EASE - MIN_EASE;
  const comfort = Math.min(1, Math.max(0, (state.ease - MIN_EASE) / easeSpan)) * 30;
  return Math.round(retention + comfort);
}

export function masteryLevel(
  state: Pick<SchedulingState, 'ease' | 'interval' | 'reps'>,
): MasteryLevel {
  const pct = masteryPct(state);
  if (pct < 20) return 0;
  if (pct < 40) return 1;
  if (pct < 60) return 2;
  if (pct < 80) return 3;
  return 4;
}

export interface MasteryStatus {
  label: string;
  /** `null` pour une carte jamais révisée — un pourcentage y serait trompeur, pas juste bas. */
  pct: number | null;
  level: MasteryLevel | null;
}

/**
 * Étiquette affichable, pensée pour ne jamais laisser croire qu'un « 0 % »
 * juge la carte elle-même plutôt que le simple fait qu'elle n'a encore
 * jamais été révisée — cas qui se confond sinon avec la case la plus faible
 * de `MASTERY_LABELS` (« Très faible »), destinée à une carte réellement mal
 * maîtrisée après des révisions ratées.
 */
export function masteryStatus(state: Pick<SchedulingState, 'ease' | 'interval' | 'reps'>): MasteryStatus {
  if (state.reps === 0 && state.interval === 0) {
    return { label: 'À découvrir · jamais révisée', pct: null, level: null };
  }
  const level = masteryLevel(state);
  const pct = masteryPct(state);
  return { label: `${MASTERY_LABELS[level]} · ${pct}%`, pct, level };
}

/** Répartition des cartes par niveau de maîtrise, pour la barre empilée. */
export function masteryDistribution(cards: Flashcard[]): number[] {
  const counts = new Array<number>(MASTERY_LEVELS).fill(0);
  for (const card of cards) counts[masteryLevel(card)]! += 1;
  return counts;
}

/**
 * Maîtrise moyenne d'un ensemble de cartes.
 *
 * Ne compte QUE les flashcards. Le prototype injectait ici les questions de
 * quiz avec un état vide, ce qui faisait chuter la maîtrise affichée à mesure
 * qu'on ajoutait des questions — un quiz n'a pas d'état de répétition espacée,
 * sa performance se mesure par le taux de réussite, pas par la maîtrise.
 */
export function averageMastery(cards: Flashcard[]): number {
  if (cards.length === 0) return 0;
  const total = cards.reduce((sum, card) => sum + masteryPct(card), 0);
  return Math.round(total / cards.length);
}

export interface ItemHistory {
  reviews: number;
  correct: number;
  successRate: number | null;
  lastReviewAt: string | null;
}

/** Historique consolidé d'un élément, calculé depuis le journal de révisions. */
export function itemHistory(logs: ReviewLog[], itemId: string): ItemHistory {
  const relevant = logs.filter((log) => log.itemId === itemId);
  if (relevant.length === 0) {
    return { reviews: 0, correct: 0, successRate: null, lastReviewAt: null };
  }
  const correct = relevant.filter((log) => log.correct).length;
  const lastReviewAt = relevant.reduce(
    (latest, log) => (log.at > latest ? log.at : latest),
    relevant[0]!.at,
  );
  return {
    reviews: relevant.length,
    correct,
    successRate: correct / relevant.length,
    lastReviewAt,
  };
}
