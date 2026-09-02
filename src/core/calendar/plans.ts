import type { CalendarEvent, Chapter, DayKey, Flashcard, ID, Subject } from '@/types';
import { addDays, dayKey, daysBetweenDayKeys, parseDayKey } from '@/lib/date';
import { chapterProgress } from '@/core/progress';
import { eventKindMeta } from './index';
import { firstFreeWindow, DEFAULT_AVAILABILITY, type Availability } from './availability';
import {
  committedMinutes,
  scheduleSessions,
  type ScheduleResult,
  type ScheduledSession,
  type SchedulingConfig,
  type SessionRequest,
} from './planner';

/**
 * CONSTRUCTION DES PLANS — quoi travailler, avant de décider quand.
 *
 * Ce module décide du CONTENU des séances à partir de mesures réelles
 * (maîtrise, taux d'erreur, cartes dues) ; `planner.ts` décide ensuite du
 * CRÉNEAU en tenant compte de la charge des journées et des disponibilités
 * déclarées. Séparer les deux permet de tester le « quoi » sans dépendre du
 * calendrier, et le « quand » sans dépendre des flashcards.
 *
 * Rien n'est écrit en base ici : un plan est une PROPOSITION.
 */

export type PlannedSession = ScheduledSession;

type Logs = Parameters<typeof chapterProgress>[3];

export interface PlanOptions {
  minutesPerSession?: number;
  maxSessions?: number;
  availability?: Availability;
  events?: readonly CalendarEvent[];
  config?: Partial<SchedulingConfig>;
}

export interface StudyPlan extends ScheduleResult {
  sessions: PlannedSession[];
  availableDays: number;
  blocked: string | null;
}

const DEFAULT_MINUTES = 45;
const DEFAULT_MAX_SESSIONS = 10;

/**
 * Plan de révision avant une évaluation.
 *
 * Trois règles, toutes fondées sur des mesures : les chapitres les plus
 * faibles reçoivent le plus de séances, les séances sont réparties plutôt que
 * massées, et la veille est réservée à une révision générale. Une seule
 * séance par jour : c'est l'espacement qui fait tenir la mémoire, pas
 * l'accumulation.
 */
export function planStudySessions(
  examDay: DayKey,
  subjectId: ID,
  subjectName: string,
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: Logs,
  now: Date = new Date(),
  options: PlanOptions = {},
): StudyPlan {
  const minutes = options.minutesPerSession ?? DEFAULT_MINUTES;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const availability = options.availability ?? DEFAULT_AVAILABILITY;
  const events = options.events ?? [];
  const today = dayKey(now);

  const empty = (blocked: string, availableDays = 0): StudyPlan => ({
    sessions: [],
    unplaced: [],
    loads: [],
    availableDays,
    blocked,
  });

  const daysUntil = daysBetweenDayKeys(today, examDay);
  if (daysUntil <= 0) return empty('L’évaluation est aujourd’hui ou déjà passée.');

  const available: DayKey[] = Array.from({ length: daysUntil }, (_, i) => dayKey(addDays(now, i)));

  const rows = chapterProgress(subjectId, chapters, cards, logs).filter((row) => row.cards > 0);
  if (rows.length === 0) {
    return empty('Cette matière n’a aucune flashcard : il n’y a rien à répartir.', available.length);
  }

  const cardsOf = (chapterId: ID | null) =>
    cards
      .filter((card) => card.subjectId === subjectId && card.chapterId === chapterId)
      .map((card) => card.id);

  // Poids : la faiblesse mesurée, jamais une importance déclarée.
  const weighted = rows
    .map((row) => ({ row, weight: row.masteryPct === null ? 1 : Math.max(0.15, 1 - row.masteryPct / 100) }))
    .sort((a, b) => b.weight - a.weight);

  const generalDay = available[available.length - 1]!;
  const workDayCount = Math.max(0, available.length - 1);
  const sessionCount = Math.min(
    workDayCount,
    maxSessions - 1,
    Math.max(2, weighted.length * 2),
  );

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const quota = weighted.map((entry) => ({
    ...entry,
    slots: Math.max(1, Math.round((entry.weight / totalWeight) * sessionCount)),
  }));

  // File d'attente alternée : le chapitre le plus faible revient le plus
  // souvent, sans enchaîner cinq séances sur le même sujet.
  const queue: (typeof quota)[number][] = [];
  let remaining = quota.map((entry) => ({ entry, left: entry.slots }));
  while (queue.length < sessionCount && remaining.some((item) => item.left > 0)) {
    for (const item of remaining) {
      if (item.left <= 0 || queue.length >= sessionCount) continue;
      queue.push(item.entry);
      item.left -= 1;
    }
    remaining = remaining.filter((item) => item.left > 0);
  }

  const requests: SessionRequest[] = queue.map((entry) => ({
    subjectId,
    subjectName,
    chapterId: entry.row.chapterId,
    chapterName: entry.row.name,
    title: `${subjectName} — ${entry.row.name}`,
    reason:
      entry.row.masteryPct === null
        ? 'Jamais révisé'
        : `Maîtrise ${entry.row.masteryPct} %${entry.row.successRate !== null ? ` · ${Math.round(entry.row.successRate * 100)} % de réussite` : ''}`,
    minutes,
    cardIds: cardsOf(entry.row.chapterId),
    deadline: generalDay,
    planForEventId: null,
  }));

  const scheduled = scheduleSessions(requests, events, availability, {
    now,
    horizonDays: Math.min(daysUntil, 60),
    // Une séance par jour : un plan d'examen s'étale, il ne se masse pas.
    config: { maxSessionsPerDay: 1, ...options.config },
  });

  const sessions = [...scheduled.sessions];

  // La veille est réservée à une relecture d'ensemble. Elle est ÉPINGLÉE :
  // c'est la seule séance dont la date est imposée par sa nature.
  if (available.length > 1) {
    const eveSlot = firstFreeWindow(
      availability,
      events.filter((event) => event.day === generalDay && event.startTime).map((event) => ({
        start: event.startTime!,
        end: event.endTime ?? event.startTime!,
      })),
      minutes,
    );
    sessions.push({
      day: generalDay,
      startTime: eveSlot?.start ?? null,
      endTime: eveSlot?.end ?? null,
      subjectId,
      subjectName,
      chapterId: null,
      title: `${subjectName} — révision générale`,
      reason: 'Veille de l’évaluation : relecture de l’ensemble',
      minutes,
      cardIds: cards.filter((card) => card.subjectId === subjectId).map((card) => card.id),
      planForEventId: null,
      dayLevel: 'light',
    });
  }

  return { ...scheduled, sessions, availableDays: available.length, blocked: null };
}

