import type { CalendarEvent, Chapter, DayKey, Flashcard, ID, ISODateTime, ReviewLog, Subject } from '@/types';
import { masteryPct } from '@/core/mastery';
import { DAY_MS, dayKey, daysBetweenDayKeys } from '@/lib/date';
import { chapterProgress, MIN_REVIEWED_CARDS, MIN_REVIEWS_FOR_RATE, type ChapterProgress } from './index';
import { DEFAULT_PRIORITY_CONFIG, DEFAULT_READINESS_CONFIG } from './readinessConfig';

/**
 * SUFFISANCE EXAMEN, ÉVALUATIONS ET PRIORITÉS.
 *
 * Trois notions distinctes, volontairement séparées :
 *  - PROGRESSION : quelle part du contenu est acquise (voir `index.ts`) ;
 *  - SUFFISANCE EXAMEN : à quel point le niveau actuel paraît assez solide
 *    pour affronter une évaluation, avec ou sans date connue ;
 *  - PRIORITÉ : ce qu'il faut travailler maintenant.
 *
 * Aucune de ces valeurs n'est produite sans mesure. Quand les données
 * manquent, les fonctions renvoient `null` et l'interface dit « données
 * insuffisantes » — jamais un pourcentage de remplissage.
 */

// ────────────────────────────── Niveaux de préparation ──────────────────────────────

export type ReadinessLevel = 'insufficient' | 'fragile' | 'good' | 'strong' | 'mastered';

export interface ReadinessMeta {
  level: ReadinessLevel;
  /**
   * Formulation prudente : ce sont des niveaux de PRÉPARATION ESTIMÉE, pas
   * des pronostics. Rien ici ne promet une réussite à l'examen.
   */
  label: string;
  colorVar: string;
}

/** Mêmes jetons sémantiques que `masteryBand` — le violet reste interactif. */
const LEVELS: readonly { min: number; meta: ReadinessMeta }[] = [
  { min: 95, meta: { level: 'mastered', label: 'Très bonne maîtrise', colorVar: 'var(--mastery-3)' } },
  { min: 85, meta: { level: 'strong', label: 'Très bonne préparation', colorVar: 'var(--mastery-3)' } },
  { min: 70, meta: { level: 'good', label: 'Bonne préparation', colorVar: 'var(--mastery-2)' } },
  { min: 50, meta: { level: 'fragile', label: 'Préparation fragile', colorVar: 'var(--mastery-1)' } },
  { min: 0, meta: { level: 'insufficient', label: 'Préparation insuffisante', colorVar: 'var(--mastery-0)' } },
];

export function readinessLevel(pct: number): ReadinessMeta {
  return (LEVELS.find((entry) => pct >= entry.min) ?? LEVELS[LEVELS.length - 1]!).meta;
}

// ────────────────────────────── Suffisance examen ──────────────────────────────

export interface ReadinessComponent {
  key: 'coverage' | 'mastery' | 'reliability' | 'freshness';
  label: string;
  /** Valeur mesurée, 0-100. */
  pct: number;
  /**
   * `base` : le signal entre dans la note de départ, à hauteur de `weight`.
   * `modulator` : il ne DONNE pas de points, il en retire — la note de départ
   * est multipliée par un facteur qui va de `weight` (au pire) à 1.
   */
  role: 'base' | 'modulator';
  weight: number;
  detail: string;
}

export interface ExamReadiness {
  /** Null quand les données sont insuffisantes — jamais un chiffre de remplissage. */
  pct: number | null;
  level: ReadinessMeta | null;
  components: ReadinessComponent[];
  /** Chapitre le plus faible ayant des données — le maillon qui tire la note vers le bas. */
  weakest: { chapterId: ID | null; name: string; pct: number } | null;
  /** Ce qu'il manque pour que la mesure devienne possible. */
  missingReason: string | null;
  reviewedCards: number;
  reviews: number;
}

/**
 * Tous les coefficients vivent dans `readinessConfig.ts`, documentés comme
 * des HEURISTIQUES de conception et regroupés pour pouvoir être réglés d'un
 * seul endroit le jour où de vraies données d'examens existeront.
 */
