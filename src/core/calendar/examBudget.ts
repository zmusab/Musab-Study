import type { CalendarEvent, DayKey } from '@/types';
import { addDays, dayKey, daysBetweenDayKeys, parseDayKey } from '@/lib/date';
import { dayLoad } from './load';
import { isStudySession } from './index';
import {
  availabilityFor,
  freeMinutesRemaining,
  toMinutes,
  type WeeklyAvailability,
} from './availability';

/**
 * TEMPS RÉELLEMENT DISPONIBLE D'ICI UNE ÉVALUATION.
 *
 * « Préparation 55 %, examen dans 6 jours » ne dit pas l'essentiel : six jours
 * ne valent pas la même chose selon qu'il reste vingt heures libres ou deux.
 * Cette fonction répond à la seule question qui décide de la suite — combien
 * de temps reste-t-il VRAIMENT — à partir de trois sources déjà saisies :
 *
 *  - les plages déclarées dans « Mes disponibilités » (l'emploi du temps que
 *    l'utilisateur s'est fixé) ;
 *  - les cours, rendez-vous et évaluations enregistrés au calendrier, qui
 *    mordent sur ces plages (`dayLoad.freeCapacity` fait déjà cette
 *    soustraction) ;
 *  - les séances de révision DÉJÀ planifiées, qui occupent une partie de ce
 *    qu'il reste.
 *
 * Rien n'est estimé ni extrapolé. Si aucune plage n'est déclarée, la capacité
 * vaut zéro et `hasDeclaredAvailability` vaut `false` : l'interface doit alors
 * dire « tu n'as déclaré aucune plage », jamais « tu n'as plus de temps » —
 * ce sont deux affirmations opposées, et une seule est vraie.
 */

export interface StudyBudget {
  /** Jours restants, jour de l'évaluation EXCLU (on ne révise pas pendant l'épreuve). */
  days: number;
  /**
   * Minutes libres sur ces jours, cours et rendez-vous déduits, avant même de
   * compter ce qui est déjà planifié.
   */
  freeMinutes: number;
  /** Minutes déjà occupées par des séances de révision planifiées sur la période. */
  plannedMinutes: number;
  /** `freeMinutes − plannedMinutes`, jamais négatif. */
  remainingMinutes: number;
  /** Combien de séances de la durée habituelle tiennent encore dans ce reste. */
  remainingSessions: number;
  /**
   * `false` quand aucune plage n'est déclarée pour aucun des jours restants.
   * Distingue « je n'ai plus de temps » de « je n'ai rien déclaré ».
   */
  hasDeclaredAvailability: boolean;
  /** L'évaluation est aujourd'hui ou passée : il n'y a plus rien à budgéter. */
  isOver: boolean;
}

/**
 * Portion d'aujourd'hui déjà écoulée : les heures passées ne sont plus
 * disponibles. Sans cette correction, un examen de demain annoncerait encore
 * quatre heures libres « aujourd'hui » à vingt-trois heures.
 */
function elapsedShareOfToday(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

export function studyBudgetUntil(
  examDay: DayKey,
  events: readonly CalendarEvent[],
  availability: WeeklyAvailability,
  sessionMinutes: number,
  now: Date = new Date(),
): StudyBudget {
  const today = dayKey(now);
  const daysUntil = daysBetweenDayKeys(today, examDay);

  const empty: StudyBudget = {
    days: 0,
    freeMinutes: 0,
    plannedMinutes: 0,
    remainingMinutes: 0,
    remainingSessions: 0,
    hasDeclaredAvailability: false,
    isOver: true,
  };
  if (daysUntil <= 0) return empty;

  const nowMinutes = elapsedShareOfToday(now);
  let freeMinutes = 0;
  let plannedMinutes = 0;
  let declaredCapacity = 0;

  for (let offset = 0; offset < daysUntil; offset += 1) {
    const day = dayKey(addDays(parseDayKey(today), offset));
    const load = dayLoad(day, events, availability);
    declaredCapacity += load.capacity;

    /*
      AUJOURD'HUI ne compte que pour ce qu'il en reste.
      Une première version retranchait la portion écoulée de `freeCapacity` :
      un cours déjà terminé était alors compté DEUX FOIS — une fois par
      `freeCapacity`, une fois par le temps écoulé qui le recouvre. À 15 h,
      une plage 14 h–18 h avec un cours de 14 h à 16 h annonçait 60 min libres
      au lieu de 120.
      `freeMinutesRemaining` fait la soustraction créneau par créneau et donne
      directement le bon chiffre. On garde le minimum avec `freeCapacity`, qui
      tient compte en plus des événements datés SANS horaire, absents des
      plages occupées.
    */
    const remainingToday = freeMinutesRemaining(
      availabilityFor(availability, day),
      load.busy,
      offset === 0 ? nowMinutes : 0,
    );
    freeMinutes += Math.max(0, Math.min(load.freeCapacity, remainingToday));

    plannedMinutes += events
      .filter((event) => event.day === day && isStudySession(event) && !event.done)
      .reduce((sum, event) => sum + sessionLength(event, sessionMinutes), 0);
  }

  const remainingMinutes = Math.max(0, freeMinutes - plannedMinutes);

  return {
    days: daysUntil,
    freeMinutes,
    plannedMinutes,
    remainingMinutes,
    remainingSessions: sessionMinutes > 0 ? Math.floor(remainingMinutes / sessionMinutes) : 0,
    hasDeclaredAvailability: declaredCapacity > 0,
    isOver: false,
  };
}

/**
 * Durée d'une séance planifiée. Une séance sans horaire vaut la durée
 * habituelle de l'utilisateur — c'est ce que le planificateur lui a réservé.
 */
function sessionLength(event: CalendarEvent, sessionMinutes: number): number {
  if (!event.startTime || !event.endTime) return sessionMinutes;
  const length = toMinutes(event.endTime) - toMinutes(event.startTime);
  return length > 0 ? length : sessionMinutes;
}
