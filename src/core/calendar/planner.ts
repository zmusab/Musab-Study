import type { CalendarEvent, DayKey, ID } from '@/types';
import { addDays, dayKey, daysBetweenDayKeys, parseDayKey } from '@/lib/date';
import { dayLoad, eventMinutes, type DayLoad } from './load';
import { isStudySession } from './index';
import {
  availabilityFor,
  firstFreeWindow,
  toMinutes,
  type TimeRange,
  type WeeklyAvailability,
} from './availability';

/**
 * MOTEUR DE PLANIFICATION — il place des séances, il ne prescrit rien.
 *
 * Tout ce qui suit est une HEURISTIQUE de répartition, au même titre que les
 * coefficients de `readinessConfig.ts` : ces poids traduisent une intuition
 * raisonnable (travailler ce qu'on maîtrise mal, espacer, ménager la veille
 * d'un examen), et rien de plus. Le planificateur ne sait pas combien
 * d'heures sont nécessaires pour réussir, et ne le prétend jamais.
 *
 * Deux garanties de fond :
 *  - il ne place RIEN sur un créneau déjà occupé ni hors des plages déclarées
 *    disponibles ;
 *  - quand une séance ne peut pas être placée, elle est rendue en clair avec
 *    sa raison, au lieu d'être glissée quelque part par défaut.
 *
 * Il tient compte du travail DÉJÀ FAIT : une journée où trois heures de
 * révision ont été menées à bien est une journée chargée, même si sa file de
 * tâches est vide. Le planificateur y ajoute donc moins volontiers qu'ailleurs.
 */

export interface SchedulingConfig {
  /** Séances au maximum sur une même journée — terminées comprises. */
  maxSessionsPerDay: number;
  /** Part de la capacité quotidienne qu'un plan s'autorise à occuper. */
  maxDayFill: number;
  /** Pénalités de score — plus c'est haut, plus le jour est évité. */
  loadPenalty: Record<'light' | 'medium' | 'heavy', number>;
  /** Veille d'une évaluation d'une AUTRE matière. */
  eveOfOtherExamPenalty: number;
  /** Veille de l'évaluation visée, pour une séance longue. */
  eveOfOwnExamPenalty: number;
  /** Par séance déjà posée la veille ou le lendemain — favorise l'espacement. */
  adjacencyPenalty: number;
  /**
   * Pénalité maximale pour une journée dont la capacité a déjà été
   * TRAVAILLÉE. Appliquée au prorata : une journée à moitié travaillée en
   * reçoit la moitié. C'est ce qui pousse le plan vers les jours réellement
   * disponibles plutôt que vers celui qu'on vient de remplir.
   */
  workedPenalty: number;
  /** Durée au-delà de laquelle une séance est considérée « grosse ». */
  longSessionMinutes: number;
}

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  maxSessionsPerDay: 2,
  maxDayFill: 0.7,
  loadPenalty: { light: 0, medium: 25, heavy: 60 },
  eveOfOtherExamPenalty: 70,
  eveOfOwnExamPenalty: 25,
  adjacencyPenalty: 12,
  workedPenalty: 45,
  longSessionMinutes: 45,
};

export interface SessionRequest {
  subjectId: ID;
  subjectName: string;
  chapterId: ID | null;
  chapterName: string | null;
  title: string;
  reason: string;
  minutes: number;
  cardIds: ID[];
  /** Dernier jour utile (exclu) — typiquement le jour de l'évaluation. */
  deadline?: DayKey | null;
  planForEventId?: ID | null;
  /** Séance de veille : elle a le droit de tomber juste avant SON évaluation. */
  isFinalReview?: boolean;
}

export interface ScheduledSession {
  day: DayKey;
  startTime: string | null;
  endTime: string | null;
  subjectId: ID;
  subjectName: string;
  chapterId: ID | null;
  title: string;
  reason: string;
  minutes: number;
  cardIds: ID[];
  planForEventId: ID | null;
  /** Niveau de charge du jour retenu, affiché avant validation. */
  dayLevel: DayLoad['level'];
}