// ────────────────────────────── Plan de la semaine ──────────────────────────────

export interface WeekPlanInput {
  events: readonly CalendarEvent[];
  subjects: readonly Subject[];
  chapters: readonly Chapter[];
  cards: readonly Flashcard[];
  logs: Logs;
  availability: Availability;
  /** Objectif hebdomadaire de minutes, lu dans le profil. */
  weeklyGoalMinutes: number;
  minutesPerSession?: number;
  now?: Date;
  days?: number;
}

export interface WeekPlan extends ScheduleResult {
  sessions: PlannedSession[];
  /** Minutes déjà engagées sur la fenêtre, avant ce plan. */
  committedMinutes: number;
  /** Minutes que le plan ajoute. */
  addedMinutes: number;
  goalMinutes: number;
  blocked: string | null;
}

/**
 * « Planifier ma semaine » — un plan transversal, toutes matières confondues.
 *
 * Il croise ce qui est réellement enregistré : les évaluations à venir (les
 * matières concernées passent devant), les chapitres faibles, les cartes en
 * retard, les séances déjà posées et l'objectif hebdomadaire du profil, qui
 * sert de BUDGET — le plan s'arrête quand il est atteint plutôt que de
 * remplir la semaine.
 *
 * Comme partout ailleurs : proposition seule, rien n'est écrit.
 */