const {
  masteryWeight: MASTERY_WEIGHT,
  reliabilityWeight: RELIABILITY_WEIGHT,
  coverageFloor: COVERAGE_FLOOR,
  freshnessModulatorFloor: FRESHNESS_MODULATOR_FLOOR,
  weakestShare: WEAKEST_SHARE,
  freshnessHorizonDays: FRESHNESS_HORIZON_DAYS,
  freshnessFloor: FRESHNESS_FLOOR,
  maxLapsePenalty: MAX_LAPSE_PENALTY,
} = DEFAULT_READINESS_CONFIG;

/**
 * Suffisance examen d'une matière — deux signaux de connaissance, deux
 * modulateurs, puis une correction par le maillon faible.
 *
 * La note de départ vient de ce que tu SAIS : la maîtrise (55 %, l'état réel
 * de la répétition espacée) et la fiabilité (45 %, tes réponses tiennent-elles
 * la route — pénalisée par les rechutes, c'est-à-dire les erreurs répétées
 * sur une carte déjà acquise).
 *
 * Deux modulateurs peuvent ensuite la faire BAISSER, jamais monter :
 *  - la COUVERTURE (facteur 0,5 à 1) — connaître parfaitement un quart du
 *    programme ne prépare pas à une évaluation qui porte sur l'ensemble ;
 *  - la FRAÎCHEUR (facteur 0,75 à 1) — l'oubli depuis la dernière révision.
 *
 * Ce choix est délibéré : une version antérieure les additionnait, et une
 * matière à 15 % de maîtrise affichait 49 % de suffisance simplement parce
 * qu'elle avait été révisée le jour même. Avoir ouvert son cours n'est pas
 * un acquis ; ne pas l'avoir ouvert est en revanche un vrai handicap.
 *
 * La correction par le maillon faible traduit enfin un fait d'examen : un
 * chapitre à 40 % pèse plus lourd qu'une moyenne flatteuse ne le laisse
 * croire.
 *
 * Les résultats de quiz ne figurent pas dans le calcul : la fonctionnalité
 * Quiz n'existe pas encore et n'enregistre donc aucune réponse. Le jour où
 * elle en produira, ses réponses alimenteront `reviewLogs` comme celles des
 * flashcards et entreront d'elles-mêmes dans la fiabilité.
 */
