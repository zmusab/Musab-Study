import type { Chapter, DayKey, Flashcard, ID, ISODateTime, ReviewLog, Subject } from '@/types';
import { DEFAULT_EASE, scheduleNext, type SchedulingState } from '@/core/srs';
import { masteryPct } from '@/core/mastery';
import { DAY_MS, addDays, dayKey, dayKeyFromISO, parseDayKey } from '@/lib/date';

/**
 * PROGRESSION — toute la logique du tableau de bord, pure et testable.
 *
 * Règle unique et non négociable : chaque nombre rendu ici se déduit d'une
 * ligne réellement enregistrée. Aucune valeur de démonstration, aucune
 * moyenne « plausible », aucun historique fabriqué. Quand une statistique ne
 * peut pas être calculée faute de données, la fonction renvoie `null` et
 * l'interface affiche un état vide qui explique ce qui la déclenchera.
 *
 * Ce que l'application enregistre RÉELLEMENT aujourd'hui :
 *  - `flashcards` : l'état de répétition espacée (ease, intervalle, reps) —
 *    c'est lui qui porte la maîtrise ;
 *  - `reviewLogs` : une ligne par réponse donnée, avec `correct`, `rating`,
 *    `confidence` et `elapsedMs` (temps de réflexion réel) ;
 *  - `subjects` / `chapters` / `documents` : l'arborescence des cours.
 *
 * Ce que l'application n'enregistre PAS encore : les sessions de quiz (la
 * fonctionnalité n'existe pas), le temps de lecture d'un PDF (seule la
 * dernière ouverture est datée) et les sessions du mode apprentissage 3D.
 * Les sections correspondantes affichent un état vide honnête plutôt qu'une
 * estimation.
 */

// ────────────────────────────── Paliers de maîtrise ──────────────────────────────

export type MasteryBand = 'strong' | 'good' | 'fragile' | 'weak';

export interface BandMeta {
  band: MasteryBand;
  label: string;
  /** Variable CSS du thème — jamais une couleur écrite en dur. */
  colorVar: string;
}

const BANDS: readonly { min: number; meta: BandMeta }[] = [
  { min: 80, meta: { band: 'strong', label: 'Maîtrisé', colorVar: 'var(--success)' } },
  { min: 60, meta: { band: 'good', label: 'Correct', colorVar: 'var(--accent)' } },
  { min: 40, meta: { band: 'fragile', label: 'À revoir', colorVar: 'var(--warning)' } },
  { min: 0, meta: { band: 'weak', label: 'Faible', colorVar: 'var(--danger)' } },
];

/** Quatre paliers seulement : la page doit se lire d'un coup d'œil, pas se déchiffrer. */
export function masteryBand(pct: number): BandMeta {
  return (BANDS.find((entry) => pct >= entry.min) ?? BANDS[BANDS.length - 1]!).meta;
}

// ────────────────────────────── Seuils de fiabilité ──────────────────────────────

/**
 * En dessous de ces seuils, une statistique n'est pas affichée : mieux vaut
 * dire « pas encore assez de données » que publier un pourcentage calculé sur
 * deux réponses, qui donnerait une fausse impression de précision.
 */
export const MIN_REVIEWED_CARDS = 5;
export const MIN_REVIEWS_FOR_RATE = 4;
export const MIN_REVIEWS_FOR_WEAKNESS = 3;

// ────────────────────────────── Maîtrise globale ──────────────────────────────

export interface OverallMastery {
  /** Null tant que trop peu de cartes ont été réellement révisées. */
  pct: number | null;
  /** Cartes ayant au moins une révision enregistrée. */
  reviewedCards: number;
  totalCards: number;
  /** Combien de cartes révisées manquent encore pour publier un chiffre. */
  missing: number;
}

