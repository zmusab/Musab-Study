import type { Confidence, Difficulty, Importance, Rating } from '@/types';

/**
 * Répétition espacée — SM-2 modifié.
 *
 * Porté depuis le prototype (dont l'algorithme était déjà solide) puis rendu
 * PUR et DÉTERMINISTE : aucune lecture de `Date.now()` à l'intérieur, l'instant
 * est toujours injecté. C'est ce qui rend le comportement testable.
 *
 * Quatre signaux modulent l'intervalle en plus de la note :
 *  - la confiance annoncée AVANT de voir la réponse (une réussite peu confiante
 *    est une réussite fragile, une réussite confiante mérite plus d'espacement) ;
 *  - l'importance (une notion qui tombe à l'examen revient plus souvent) ;
 *  - la difficulté intrinsèque de la carte ;
 *  - le retard réel (une carte révisée très en retard voit son intervalle réduit).
 */

export const MIN_EASE = 1.3;
export const MAX_EASE = 3.2;
export const DEFAULT_EASE = 2.3;

/** Paliers d'intervalle en jours pour les premières répétitions réussies. */
export const INTERVAL_STEPS = [1, 3, 7, 14, 30, 60] as const;

/** Délai de réapprentissage après un échec : 10 minutes. */
export const RELEARN_DELAY_MS = 10 * 60 * 1000;

const DAY_MS = 86_400_000;

/** État de planification d'un élément. Volontairement minimal et sérialisable. */
export interface SchedulingState {
  ease: number;
  interval: number;
  reps: number;
  lapses: number;
  due: string;
  lastReview: string | null;
}

export interface SchedulingInput extends SchedulingState {
  importance: Importance;
  difficulty: Difficulty;
}

export function clampEase(ease: number): number {
  return Math.min(MAX_EASE, Math.max(MIN_EASE, ease));
}

/**
 * Ajustement d'ease lié à la confiance annoncée.
 * Une réussite annoncée « confiant » consolide ; un échec annoncé « confiant »
 * révèle une illusion de maîtrise et pénalise davantage.
 */
export function confidenceModifier(confidence: Confidence, rating: Rating): number {
  const succeeded = rating >= 2;
  if (confidence === 'high') return succeeded ? 0.05 : -0.1;
  if (confidence === 'low') return succeeded ? -0.03 : 0;
  return 0;
}

/** Une notion « examen » revient plus souvent : facteur < 1 sur l'intervalle. */
export function importanceFactor(importance: Importance): number {
  return 1 - (importance - 1) * 0.15;
}

export function difficultyFactor(difficulty: Difficulty): number {
  return 1 - (difficulty - 1) * 0.1;
}

/**
 * Pénalise une carte révisée bien après son échéance : si tu l'as retrouvée
 * après un long retard, la rétention réelle est plus faible que l'intervalle
 * ne le laisse croire.
 */
export function overdueFactor(state: SchedulingState, now: Date): number {
  if (!state.lastReview || state.interval <= 0) return 1;
  const elapsedDays = (now.getTime() - new Date(state.lastReview).getTime()) / DAY_MS;
  return elapsedDays > state.interval * 1.5 ? 0.9 : 1;
}

/**
 * Calcule le prochain état de planification.
 * Fonction pure : mêmes entrées ⇒ mêmes sorties.
 */
export function scheduleNext(
  item: SchedulingInput,
  rating: Rating,
  confidence: Confidence,
  now: Date = new Date(),
): SchedulingState {
  const confMod = confidenceModifier(confidence, rating);

  if (rating === 0) {
    // Échec : la carte repart à zéro et revient dans la même session.
    return {
      ease: clampEase(item.ease - 0.25 + confMod),
      interval: 0,
      reps: 0,
      lapses: item.lapses + 1,
      due: new Date(now.getTime() + RELEARN_DELAY_MS).toISOString(),
      lastReview: now.toISOString(),
    };
  }

  const reps = item.reps + 1;
  let ease = item.ease;
  let base: number;

  if (rating === 1) {
    // « Difficile » : on avance, mais prudemment.
    ease = clampEase(item.ease - 0.15 + confMod);
    base = item.interval <= 0 ? 1 : item.interval * 1.3;
  } else if (rating === 2) {
    ease = clampEase(item.ease + confMod);
    base = reps <= INTERVAL_STEPS.length ? INTERVAL_STEPS[reps - 1]! : item.interval * ease;
  } else {
    ease = clampEase(item.ease + 0.15 + confMod);
    base =
      (reps <= INTERVAL_STEPS.length ? INTERVAL_STEPS[reps - 1]! : item.interval * ease) * 1.4;
  }

  const interval = Math.max(
    1,
    Math.round(
      base *
        importanceFactor(item.importance) *
        difficultyFactor(item.difficulty) *
        overdueFactor(item, now),
    ),
  );

  return {
    ease,
    interval,
    reps,
    lapses: item.lapses,
    due: new Date(now.getTime() + interval * DAY_MS).toISOString(),
    lastReview: now.toISOString(),
  };
}

/** Vrai si l'élément est arrivé à échéance. */
export function isDue(state: Pick<SchedulingState, 'due'>, now: Date = new Date()): boolean {
  return new Date(state.due).getTime() <= now.getTime();
}

/**
 * File de révision : les éléments dus, les plus fragiles d'abord
 * (ease faible = difficulté ressentie élevée), puis les plus en retard.
 */
export function buildDueQueue<T extends SchedulingState>(items: T[], now: Date = new Date()): T[] {
  return items
    .filter((item) => isDue(item, now))
    .sort((a, b) => a.ease - b.ease || new Date(a.due).getTime() - new Date(b.due).getTime());
}

/** État initial d'un nouvel élément : dû immédiatement. */
export function initialSchedulingState(now: Date = new Date()): SchedulingState {
  return {
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: now.toISOString(),
    lastReview: null,
  };
}