export function examReadiness(
  subjectId: ID,
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: readonly ReviewLog[],
  now: Date = new Date(),
): ExamReadiness {
  const subjectCards = cards.filter((card) => card.subjectId === subjectId);
  const subjectLogs = logs.filter((log) => log.subjectId === subjectId);
  const reviewed = subjectCards.filter((card) => card.reps > 0);

  const empty = (missingReason: string | null): ExamReadiness => ({
    pct: null,
    level: null,
    components: [],
    weakest: null,
    missingReason,
    reviewedCards: reviewed.length,
    reviews: subjectLogs.length,
  });

  if (subjectCards.length === 0) return empty('Aucune flashcard dans cette matière.');
  if (reviewed.length < MIN_REVIEWED_CARDS) {
    const missing = MIN_REVIEWED_CARDS - reviewed.length;
    return empty(`Encore ${missing} carte${missing > 1 ? 's' : ''} à réviser pour estimer ta préparation.`);
  }
  if (subjectLogs.length < MIN_REVIEWS_FOR_RATE) {
    return empty('Pas encore assez de réponses enregistrées pour mesurer ta fiabilité.');
  }

  const rows = chapterProgress(subjectId, chapters, cards, logs);

  // 1. COUVERTURE — part des regroupements de cartes réellement travaillés.
  const withCards = rows.filter((row) => row.cards > 0);
  const worked = withCards.filter((row) => row.reviewedCards > 0);
  const coverage = withCards.length > 0 ? (worked.length / withCards.length) * 100 : 0;

  // 2. MAÎTRISE — moyenne SM-2 sur toutes les cartes de la matière.
  const mastery = subjectCards.reduce((sum, card) => sum + masteryPct(card), 0) / subjectCards.length;

  // 3. FIABILITÉ — taux de réussite, pénalisé par les rechutes.
  const correct = subjectLogs.filter((log) => log.correct).length;
  const successRate = correct / subjectLogs.length;
  const totalReps = reviewed.reduce((sum, card) => sum + card.reps, 0);
  const totalLapses = reviewed.reduce((sum, card) => sum + card.lapses, 0);
  const lapseRatio = totalReps > 0 ? totalLapses / totalReps : 0;
  const reliability = successRate * (1 - Math.min(MAX_LAPSE_PENALTY, lapseRatio)) * 100;

  // 4. FRAÎCHEUR — moyenne pondérée par le nombre de cartes de chaque groupe.
  let freshWeighted = 0;
  let freshWeight = 0;
  for (const row of withCards) {
    const days =
      row.lastReviewAt === null
        ? FRESHNESS_HORIZON_DAYS
        : Math.max(0, (now.getTime() - new Date(row.lastReviewAt).getTime()) / DAY_MS);
    const value = Math.max(FRESHNESS_FLOOR, 1 - days / FRESHNESS_HORIZON_DAYS);
    freshWeighted += value * row.cards;
    freshWeight += row.cards;
  }
  const freshness = (freshWeight > 0 ? freshWeighted / freshWeight : FRESHNESS_FLOOR) * 100;

  const components: ReadinessComponent[] = [
    {
      key: 'mastery',
      label: 'Maîtrise moyenne',
      pct: Math.round(mastery),
      role: 'base',
      weight: MASTERY_WEIGHT,
      detail: `${reviewed.length}/${subjectCards.length} carte${subjectCards.length > 1 ? 's' : ''} révisée${reviewed.length > 1 ? 's' : ''}`,
    },
    {
      key: 'reliability',
      label: 'Fiabilité',
      pct: Math.round(reliability),
      role: 'base',
      weight: RELIABILITY_WEIGHT,
      detail:
        totalLapses > 0
          ? `${Math.round(successRate * 100)} % de réussite, ${totalLapses} rechute${totalLapses > 1 ? 's' : ''}`
          : `${Math.round(successRate * 100)} % de réussite`,
    },
    {
      key: 'coverage',
      label: 'Couverture du programme',
      pct: Math.round(coverage),
      role: 'modulator',
      weight: COVERAGE_FLOOR,
      detail: `${worked.length}/${withCards.length} groupe${withCards.length > 1 ? 's' : ''} de cartes travaillé${worked.length > 1 ? 's' : ''}`,
    },
    {
      key: 'freshness',
      label: 'Fraîcheur des révisions',
      pct: Math.round(freshness),
      role: 'modulator',
      weight: FRESHNESS_MODULATOR_FLOOR,
      detail: describeFreshness(withCards, now),
    },
  ];

  const knowledge = mastery * MASTERY_WEIGHT + reliability * RELIABILITY_WEIGHT;
  const coverageFactor = COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * (coverage / 100);
  const freshnessFactor =
    FRESHNESS_MODULATOR_FLOOR + (1 - FRESHNESS_MODULATOR_FLOOR) * (freshness / 100);
  const weightedAverage = knowledge * coverageFactor * freshnessFactor;

  // Maillon faible : le chapitre travaillé le plus bas. Un chapitre jamais
  // ouvert n'entre pas ici — son absence est déjà comptée par la couverture,
  // et lui prêter un pourcentage serait l'inventer.
  const measured = withCards.filter((row) => row.masteryPct !== null);
  const weakestRow = measured.length > 0 ? measured.reduce((low, row) => (row.masteryPct! < low.masteryPct! ? row : low)) : null;

  const pct = Math.round(
    weakestRow === null
      ? weightedAverage
      : weightedAverage * (1 - WEAKEST_SHARE) + weakestRow.masteryPct! * WEAKEST_SHARE,
  );
  const bounded = Math.max(0, Math.min(100, pct));

  return {
    pct: bounded,
    level: readinessLevel(bounded),
    components,
    weakest:
      weakestRow === null
        ? null
        : { chapterId: weakestRow.chapterId, name: weakestRow.name, pct: weakestRow.masteryPct! },
    missingReason: null,
    reviewedCards: reviewed.length,
    reviews: subjectLogs.length,
  };
}