export interface UnplacedSession {
  request: SessionRequest;
  reason: string;
}

export interface ScheduleResult {
  sessions: ScheduledSession[];
  unplaced: UnplacedSession[];
  /** Jours examinés, avec leur charge — sert à expliquer le résultat. */
  loads: DayLoad[];
}

/**
 * Place une liste de séances sur un horizon donné.
 *
 * L'ordre compte : les demandes arrivent triées par priorité, et la charge de
 * chaque jour est MISE À JOUR après chaque placement. C'est ce qui empêche
 * d'empiler cinq séances sur la première journée libre.
 */
export function scheduleSessions(
  requests: readonly SessionRequest[],
  events: readonly CalendarEvent[],
  availability: WeeklyAvailability,
  options: { now?: Date; horizonDays?: number; config?: Partial<SchedulingConfig> } = {},
): ScheduleResult {
  const now = options.now ?? new Date();
  const horizon = options.horizonDays ?? 21;
  const config = { ...DEFAULT_SCHEDULING_CONFIG, ...options.config };
  const today = dayKey(now);

  const days: DayKey[] = Array.from({ length: horizon }, (_, i) => dayKey(addDays(now, i)));
  const loads = new Map<DayKey, DayLoad>(days.map((day) => [day, dayLoad(day, events, availability)]));

  // Minutes ajoutées par le plan en cours de construction, et créneaux qu'il
  // a lui-même réservés : deux séances d'un même plan ne doivent pas se
  // chevaucher davantage qu'une séance et un cours existant.
  const planned = new Map<DayKey, { minutes: number; sessions: number; busy: TimeRange[] }>();
  const plannedFor = (day: DayKey) => {
    const existing = planned.get(day);
    if (existing) return existing;
    const created = { minutes: 0, sessions: 0, busy: [] as TimeRange[] };
    planned.set(day, created);
    return created;
  };

  const sessions: ScheduledSession[] = [];
  const unplaced: UnplacedSession[] = [];

  requests.forEach((request, index) => {
    const window = days.filter((day) => {
      if (day < today) return false;
      if (request.deadline && day >= request.deadline) return false;
      return true;
    });

    if (window.length === 0) {
      unplaced.push({ request, reason: 'Aucun jour disponible avant l’échéance.' });
      return;
    }

    // Cible idéale : les séances se répartissent régulièrement sur la fenêtre
    // plutôt que de se masser au début.
    const idealIndex = Math.min(
      window.length - 1,
      Math.floor(((index + 0.5) / Math.max(1, requests.length)) * window.length),
    );

    let best: { day: DayKey; score: number; slot: TimeRange } | null = null;
    let lastRefusal = 'Journées trop chargées ou créneaux occupés.';

    window.forEach((day, dayIndex) => {
      const load = loads.get(day)!;
      const extra = plannedFor(day);

      if (load.capacity === 0) {
        lastRefusal = 'Aucune plage horaire déclarée disponible.';
        return;
      }
      // Une séance terminée compte dans le quota : la journée a bien été
      // travaillée, même s'il n'y reste rien à faire.
      if (load.sessions + load.doneSessions + extra.sessions >= config.maxSessionsPerDay) return;
      // Le garde-fou porte sur le TRAVAIL PERSONNEL rapporté à la place
      // réellement libre. Un cours ne consomme pas ce budget : il a déjà
      // réduit `freeCapacity`. Sans cette distinction, une matinée de cours
      // rendrait la journée entière inutilisable, y compris les heures que
      // j'ai explicitement déclarées disponibles à côté.
      //
      // Et il ne s'applique qu'à partir de la DEUXIÈME séance : il sert à
      // empêcher d'empiler, pas à interdire de commencer. Refuser d'utiliser
      // deux heures libres parce qu'une séance de 90 min en occuperait 75 %
      // reviendrait à ne rien proposer les jours les plus contraints — ceux
      // où l'on en a le plus besoin.
      const studyPlanned = load.studyMinutes + extra.minutes;
      if (studyPlanned > 0 && studyPlanned + request.minutes > load.freeCapacity * config.maxDayFill) {
        return;
      }

      const slot = firstFreeWindow(
        availabilityFor(availability, day),
        [...load.busy, ...extra.busy],
        request.minutes,
      );
      if (!slot) return;

      let score = config.loadPenalty[load.level];
      score += Math.abs(dayIndex - idealIndex) * 3;

      // Travail déjà accompli ce jour-là : on préfère une journée encore
      // fraîche à une journée dont on a déjà tiré l'essentiel.
      if (load.capacity > 0) {
        score += Math.round(Math.min(1, load.workedMinutes / load.capacity) * config.workedPenalty);
      }

      // Veille d'évaluation : on ne pose pas une grosse séance devant un examen.
      if (load.eveOfEvaluationFor.length > 0) {
        const ownExamOnly = load.eveOfEvaluationFor.every((id) => id === request.subjectId);
        if (!ownExamOnly) score += config.eveOfOtherExamPenalty;
        else if (!request.isFinalReview && request.minutes > config.longSessionMinutes) {
          score += config.eveOfOwnExamPenalty;
        }
      }

      // Espacement : deux séances collées valent moins que deux séances
      // séparées, même charge égale.
      const neighbours = [dayKey(addDays(parseDayKey(day), -1)), dayKey(addDays(parseDayKey(day), 1))];
      for (const neighbour of neighbours) {
        const near = loads.get(neighbour);
        const nearPlanned = planned.get(neighbour);
        score += ((near?.sessions ?? 0) + (nearPlanned?.sessions ?? 0)) * config.adjacencyPenalty;
      }

      if (best === null || score < best.score) best = { day, score, slot };
    });

    if (best === null) {
      unplaced.push({ request, reason: lastRefusal });
      return;
    }

    const chosen = best as { day: DayKey; score: number; slot: TimeRange };
    const extra = plannedFor(chosen.day);
    extra.minutes += request.minutes;
    extra.sessions += 1;
    extra.busy.push(chosen.slot);

    sessions.push({
      day: chosen.day,
      startTime: chosen.slot.start,
      endTime: chosen.slot.end,
      subjectId: request.subjectId,
      subjectName: request.subjectName,
      chapterId: request.chapterId,
      title: request.title,
      reason: request.reason,
      minutes: request.minutes,
      cardIds: request.cardIds,
      planForEventId: request.planForEventId ?? null,
      dayLevel: loads.get(chosen.day)!.level,
    });
  });

  sessions.sort((a, b) => a.day.localeCompare(b.day) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  return { sessions, unplaced, loads: days.map((day) => loads.get(day)!) };
}

/**
 * Minutes d'ÉTUDE PERSONNELLE déjà engagées sur une semaine — sert au budget
 * hebdomadaire.
 *
 * Deux règles, opposées mais cohérentes :
 *  - le travail terminé compte : l'objectif porte sur des minutes de travail,
 *    et une séance faite en fait partie ; sans cela une semaine entièrement
 *    travaillée paraîtrait vide et le planificateur en proposerait autant une
 *    seconde fois ;
 *  - un cours universitaire, un examen ou un devoir NE comptent pas : ce n'est
 *    pas du travail personnel. Un emploi du temps chargé pèse sur la CHARGE
 *    des journées (voir `load.ts`), il ne remplit pas l'objectif d'étude.
 */
export function committedMinutes(events: readonly CalendarEvent[], days: readonly DayKey[]): number {
  const wanted = new Set(days);
  return events
    .filter((event) => wanted.has(event.day) && isStudySession(event))
    .reduce((total, event) => total + eventMinutes(event), 0);
}

/** Jours restants avant une échéance, aujourd'hui compris. */
export function daysBefore(deadline: DayKey, now: Date = new Date()): number {
  return Math.max(0, daysBetweenDayKeys(dayKey(now), deadline));
}

export { toMinutes };
