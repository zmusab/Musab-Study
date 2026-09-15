import type { CalendarEvent, DayKey, ID } from '@/types';
import { addDays, dayKey, parseDayKey } from '@/lib/date';
import { eventKindMeta, isStudySession } from './index';
import {
  SLOT_ORDER,
  availabilityFor,
  availableMinutes,
  busyRanges,
  toMinutes,
  type DayAvailability,
  type TimeRange,
  type WeeklyAvailability,
} from './availability';

/**
 * CHARGE D'UNE JOURNÉE — combien de travail y est déjà engagé.
 *
 * Elle se calcule sur les événements RÉELLEMENT enregistrés, jamais sur une
 * estimation de ce que la journée « devrait » contenir. Trois niveaux
 * seulement : au-delà, la nuance ne se verrait pas et n'aiderait personne à
 * décider.
 *
 * Une journée d'évaluation est toujours considérée chargée : on n'y ajoute
 * pas une séance de révision d'une autre matière.
 *
 * Le travail DÉJÀ FAIT compte. Une séance terminée n'est plus une tâche à
 * effectuer, mais elle a bien occupé la journée : l'oublier ferait passer une
 * journée de quatre heures de révision pour une journée libre, et le
 * planificateur y empilerait de nouvelles séances. Les deux notions sont donc
 * séparées ici — `minutes` (tout ce qui a occupé le jour) d'un côté,
 * `sessions` (ce qu'il reste à faire) de l'autre.
 */

export type LoadLevel = 'light' | 'medium' | 'heavy';

export interface DayLoad {
  day: DayKey;
  /** Minutes engagées par les événements du jour — travail terminé COMPRIS. */
  minutes: number;
  /** Part de `minutes` déjà réellement travaillée (séances et tâches terminées). */
  workedMinutes: number;
  /** Part de `minutes` qui est du travail personnel — hors cours et évaluations. */
  studyMinutes: number;
  /** Minutes disponibles selon les plages déclarées de CE jour de la semaine. */
  capacity: number;
  /**
   * Ce qui reste de `capacity` une fois retiré ce qui est IMPOSÉ (cours,
   * évaluations, rendez-vous). C'est la place réellement offerte à une séance
   * d'étude : un lundi 8 h–12 h avec cours de 8 h à 10 h offre deux heures,
   * pas quatre — et pas zéro non plus.
   */
  freeCapacity: number;
  /** Séances d'étude encore à faire — c'est la file de travail du jour. */
  sessions: number;
  /** Séances d'étude déjà terminées : elles pèsent, mais ne sont plus à faire. */
  doneSessions: number;
  evaluations: number;
  /** Matières évaluées LE LENDEMAIN — une veille d'examen se ménage. */
  eveOfEvaluationFor: ID[];
  busy: TimeRange[];
  level: LoadLevel;
}

/**
 * Durée retenue pour un événement sans heure de fin. Un événement daté sans
 * horaire pèse tout de même sur la journée : l'ignorer laisserait croire
 * qu'une journée pleine de cours est libre.
 */
export const DEFAULT_EVENT_MINUTES = 60;
export const DEFAULT_EVALUATION_MINUTES = 120;

/** Seuils de charge, exprimés en part de la capacité réelle du jour. */
export const LOAD_THRESHOLDS = { medium: 0.35, heavy: 0.7 };

export function eventMinutes(event: CalendarEvent): number {
  if (event.startTime && event.endTime) {
    return Math.max(0, toMinutes(event.endTime) - toMinutes(event.startTime));
  }
  return eventKindMeta(event.kind).family === 'evaluation'
    ? DEFAULT_EVALUATION_MINUTES
    : DEFAULT_EVENT_MINUTES;
}