export function overallMastery(cards: readonly Flashcard[]): OverallMastery {
  const reviewed = cards.filter((card) => card.reps > 0);
  if (reviewed.length < MIN_REVIEWED_CARDS) {
    return {
      pct: null,
      reviewedCards: reviewed.length,
      totalCards: cards.length,
      missing: MIN_REVIEWED_CARDS - reviewed.length,
    };
  }
  // Moyenne sur TOUTES les cartes, pas seulement les révisées : une carte
  // jamais ouverte vaut réellement 0 % de maîtrise, l'ignorer gonflerait le
  // chiffre à mesure qu'on ajoute des cartes sans les travailler.
  const total = cards.reduce((sum, card) => sum + masteryPct(card), 0);
  return {
    pct: Math.round(total / cards.length),
    reviewedCards: reviewed.length,
    totalCards: cards.length,
    missing: 0,
  };
}

// ────────────────────────────── Temps et volume ──────────────────────────────

export interface DayBucket {
  day: DayKey;
  ms: number;
  reviews: number;
  correct: number;
}

/** Agrège le journal par jour civil — la base de tous les graphiques temporels. */
export function bucketByDay(logs: readonly ReviewLog[], days: readonly DayKey[]): DayBucket[] {
  const byDay = new Map<DayKey, DayBucket>();
  for (const day of days) byDay.set(day, { day, ms: 0, reviews: 0, correct: 0 });
  for (const log of logs) {
    const bucket = byDay.get(log.day);
    if (!bucket) continue;
    bucket.ms += log.elapsedMs;
    bucket.reviews += 1;
    if (log.correct) bucket.correct += 1;
  }
  return days.map((day) => byDay.get(day)!);
}

/** Lundi de la semaine contenant `date` — la semaine française commence lundi. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (start.getDay() + 6) % 7; // 0 = lundi
  return addDays(start, -weekday);
}

export function weekDays(date: Date): DayKey[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => dayKey(addDays(monday, i)));
}

export interface StudyTime {
  todayMs: number;
  weekMs: number;
  monthMs: number;
  previousWeekMs: number;
  /** Variation en % par rapport à la semaine précédente — null si celle-ci était vide. */
  weekDeltaPct: number | null;
  /** Les sept jours de la semaine en cours, du lundi au dimanche. */
  week: DayBucket[];
  /** Jour de la semaine où le temps cumulé est le plus élevé — null si aucun. */
  bestDay: DayBucket | null;
}

export function studyTime(logs: readonly ReviewLog[], now: Date = new Date()): StudyTime {
  const today = dayKey(now);
  const thisWeek = weekDays(now);
  const previousWeek = weekDays(addDays(startOfWeek(now), -7));
  const monthPrefix = today.slice(0, 7);

  const week = bucketByDay(logs, thisWeek);
  const weekMs = week.reduce((sum, bucket) => sum + bucket.ms, 0);
  const previousWeekMs = bucketByDay(logs, previousWeek).reduce((sum, b) => sum + b.ms, 0);
  const todayMs = logs.filter((log) => log.day === today).reduce((sum, log) => sum + log.elapsedMs, 0);
  const monthMs = logs
    .filter((log) => log.day.startsWith(monthPrefix))
    .reduce((sum, log) => sum + log.elapsedMs, 0);

  const active = week.filter((bucket) => bucket.ms > 0);
  const bestDay = active.length > 0 ? active.reduce((best, b) => (b.ms > best.ms ? b : best)) : null;

  return {
    todayMs,
    weekMs,
    monthMs,
    previousWeekMs,
    // Une variation par rapport à zéro n'a pas de sens : on préfère ne rien
    // annoncer plutôt qu'un « +∞ % » ou un « +100 % » trompeur.
    weekDeltaPct: previousWeekMs > 0 ? Math.round(((weekMs - previousWeekMs) / previousWeekMs) * 100) : null,
    week,
    bestDay,
  };
}

export interface AnswerStats {
  total: number;
  correct: number;
  /** Null tant que trop peu de réponses ont été données. */
  successRate: number | null;
}

export function answerStats(logs: readonly ReviewLog[]): AnswerStats {
  const correct = logs.filter((log) => log.correct).length;
  return {
    total: logs.length,
    correct,
    successRate: logs.length >= MIN_REVIEWS_FOR_RATE ? correct / logs.length : null,
  };
}

// ────────────────────────────── Régularité ──────────────────────────────