function describeFreshness(rows: readonly ChapterProgress[], now: Date): string {
  const dates = rows.map((row) => row.lastReviewAt).filter((at): at is ISODateTime => at !== null);
  if (dates.length === 0) return 'aucune révision datée';
  const latest = dates.reduce((max, at) => (at > max ? at : max));
  const days = Math.round((now.getTime() - new Date(latest).getTime()) / DAY_MS);
  if (days <= 0) return 'révisé aujourd’hui';
  if (days === 1) return 'révisé hier';
  return `dernière révision il y a ${days} jours`;
}

// ────────────────────────────── Évaluations du calendrier ──────────────────────────────

/**
 * Genres d'événements qui comptent comme une ÉVALUATION, avec leur libellé.
 * Défini dans le cœur — pur — plutôt que dans le dépôt : l'interface et la
 * couche de données y lisent la même liste, sans la recopier.
 */
export const EVALUATION_KIND_LABELS: Record<string, string> = {
  final: 'Examen final',
  exam: 'Examen',
  midterm: 'Contrôle',
  task: 'Devoir',
};

export function isEvaluationKind(kind: string): boolean {
  return EVALUATION_KIND_LABELS[kind] !== undefined;
}

const KIND_LABELS = EVALUATION_KIND_LABELS;

/** Poids d'urgence par nature d'évaluation — un final pèse plus qu'un devoir. */
const KIND_WEIGHT = DEFAULT_PRIORITY_CONFIG.kindWeight;

export interface Evaluation {
  event: CalendarEvent;
  label: string;
  subjectId: ID | null;
  subjectName: string | null;
  day: DayKey;
  /** Jours civils restants — 0 = aujourd'hui. Toujours issu d'une date RÉELLE. */
  daysUntil: number;
  weight: number;
}

/**
 * Évaluations à venir, telles qu'enregistrées dans le calendrier. Aucune date
 * n'est déduite, complétée ni supposée : sans événement enregistré, la liste
 * est vide et l'interface le dit.
 */
export function upcomingEvaluations(
  events: readonly CalendarEvent[],
  subjects: readonly Subject[],
  now: Date = new Date(),
  horizonDays = 120,
): Evaluation[] {
  const today = dayKey(now);
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));

  return events
    .filter((event) => KIND_LABELS[event.kind] !== undefined && !event.done && event.day >= today)
    .map((event) => ({
      event,
      label: KIND_LABELS[event.kind] ?? 'Évaluation',
      subjectId: event.subjectId,
      subjectName: event.subjectId ? (subjectName.get(event.subjectId) ?? null) : null,
      day: event.day,
      daysUntil: daysBetweenDayKeys(today, event.day),
      weight: KIND_WEIGHT[event.kind] ?? 0.5,
    }))
    .filter((evaluation) => evaluation.daysUntil <= horizonDays)
    .sort((a, b) => a.daysUntil - b.daysUntil || b.weight - a.weight);
}

/** Évaluation la plus urgente d'une matière — null si aucune n'est enregistrée. */
export function nextEvaluationFor(evaluations: readonly Evaluation[], subjectId: ID): Evaluation | null {
  return evaluations.find((evaluation) => evaluation.subjectId === subjectId) ?? null;
}

/**
 * Multiplicateur d'urgence d'une matière. Vaut 1 quand aucune date n'est
 * connue : l'absence d'examen au calendrier ne doit PAS faire disparaître le
 * travail à faire, elle doit seulement cesser de l'accélérer.
 */
export const URGENCY_HORIZON_DAYS = DEFAULT_PRIORITY_CONFIG.urgencyHorizonDays;

export function urgencyMultiplier(evaluation: Evaluation | null): number {
  if (!evaluation || evaluation.daysUntil > URGENCY_HORIZON_DAYS) return 1;
  const proximity = 1 - evaluation.daysUntil / URGENCY_HORIZON_DAYS;
  return 1 + evaluation.weight * proximity;
}

// ────────────────────────────── Priorités ──────────────────────────────