export function planWeek(input: WeekPlanInput): WeekPlan {
  const now = input.now ?? new Date();
  const horizon = input.days ?? 7;
  const minutes = input.minutesPerSession ?? DEFAULT_MINUTES;
  const today = dayKey(now);
  const window: DayKey[] = Array.from({ length: horizon }, (_, i) => dayKey(addDays(now, i)));

  const empty = (blocked: string): WeekPlan => ({
    sessions: [],
    unplaced: [],
    loads: [],
    committedMinutes: committedMinutes(input.events, window),
    addedMinutes: 0,
    goalMinutes: input.weeklyGoalMinutes,
    blocked,
  });

  const subjectsWithCards = input.subjects.filter((subject) =>
    input.cards.some((card) => card.subjectId === subject.id),
  );
  if (subjectsWithCards.length === 0) {
    return empty('Aucune matière ne contient de flashcard : il n’y a rien à planifier.');
  }

  const already = committedMinutes(input.events, window);
  const budget = Math.max(0, input.weeklyGoalMinutes - already);
  if (budget < minutes) {
    return empty(
      `Ton objectif hebdomadaire (${input.weeklyGoalMinutes} min) est déjà couvert par ce qui est planifié.`,
    );
  }

  const nowIso = now.toISOString();
  const evaluations = input.events.filter(
    (event) =>
      eventKindMeta(event.kind).family === 'evaluation' &&
      !event.done &&
      event.day >= today &&
      daysBetweenDayKeys(today, event.day) <= 30,
  );
  const nextExamOf = new Map<ID, CalendarEvent>();
  for (const event of [...evaluations].sort((a, b) => a.day.localeCompare(b.day))) {
    if (event.subjectId && !nextExamOf.has(event.subjectId)) nextExamOf.set(event.subjectId, event);
  }

  /**
   * Une demande par chapitre travaillable, avec un score qui croise les
   * mesures disponibles : faiblesse, cartes dues, et proximité d'une
   * évaluation réellement inscrite au calendrier.
   */
  const candidates: (SessionRequest & { score: number })[] = [];
  for (const subject of subjectsWithCards) {
    const exam = nextExamOf.get(subject.id) ?? null;
    const examProximity = exam ? Math.max(0, 30 - daysBetweenDayKeys(today, exam.day)) / 30 : 0;

    for (const row of chapterProgress(subject.id, input.chapters, input.cards, input.logs)) {
      if (row.cards === 0) continue;
      const chapterCards = input.cards.filter(
        (card) => card.subjectId === subject.id && card.chapterId === row.chapterId,
      );
      const dueCards = chapterCards.filter((card) => card.due <= nowIso).length;
      const weakness = row.masteryPct === null ? 1 : Math.max(0, 1 - row.masteryPct / 100);
      const errorRate = row.successRate === null ? 0 : 1 - row.successRate;
      const dueShare = chapterCards.length > 0 ? dueCards / chapterCards.length : 0;

      const score = weakness * 45 + errorRate * 20 + dueShare * 20 + examProximity * 40;
      if (score <= 0) continue;

      candidates.push({
        subjectId: subject.id,
        subjectName: subject.name,
        chapterId: row.chapterId,
        chapterName: row.name,
        title: `${subject.name} — ${row.chapterId === null ? 'révision' : row.name}`,
        reason: buildReason(row.masteryPct, row.successRate, dueCards, exam, today),
        minutes,
        cardIds: chapterCards.map((card) => card.id),
        deadline: exam ? exam.day : null,
        planForEventId: exam ? exam.id : null,
        score,
      });
    }
  }

  if (candidates.length === 0) {
    return empty('Rien à renforcer pour l’instant : aucune mesure ne fait ressortir de chapitre faible.');
  }

  candidates.sort((a, b) => b.score - a.score);

  // Le budget décide du NOMBRE de séances, la mesure décide de leur ordre.
  const maxByBudget = Math.floor(budget / minutes);
  const requests = interleaveBySubject(candidates).slice(0, Math.max(1, maxByBudget));

  const scheduled = scheduleSessions(requests, input.events, input.availability, {
    now,
    horizonDays: horizon,
  });

  return {
    ...scheduled,
    committedMinutes: already,
    addedMinutes: scheduled.sessions.reduce((total, session) => total + session.minutes, 0),
    goalMinutes: input.weeklyGoalMinutes,
    blocked: scheduled.sessions.length === 0 ? 'Aucun créneau libre sur tes plages disponibles.' : null,
  };
}

/**
 * Alterne les matières tout en gardant l'ordre de priorité : sans cela, une
 * matière très faible monopoliserait toute la semaine.
 */
function interleaveBySubject<T extends { subjectId: ID }>(items: readonly T[]): T[] {
  const bySubject = new Map<ID, T[]>();
  for (const item of items) {
    const list = bySubject.get(item.subjectId);
    if (list) list.push(item);
    else bySubject.set(item.subjectId, [item]);
  }
  const queues = [...bySubject.values()];
  const result: T[] = [];
  while (result.length < items.length) {
    let added = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (next) {
        result.push(next);
        added = true;
      }
    }
    if (!added) break;
  }
  return result;
}

function buildReason(
  masteryPct: number | null,
  successRate: number | null,
  dueCards: number,
  exam: CalendarEvent | null,
  today: DayKey,
): string {
  const parts: string[] = [];
  if (exam) {
    const days = daysBetweenDayKeys(today, exam.day);
    parts.push(
      days === 0
        ? `${eventKindMeta(exam.kind).label} aujourd’hui`
        : `${eventKindMeta(exam.kind).label} dans ${days} j`,
    );
  }
  if (masteryPct === null) parts.push('jamais révisé');
  else parts.push(`maîtrise ${masteryPct} %`);
  if (successRate !== null && successRate < 0.75) parts.push(`${Math.round(successRate * 100)} % de réussite`);
  if (dueCards > 0) parts.push(`${dueCards} carte${dueCards > 1 ? 's' : ''} due${dueCards > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/** Jour suivant, utilitaire partagé par les vues de plan. */
export const nextDay = (day: DayKey): DayKey => dayKey(addDays(parseDayKey(day), 1));