export interface Streak {
  current: number;
  longest: number;
  /** Les sept jours de la semaine en cours, avec activité réelle ou non. */
  week: { day: DayKey; active: boolean; isToday: boolean; isFuture: boolean }[];
  totalActiveDays: number;
}

/**
 * Série de jours consécutifs avec au moins une révision enregistrée.
 *
 * La série reste intacte tant qu'aujourd'hui n'est pas terminé : ne pas avoir
 * encore révisé ce matin ne doit pas effacer six jours de travail. Elle
 * repart donc d'hier si aujourd'hui est vide, et tombe à zéro seulement quand
 * hier l'était aussi.
 */
export function computeStreak(logs: readonly ReviewLog[], now: Date = new Date()): Streak {
  const activeDays = new Set(logs.map((log) => log.day));
  const today = dayKey(now);

  let current = 0;
  let cursor = activeDays.has(today) ? new Date(now) : addDays(now, -1);
  while (activeDays.has(dayKey(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  const sorted = [...activeDays].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous !== null && parseDayKey(day).getTime() - parseDayKey(previous).getTime() === DAY_MS ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  return {
    current,
    longest,
    totalActiveDays: activeDays.size,
    week: weekDays(now).map((day) => ({
      day,
      active: activeDays.has(day),
      isToday: day === today,
      isFuture: day > today,
    })),
  };
}

// ────────────────────────────── Progression par matière ──────────────────────────────

export interface SubjectProgress {
  subject: Subject;
  masteryPct: number | null;
  cards: number;
  reviewedCards: number;
  dueCards: number;
  reviews: number;
  successRate: number | null;
  studyMs: number;
  chaptersTotal: number;
  /** Chapitres ayant au moins une carte révisée — « étudiés », pas « existants ». */
  chaptersStudied: number;
  lastReviewAt: ISODateTime | null;
}

export function subjectProgress(
  subjects: readonly Subject[],
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: readonly ReviewLog[],
  now: Date = new Date(),
): SubjectProgress[] {
  const nowIso = now.toISOString();
  return subjects
    .map((subject) => {
      const subjectCards = cards.filter((card) => card.subjectId === subject.id);
      const subjectLogs = logs.filter((log) => log.subjectId === subject.id);
      const reviewed = subjectCards.filter((card) => card.reps > 0);
      const studiedChapters = new Set(
        reviewed.map((card) => card.chapterId).filter((id): id is ID => id !== null),
      );
      const stats = answerStats(subjectLogs);
      return {
        subject,
        masteryPct:
          reviewed.length > 0
            ? Math.round(subjectCards.reduce((sum, card) => sum + masteryPct(card), 0) / subjectCards.length)
            : null,
        cards: subjectCards.length,
        reviewedCards: reviewed.length,
        dueCards: subjectCards.filter((card) => card.due <= nowIso).length,
        reviews: stats.total,
        successRate: stats.successRate,
        studyMs: subjectLogs.reduce((sum, log) => sum + log.elapsedMs, 0),
        chaptersTotal: chapters.filter((chapter) => chapter.subjectId === subject.id).length,
        chaptersStudied: studiedChapters.size,
        lastReviewAt: latestAt(subjectLogs),
      };
    })
    // Une matière sans aucune carte n'a rien à montrer : elle serait une ligne
    // vide en permanence. Elle reste bien sûr dans « Cours ».
    .filter((entry) => entry.cards > 0)
    .sort((a, b) => (a.masteryPct ?? -1) - (b.masteryPct ?? -1));
}

export interface ChapterProgress {
  chapterId: ID | null;
  name: string;
  masteryPct: number | null;
  cards: number;
  reviewedCards: number;
  reviews: number;
  successRate: number | null;
  studyMs: number;
  lastReviewAt: ISODateTime | null;
}

/**
 * Détail d'une matière, chapitre par chapitre. Les cartes rattachées à aucun
 * chapitre sont regroupées explicitement — les cacher ferait mentir le total.
 */
export function chapterProgress(
  subjectId: ID,
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: readonly ReviewLog[],
): ChapterProgress[] {
  const subjectCards = cards.filter((card) => card.subjectId === subjectId);
  const subjectChapters = chapters.filter((chapter) => chapter.subjectId === subjectId);

  const build = (chapterId: ID | null, name: string): ChapterProgress => {
    const chapterCards = subjectCards.filter((card) => card.chapterId === chapterId);
    const chapterLogs = logs.filter((log) => log.subjectId === subjectId && log.chapterId === chapterId);
    const reviewed = chapterCards.filter((card) => card.reps > 0);
    const stats = answerStats(chapterLogs);
    return {
      chapterId,
      name,
      masteryPct:
        chapterCards.length > 0 && reviewed.length > 0
          ? Math.round(chapterCards.reduce((sum, card) => sum + masteryPct(card), 0) / chapterCards.length)
          : null,
      cards: chapterCards.length,
      reviewedCards: reviewed.length,
      reviews: stats.total,
      successRate: stats.successRate,
      studyMs: chapterLogs.reduce((sum, log) => sum + log.elapsedMs, 0),
      lastReviewAt: latestAt(chapterLogs),
    };
  };

  const rows = subjectChapters.map((chapter) => build(chapter.id, chapter.name));
  const orphan = build(null, 'Sans chapitre');
  if (orphan.cards > 0) rows.push(orphan);
  return rows.filter((row) => row.cards > 0).sort((a, b) => (a.masteryPct ?? -1) - (b.masteryPct ?? -1));
}

// ────────────────────────────── Points faibles ──────────────────────────────

export type WeakScope = 'chapter' | 'card';

export interface WeakPoint {
  id: string;
  scope: WeakScope;
  title: string;
  subjectName: string;
  successRate: number;
  reviews: number;
  lastReviewAt: ISODateTime | null;
  /** Identifiants de cartes à ouvrir dans la séance de révision ciblée. */
  cardIds: ID[];
}

const WEAK_RATE_CEILING = 0.75;

/**
 * Points faibles RÉELS : un chapitre (ou une carte isolée) dont le taux de
 * réussite mesuré reste sous 75 % sur un nombre suffisant de réponses.
 *
 * On agrège d'abord par chapitre, parce que c'est à ce niveau que l'on révise ;
 * les cartes sans chapitre remontent individuellement plutôt que d'être
 * fondues dans un faux regroupement.
 */
export function weakPoints(
  subjects: readonly Subject[],
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: readonly ReviewLog[],
  limit = 5,
): WeakPoint[] {
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const chapterName = new Map(chapters.map((c) => [c.id, c.name]));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const groups = new Map<string, { logs: ReviewLog[]; cardIds: Set<ID> }>();
  for (const log of logs) {
    if (!cardById.has(log.itemId)) continue; // carte supprimée : on ne l'invente pas
    const key = log.chapterId ? `chapter:${log.chapterId}` : `card:${log.itemId}`;
    const group = groups.get(key) ?? { logs: [], cardIds: new Set<ID>() };
    group.logs.push(log);
    group.cardIds.add(log.itemId);
    groups.set(key, group);
  }

  const results: WeakPoint[] = [];
  for (const [key, group] of groups) {
    if (group.logs.length < MIN_REVIEWS_FOR_WEAKNESS) continue;
    const correct = group.logs.filter((log) => log.correct).length;
    const rate = correct / group.logs.length;
    if (rate >= WEAK_RATE_CEILING) continue;

    const first = group.logs[0]!;
    const isChapter = key.startsWith('chapter:');
    const title = isChapter
      ? (chapterName.get(first.chapterId!) ?? 'Chapitre supprimé')
      : (cardById.get(first.itemId)?.question ?? '');
    if (!title) continue;

    results.push({
      id: key,
      scope: isChapter ? 'chapter' : 'card',
      title,
      subjectName: subjectName.get(first.subjectId) ?? '',
      successRate: rate,
      reviews: group.logs.length,
      lastReviewAt: latestAt(group.logs),
      cardIds: [...group.cardIds],
    });
  }

  return results.sort((a, b) => a.successRate - b.successRate).slice(0, limit);
}

// ────────────────────────────── Recommandation ──────────────────────────────

export interface Recommendation {
  title: string;
  subjectName: string;
  masteryPct: number | null;
  successRate: number | null;
  lastReviewAt: ISODateTime | null;
  daysSinceReview: number | null;
  reason: string;
  cardIds: ID[];
}

/**
 * « Que réviser maintenant ? » — un seul choix, motivé.
 *
 * Trois signaux mesurés, pondérés puis additionnés : l'échec (taux de
 * réussite), l'oubli (jours écoulés depuis la dernière révision, plafonnés à
 * 30 pour qu'un chapitre abandonné ne domine pas éternellement) et l'urgence
 * (cartes dues). Sans aucune donnée exploitable, la fonction renvoie `null` et
 * la section reste vide plutôt que de proposer un sujet au hasard.
 */
export function recommendation(
  subjects: readonly Subject[],
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: readonly ReviewLog[],
  now: Date = new Date(),
): Recommendation | null {
  const nowIso = now.toISOString();
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const candidates: (Recommendation & { score: number })[] = [];

  for (const subject of subjects) {
    for (const chapter of chapterProgress(subject.id, chapters, cards, logs)) {
      const chapterCards = cards.filter(
        (card) => card.subjectId === subject.id && card.chapterId === chapter.chapterId,
      );
      const due = chapterCards.filter((card) => card.due <= nowIso);
      if (chapter.reviewedCards === 0 && due.length === 0) continue;

      const days =
        chapter.lastReviewAt === null
          ? null
          : Math.max(0, Math.round((now.getTime() - new Date(chapter.lastReviewAt).getTime()) / DAY_MS));

      const failure = chapter.successRate === null ? 0 : (1 - chapter.successRate) * 55;
      const forgetting = days === null ? 0 : Math.min(days, 30) * 1.2;
      const urgency = chapterCards.length > 0 ? (due.length / chapterCards.length) * 25 : 0;
      const weakness = chapter.masteryPct === null ? 0 : ((100 - chapter.masteryPct) / 100) * 30;
      const score = failure + forgetting + urgency + weakness;
      if (score <= 0) continue;

      candidates.push({
        // Les cartes sans chapitre ne forment pas un « chapitre » : la carte
        // se titre alors du nom de la matière, pas d'un « Sans chapitre »
        // qui se lirait comme un intitulé de cours.
        title: chapter.chapterId === null ? (subjectName.get(subject.id) ?? chapter.name) : chapter.name,
        subjectName: subjectName.get(subject.id) ?? '',
        masteryPct: chapter.masteryPct,
        successRate: chapter.successRate,
        lastReviewAt: chapter.lastReviewAt,
        daysSinceReview: days,
        reason: recommendationReason(chapter.successRate, days, due.length),
        cardIds: (due.length > 0 ? due : chapterCards).map((card) => card.id),
        score,
      });
    }
  }

  if (candidates.length === 0) return null;
  const best = candidates.sort((a, b) => b.score - a.score)[0]!;
  const { score: _score, ...rest } = best;
  return rest;
}

function recommendationReason(successRate: number | null, days: number | null, due: number): string {
  if (successRate !== null && successRate < 0.6) {
    return `Ton taux de réussite y est de ${Math.round(successRate * 100)} %.`;
  }
  if (days !== null && days >= 7) {
    return `Tu n’y es pas revenu depuis ${days} jours.`;
  }
  if (due > 0) return `${due} carte${due > 1 ? 's' : ''} y ${due > 1 ? 'sont dues' : 'est due'}.`;
  return 'C’est le chapitre le plus fragile de tes cours actuellement.';
}

// ────────────────────────────── Activité récente ──────────────────────────────

export interface ActivitySession {
  id: string;
  day: DayKey;
  subjectId: ID;
  subjectName: string;
  reviews: number;
  correct: number;
  ms: number;
  at: ISODateTime;
}

/**
 * Sessions réelles, reconstruites en regroupant le journal par jour et par
 * matière. Un « regroupement » n'invente rien : chaque session compte
 * exactement les réponses enregistrées ce jour-là dans cette matière.
 */
export function recentActivity(
  logs: readonly ReviewLog[],
  subjects: readonly Subject[],
  limit = 8,
): ActivitySession[] {
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const sessions = new Map<string, ActivitySession>();

  for (const log of logs) {
    const key = `${log.day}|${log.subjectId}`;
    const existing = sessions.get(key);
    if (existing) {
      existing.reviews += 1;
      existing.correct += log.correct ? 1 : 0;
      existing.ms += log.elapsedMs;
      if (log.at > existing.at) existing.at = log.at;
      continue;
    }
    sessions.set(key, {
      id: key,
      day: log.day,
      subjectId: log.subjectId,
      subjectName: subjectName.get(log.subjectId) ?? 'Matière supprimée',
      reviews: 1,
      correct: log.correct ? 1 : 0,
      ms: log.elapsedMs,
      at: log.at,
    });
  }

  return [...sessions.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

// ────────────────────────────── Évolution de la maîtrise ──────────────────────────────

export interface TrendPoint {
  day: DayKey;
  label: string;
  masteryPct: number;
  cards: number;
}

/**
 * Évolution de la maîtrise — RECONSTRUITE, jamais inventée.
 *
 * L'application ne stocke pas d'instantané hebdomadaire de la maîtrise. Mais
 * la planification est déterministe (`scheduleNext` est pure) et le journal
 * conserve la note et la confiance de chaque réponse : rejouer les révisions
 * d'une carte dans l'ordre redonne exactement l'état qu'elle avait à chaque
 * date. La courbe est donc un calcul sur des données réelles, pas une
 * interpolation.
 *
 * Limite assumée : `importance` et `difficulty` sont lues dans leur valeur
 * ACTUELLE. Si elles ont été modifiées depuis, les intervalles reconstitués
 * pour les révisions antérieures diffèrent légèrement de ceux d'alors.
 */
export function masteryTrend(
  cards: readonly Flashcard[],
  logs: readonly ReviewLog[],
  weeks = 6,
  now: Date = new Date(),
): TrendPoint[] {
  const cardLogs = new Map<ID, ReviewLog[]>();
  for (const log of logs) {
    if (log.itemKind !== 'card' || log.rating === null) continue;
    const list = cardLogs.get(log.itemId);
    if (list) list.push(log);
    else cardLogs.set(log.itemId, [log]);
  }
  for (const list of cardLogs.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  const monday = startOfWeek(now);
  const checkpoints: Date[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    // Fin de semaine, sauf pour la semaine en cours dont on prend l'instant présent.
    const end = addDays(monday, -7 * i + 6);
    checkpoints.push(i === 0 ? now : end);
  }

  const points: TrendPoint[] = [];
  for (const checkpoint of checkpoints) {
    const iso = checkpoint.toISOString();
    let sum = 0;
    let counted = 0;
    for (const card of cards) {
      if (card.createdAt > iso) continue; // la carte n'existait pas encore
      const state = replayUntil(card, cardLogs.get(card.id) ?? [], iso);
      sum += masteryPct(state);
      counted += 1;
    }
    if (counted === 0) continue;
    points.push({
      day: dayKey(checkpoint),
      label: weekLabel(checkpoint, now),
      masteryPct: Math.round(sum / counted),
      cards: counted,
    });
  }
  return points;
}

/** Rejoue les révisions d'une carte jusqu'à `iso` et renvoie son état à cette date. */
function replayUntil(card: Flashcard, cardLogs: readonly ReviewLog[], iso: ISODateTime): SchedulingState {
  let state: SchedulingState = {
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: card.createdAt,
    lastReview: null,
  };
  for (const log of cardLogs) {
    if (log.at > iso) break;
    state = scheduleNext(
      { ...state, importance: card.importance, difficulty: card.difficulty },
      log.rating!,
      log.confidence ?? 'medium',
      new Date(log.at),
    );
  }
  return state;
}

function weekLabel(checkpoint: Date, now: Date): string {
  const weeksAgo = Math.round((startOfWeek(now).getTime() - startOfWeek(checkpoint).getTime()) / (7 * DAY_MS));
  if (weeksAgo === 0) return 'Cette semaine';
  if (weeksAgo === 1) return 'Semaine dernière';
  return `Il y a ${weeksAgo} sem.`;
}

// ────────────────────────────── Prochaines révisions ──────────────────────────────

export interface UpcomingDay {
  day: DayKey;
  label: string;
  cards: number;
  subjects: { name: string; cards: number }[];
}

/**
 * Prochaines échéances réelles, lues sur le champ `due` des cartes — la
 * répétition espacée existe déjà, il n'y a donc rien à simuler ici. Les cartes
 * en retard sont ramenées sur aujourd'hui : c'est bien aujourd'hui qu'il faut
 * les faire.
 */
export function upcomingReviews(
  cards: readonly Flashcard[],
  subjects: readonly Subject[],
  days = 7,
  now: Date = new Date(),
): UpcomingDay[] {
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const today = dayKey(now);
  const horizon = Array.from({ length: days }, (_, i) => dayKey(addDays(now, i)));
  const index = new Map(horizon.map((day, i) => [day, i]));

  const buckets = horizon.map<UpcomingDay>((day, i) => ({
    day,
    label: i === 0 ? 'Aujourd’hui' : i === 1 ? 'Demain' : capitalize(WEEKDAY.format(parseDayKey(day))),
    cards: 0,
    subjects: [],
  }));

  for (const card of cards) {
    const due = dayKeyFromISO(card.due);
    const slot = due <= today ? 0 : index.get(due);
    if (slot === undefined) continue;
    const bucket = buckets[slot]!;
    bucket.cards += 1;
    const name = subjectName.get(card.subjectId) ?? 'Matière supprimée';
    const entry = bucket.subjects.find((s) => s.name === name);
    if (entry) entry.cards += 1;
    else bucket.subjects.push({ name, cards: 1 });
  }

  for (const bucket of buckets) bucket.subjects.sort((a, b) => b.cards - a.cards);
  return buckets;
}

const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// ────────────────────────────── Objectifs ──────────────────────────────

export interface GoalProgress {
  label: string;
  current: number;
  target: number;
  pct: number;
  /** Formatage laissé à l'interface : le cœur ne connaît pas les unités d'affichage. */
  kind: 'minutes' | 'reviews';
  /**
   * Valeur brute en millisecondes pour un objectif de temps. Sans elle,
   * l'objectif afficherait « 0 s » (minutes arrondies) là où la section
   * « Temps d'étude » affiche « 7 s » : deux chiffres justes qui se
   * contredisent à l'écran.
   */
  currentMs: number | null;
}

export function goalProgress(
  goals: { weeklyStudyMinutes: number; weeklyReviews: number },
  logs: readonly ReviewLog[],
  now: Date = new Date(),
): GoalProgress[] {
  const week = new Set(weekDays(now));
  const weekLogs = logs.filter((log) => week.has(log.day));
  const minutes = Math.round(weekLogs.reduce((sum, log) => sum + log.elapsedMs, 0) / 60_000);

  const totalMs = weekLogs.reduce((sum, log) => sum + log.elapsedMs, 0);
  const build = (
    label: string,
    current: number,
    target: number,
    kind: GoalProgress['kind'],
    currentMs: number | null = null,
  ): GoalProgress => ({
    label,
    current,
    target,
    pct: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
    kind,
    currentMs,
  });

  return [
    build('Temps de révision', minutes, goals.weeklyStudyMinutes, 'minutes', totalMs),
    build('Réponses données', weekLogs.length, goals.weeklyReviews, 'reviews'),
  ];
}

// ────────────────────────────── Utilitaires ──────────────────────────────

function latestAt(logs: readonly ReviewLog[]): ISODateTime | null {
  let latest: ISODateTime | null = null;
  for (const log of logs) if (latest === null || log.at > latest) latest = log.at;
  return latest;
}

/** « 1 h 42 » / « 18 min » / « 45 s » — jamais « 0.7 h ». */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.max(0, Math.round(ms / 1000))} s`;
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, '0')}`;
}