export interface PriorityItem {
  id: string;
  subjectId: ID;
  subjectName: string;
  chapterId: ID | null;
  chapterName: string;
  /** Null quand le chapitre n'a jamais été révisé : on ne lui prête pas de note. */
  masteryPct: number | null;
  successRate: number | null;
  daysSinceReview: number | null;
  cards: number;
  cardIds: ID[];
  evaluation: Evaluation | null;
  /** Score interne, seulement pour le tri. */
  score: number;
  /** Raisons mesurées, dans l'ordre où elles pèsent. */
  reasons: string[];
}

const {
  weaknessWeight: WEAKNESS_WEIGHT,
  errorWeight: ERROR_WEIGHT,
  stalenessWeight: STALENESS_WEIGHT,
  shareWeight: SHARE_WEIGHT,
  stalenessHorizonDays: STALENESS_HORIZON_DAYS,
} = DEFAULT_PRIORITY_CONFIG;

/**
 * « À travailler en priorité ».
 *
 * Quatre signaux mesurés (faiblesse, erreurs, ancienneté, volume de contenu),
 * puis un multiplicateur d'urgence si — et seulement si — une évaluation est
 * réellement inscrite au calendrier pour cette matière. Sans date connue, le
 * classement reste pertinent : il est simplement piloté par la faiblesse au
 * lieu de l'échéance.
 */
