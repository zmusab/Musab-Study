import type { Confidence, Difficulty, Importance, Rating } from '@/types';
import { comparisonKey } from '@/core/text';

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
    /*
      « FACILE » SAUTE UN BARREAU DE L'ÉCHELLE.

      Auparavant : `INTERVAL_STEPS[reps - 1] * 1.4`. Sur une carte NEUVE, cela
      donnait 1 × 1,4 = 1,4, arrondi à 1 jour — exactement comme « Bien » et
      comme « Difficile ». Les trois boutons annonçaient le même délai, et le
      choix de l'étudiant ne changeait rien : une carte sue par cœur revenait
      le lendemain au même titre qu'une carte à peine retrouvée.

      Monter d'un barreau exprime la même idée avec l'échelle qui existe
      déjà : « Bien » avance d'un cran, « Facile » de deux. Au-delà de
      l'échelle, on retombe sur l'espacement multiplicatif habituel.
    */
    ease = clampEase(item.ease + 0.15 + confMod);

    /*
      …SANS JAMAIS PASSER SOUS « BIEN ».

      Le barreau suivant et l'espacement multiplicatif ne se rejoignent pas au
      bout de l'échelle : sur une carte mûre, prendre le barreau donnait 37
      jours là où « Bien » en donnait 46 — « Facile » punissait l'étudiant qui
      savait. On garde donc le PLUS GRAND des deux, ce qui rend l'ordre des
      quatre boutons vrai par construction.
    */
    const goodBase = reps <= INTERVAL_STEPS.length ? INTERVAL_STEPS[reps - 1]! : item.interval * ease;
    const nextRung = reps < INTERVAL_STEPS.length ? INTERVAL_STEPS[reps]! : 0;
    base = Math.max(nextRung, goodBase * 1.4);
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
 * MISE DE CÔTÉ — suspendre et enterrer, séparément de l'échéance.
 *
 * Ces deux états ne touchent JAMAIS `due`, `ease` ni `interval` : l'échéance
 * reste exactement celle que `scheduleNext` a posée. Ils décident seulement si
 * la carte est PRÉSENTÉE. C'est ce qui permet de réactiver une carte et de la
 * retrouver là où elle en était, plutôt que de recommencer son historique.
 */
export interface SetAside {
  /** Retirée jusqu'à réactivation explicite. */
  suspended?: boolean;
  /** Retirée jusqu'à cette date — en pratique le lendemain. */
  buriedUntil?: string | null;
}

export function isSuspended(item: SetAside): boolean {
  return item.suspended === true;
}

export function isBuried(item: SetAside, now: Date = new Date()): boolean {
  if (!item.buriedUntil) return false;
  const until = new Date(item.buriedUntil).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

/** Vrai si la carte peut être présentée : due, ni suspendue, ni enterrée. */
export function isReviewable(item: SchedulingState & SetAside, now: Date = new Date()): boolean {
  return isDue(item, now) && !isSuspended(item) && !isBuried(item, now);
}

/**
 * L'instant où une carte enterrée ressort : le début du jour suivant.
 * Enterrer à 23 h 50 ne doit pas la faire revenir dix minutes plus tard, et
 * enterrer à 6 h du matin ne doit pas la retenir plus qu'une journée.
 */
export function buryUntil(now: Date = new Date()): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return tomorrow.toISOString();
}

/**
 * File de révision : les éléments dus, les plus fragiles d'abord
 * (ease faible = difficulté ressentie élevée), puis les plus en retard.
 *
 * Le filtrage des cartes mises de côté se fait ICI, et nulle part ailleurs :
 * toute file de révision de l'application passe par cette fonction, donc une
 * carte suspendue ne peut pas réapparaître par un chemin oublié.
 */
export function buildDueQueue<T extends SchedulingState & SetAside & { notionKey?: string | null; question?: string; answer?: string }>(items: T[], now: Date = new Date()): T[] {
  const ranked = items
    .filter((item) => isReviewable(item, now))
    .sort((a, b) => a.ease - b.ease || new Date(a.due).getTime() - new Date(b.due).getTime());
  const repeatedAnswers = new Set<string>();
  const unique = ranked.filter((item) => {
    const answer = comparisonKey(item.answer ?? '');
    if (!answer) return true;
    // Même sous deux questions différentes, réciter exactement la même
    // réponse deux fois dans une session reste une répétition inutile.
    if (repeatedAnswers.has(answer)) return false;
    repeatedAnswers.add(answer);
    return true;
  });
  const queue: T[] = [];
  let previous = '';
  while (unique.length > 0) {
    const index = unique.findIndex((item) => {
      const key = item.notionKey || comparisonKey(item.answer ?? '');
      return key === '' || key !== previous;
    });
    const [next] = unique.splice(index < 0 ? 0 : index, 1);
    if (!next) break;
    queue.push(next);
    previous = next.notionKey || comparisonKey(next.answer ?? '');
  }
  return queue;
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

/**
 * CE QUE CHAQUE NOTE VA COÛTER, avant de la choisir.
 *
 * C'est la fonction la plus visible d'Anki, et celle qui rend la répétition
 * espacée croyable : sous « Encore » on lit « 10 min », sous « Facile »
 * « 1 mois ». L'étudiant ne note plus à l'aveugle — il voit la conséquence,
 * et il comprend pourquoi une carte revient.
 *
 * Rien n'est réinventé ici : `scheduleNext` est une fonction PURE, on
 * l'appelle simplement une fois par note. L'aperçu ne peut donc pas diverger
 * de la planification réelle — c'est la même règle, exécutée à l'avance.
 */

/** Formate un délai comme le ferait un étudiant : « 10 min », « 3 j », « 2 mois ». */
export function formatDelay(fromMs: number, toISO: string): string {
  const ms = new Date(toISO).getTime() - fromMs;
  if (ms <= 0) return 'maintenant';

  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;

  /*
    LES JOURS JUSQU'À TROIS MOIS, et pas jusqu'à un seul.

    Une première version basculait en mois dès 30 jours. Deux notes qui
    donnent réellement 46 et 64 jours s'affichaient alors toutes les deux
    « 2 mois » : l'aperçu écrasait la différence qu'il est censé montrer, et
    les boutons « Bien » et « Facile » paraissaient faire la même chose.
  */
  const days = Math.round(ms / DAY_MS);
  if (days < 90) return `${days} j`;

  const months = Math.round(days / 30);
  return months < 12 ? `${months} mois` : `${Math.round(months / 12)} an${months >= 24 ? 's' : ''}`;
}

/**
 * Délai annoncé pour chacune des quatre notes, dans l'ordre 0→3.
 * `confidenceFor` reproduit le couplage note/confiance de l'écran de révision,
 * pour que l'aperçu corresponde EXACTEMENT à ce qui sera enregistré.
 */
export function previewDelays(
  item: SchedulingInput,
  confidenceFor: (rating: Rating) => Confidence,
  now: Date = new Date(),
): Record<Rating, string> {
  const at = now.getTime();
  const delay = (rating: Rating) => formatDelay(at, scheduleNext(item, rating, confidenceFor(rating), now).due);
  return { 0: delay(0), 1: delay(1), 2: delay(2), 3: delay(3) };
}