export function dayLoad(
  day: DayKey,
  events: readonly CalendarEvent[],
  availability: WeeklyAvailability,
): DayLoad {
  const sameDay = events.filter((event) => event.day === day);
  const todo = sameDay.filter((event) => !event.done);
  const done = sameDay.filter((event) => event.done);
  const nextDay = dayKey(addDays(parseDayKey(day), 1));
  // Une évaluation cochée « faite » ne ménage plus la veille : ce qui compte
  // ici, c'est ce qui reste à passer.
  const evaluationsTomorrow = events.filter(
    (event) => event.day === nextDay && eventKindMeta(event.kind).family === 'evaluation' && !event.done,
  );

  const total = (list: readonly CalendarEvent[]) =>
    list.reduce((sum, event) => sum + eventMinutes(event), 0);
  const minutes = total(sameDay);
  const workedMinutes = total(done);
  const studyMinutes = total(sameDay.filter(isStudySession));
  const slots = availabilityFor(availability, day);
  const capacity = availableMinutes(slots);
  const freeCapacity = Math.max(0, capacity - blockedMinutes(sameDay, slots));
  const evaluations = todo.filter((event) => eventKindMeta(event.kind).family === 'evaluation').length;

  const ratio = capacity > 0 ? minutes / capacity : 1;
  const level: LoadLevel =
    // Un jour d'évaluation est chargé par nature, quelle que soit sa durée
    // déclarée : on ne planifie pas une révision d'autre chose ce jour-là.
    evaluations > 0 || ratio >= LOAD_THRESHOLDS.heavy
      ? 'heavy'
      : ratio >= LOAD_THRESHOLDS.medium
        ? 'medium'
        : 'light';

  return {
    day,
    minutes,
    capacity,
    workedMinutes,
    studyMinutes,
    freeCapacity,
    sessions: todo.filter(isStudySession).length,
    doneSessions: done.filter(isStudySession).length,
    evaluations,
    eveOfEvaluationFor: evaluationsTomorrow
      .map((event) => event.subjectId)
      .filter((id): id is ID => id !== null),
    // Un créneau déjà travaillé reste occupé : on ne repose pas une séance
    // par-dessus une séance terminée.
    busy: busyRanges(sameDay, day),
    level,
  };
}

/**
 * « Journée légère » et non « Journée libre » : une journée peu chargée n'est
 * pas une journée vide, et l'agenda dit déjà « Journée libre » quand rien n'y
 * est inscrit. Deux états différents ne doivent pas porter le même mot.
 */
/**
 * Minutes des événements IMPOSÉS qui tombent dans les plages déclarées.
 *
 * Un cours de 8 h à 10 h ne prend rien à une disponibilité de 14 h à 18 h : il
 * ne réduit la place que là où il empiète réellement. Un événement daté sans
 * heure ne vise aucun créneau précis mais occupe bien la journée — on retient
 * alors sa durée entière, l'hypothèse la moins optimiste.
 */
function blockedMinutes(events: readonly CalendarEvent[], slots: DayAvailability): number {
  let blocked = 0;
  for (const event of events) {
    if (isStudySession(event)) continue;
    if (event.startTime === null) {
      blocked += eventMinutes(event);
      continue;
    }
    const start = toMinutes(event.startTime);
    const end = event.endTime ? toMinutes(event.endTime) : start + DEFAULT_EVENT_MINUTES;
    for (const id of SLOT_ORDER) {
      const slot = slots[id];
      if (!slot.enabled) continue;
      const overlap = Math.min(end, toMinutes(slot.end)) - Math.max(start, toMinutes(slot.start));
      if (overlap > 0) blocked += overlap;
    }
  }
  return blocked;
}

export const LOAD_LABELS: Record<LoadLevel, string> = {
  light: 'Journée légère',
  medium: 'Journée moyennement chargée',
  heavy: 'Journée chargée',
};

export const LOAD_COLORS: Record<LoadLevel, string> = {
  light: 'var(--mastery-3)',
  medium: 'var(--mastery-2)',
  heavy: 'var(--mastery-0)',
};