export function priorityItems(
  subjects: readonly Subject[],
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: readonly ReviewLog[],
  evaluations: readonly Evaluation[],
  now: Date = new Date(),
  limit = 6,
): PriorityItem[] {
  const items: PriorityItem[] = [];

  for (const subject of subjects) {
    const evaluation = nextEvaluationFor(evaluations, subject.id);
    const multiplier = urgencyMultiplier(evaluation);
    const rows = chapterProgress(subject.id, chapters, cards, logs);
    const subjectCardCount = rows.reduce((sum, row) => sum + row.cards, 0);

    for (const row of rows) {
      if (row.cards === 0) continue;
      const chapterCards = cards.filter(
        (card) => card.subjectId === subject.id && card.chapterId === row.chapterId,
      );

      const weakness = row.masteryPct === null ? 1 : (100 - row.masteryPct) / 100;
      const errorRate = row.successRate === null ? 0 : 1 - row.successRate;
      const days =
        row.lastReviewAt === null
          ? null
          : Math.max(0, Math.round((now.getTime() - new Date(row.lastReviewAt).getTime()) / DAY_MS));
      const staleness = days === null ? 1 : Math.min(days, STALENESS_HORIZON_DAYS) / STALENESS_HORIZON_DAYS;
      const share = subjectCardCount > 0 ? row.cards / subjectCardCount : 0;

      const base =
        weakness * WEAKNESS_WEIGHT +
        errorRate * ERROR_WEIGHT +
        staleness * STALENESS_WEIGHT +
        share * SHARE_WEIGHT;
      if (base <= 0) continue;

      items.push({
        id: `${subject.id}:${row.chapterId ?? 'orphan'}`,
        subjectId: subject.id,
        subjectName: subject.name,
        chapterId: row.chapterId,
        chapterName: row.chapterId === null ? subject.name : row.name,
        masteryPct: row.masteryPct,
        successRate: row.successRate,
        daysSinceReview: days,
        cards: row.cards,
        cardIds: chapterCards.map((card) => card.id),
        evaluation,
        score: base * multiplier,
        reasons: priorityReasons(row, days, evaluation),
      });
    }
  }

  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

function priorityReasons(row: ChapterProgress, days: number | null, evaluation: Evaluation | null): string[] {
  const reasons: string[] = [];
  if (evaluation && evaluation.daysUntil <= URGENCY_HORIZON_DAYS) {
    reasons.push(
      evaluation.daysUntil === 0
        ? `${evaluation.label} aujourd’hui`
        : evaluation.daysUntil === 1
          ? `${evaluation.label} demain`
          : `${evaluation.label} dans ${evaluation.daysUntil} jours`,
    );
  }
  if (row.masteryPct === null) reasons.push('jamais révisé');
  else if (row.masteryPct < 60) reasons.push(`${row.masteryPct} % de maîtrise`);
  if (row.successRate !== null && row.successRate < 0.7) {
    reasons.push(`${Math.round(row.successRate * 100)} % de réussite`);
  }
  if (days !== null && days >= 7) reasons.push(`pas revu depuis ${days} jours`);
  return reasons;
}

// ────────────────────────────── Points forts ──────────────────────────────

export interface StrengthItem {
  id: string;
  subjectName: string;
  chapterName: string;
  masteryPct: number;
  reviews: number;
}

const STRENGTH_FLOOR = 80;

/** Chapitres réellement solides — mesurés, jamais choisis pour équilibrer l'écran. */
export function strengths(
  subjects: readonly Subject[],
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: readonly ReviewLog[],
  limit = 4,
): StrengthItem[] {
  const items: StrengthItem[] = [];
  for (const subject of subjects) {
    for (const row of chapterProgress(subject.id, chapters, cards, logs)) {
      if (row.masteryPct === null || row.masteryPct < STRENGTH_FLOOR || row.reviewedCards === 0) continue;
      items.push({
        id: `${subject.id}:${row.chapterId ?? 'orphan'}`,
        subjectName: subject.name,
        chapterName: row.chapterId === null ? subject.name : row.name,
        masteryPct: row.masteryPct,
        reviews: row.reviews,
      });
    }
  }
  return items.sort((a, b) => b.masteryPct - a.masteryPct).slice(0, limit);
}

// ────────────────────────────── Recommandation principale ──────────────────────────────

export interface MainRecommendation {
  title: string;
  body: string;
  cardIds: ID[];
  subjectId: ID;
  chapterId: ID | null;
  evaluation: Evaluation | null;
}

/**
 * UNE recommandation, formulée à partir de la priorité la plus haute. Le
 * texte change selon ce qui est réellement mesuré : présence d'une échéance,
 * chapitre jamais ouvert, maîtrise faible ou erreurs répétées.
 */
export function mainRecommendation(priorities: readonly PriorityItem[]): MainRecommendation | null {
  const top = priorities[0];
  if (!top) return null;

  const where = top.chapterId === null ? top.subjectName : `${top.subjectName} — ${top.chapterName}`;

  // Deux phrases courtes au maximum. Un pavé explicatif se saute ; une
  // consigne brève se suit.
  let body: string;
  if (top.evaluation && top.evaluation.daysUntil <= URGENCY_HORIZON_DAYS) {
    const when =
      top.evaluation.daysUntil === 0
        ? 'a lieu aujourd’hui'
        : top.evaluation.daysUntil === 1
          ? 'a lieu demain'
          : `approche dans ${top.evaluation.daysUntil} jours`;
    // On nomme les deux points les plus faibles de CETTE matière, pris dans
    // le classement de priorité — donc mesurés, jamais choisis au hasard.
    const sameSubject = priorities
      .filter((item) => item.subjectId === top.subjectId && item.chapterId !== null)
      .slice(0, 2)
      .map((item) => item.chapterName);
    const start =
      sameSubject.length >= 2
        ? `Commence par ${sameSubject[0]} et ${sameSubject[1]}, tes deux points les plus faibles.`
        : sameSubject.length === 1
          ? `Commence par ${sameSubject[0]}, ton point le plus faible.`
          : describeWeakness(top);
    body = `Ton ${top.evaluation.label.toLowerCase()} en ${top.subjectName} ${when}. ${start}`;
  } else {
    body = describeWeakness(top);
  }

  return {
    title: where,
    body,
    cardIds: top.cardIds,
    subjectId: top.subjectId,
    chapterId: top.chapterId,
    evaluation: top.evaluation,
  };
}

/** Une phrase, tirée du signal le plus parlant réellement mesuré. */
function describeWeakness(item: PriorityItem): string {
  if (item.masteryPct === null) return 'Ce chapitre n’a encore jamais été révisé.';
  if (item.successRate !== null && item.successRate < 0.6) {
    return `Tu n’y réussis que ${Math.round(item.successRate * 100)} % de tes réponses.`;
  }
  if (item.daysSinceReview !== null && item.daysSinceReview >= 14) {
    return `Tu n’y es pas revenu depuis ${item.daysSinceReview} jours.`;
  }
  return `Ta maîtrise y est de ${item.masteryPct} % — c’est ce qui te freine le plus aujourd’hui.`;
}
