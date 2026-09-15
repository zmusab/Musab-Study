import type { CalendarEvent, DayKey, ID, Recurrence } from '@/types';
import { addDays, dayKey, parseDayKey } from '@/lib/date';
import { weekdayOf } from './availability';

/**
 * COURS RÉCURRENTS — une série est UNE ligne, ses occurrences sont calculées.
 *
 * Écrire une ligne par séance de cours aurait rempli `calendarEvents` de
 * plusieurs centaines d'entrées par semestre, et rendu « décaler tout le
 * semestre » impraticable. Une série est donc une seule ligne portant sa
 * `recurrence` ; le calendrier la déplie à la lecture, sur la fenêtre qu'il
 * affiche.
 *
 * Trois cas seulement, tous dans la même table :
 *  - ligne ordinaire : ni `recurrence` ni `seriesId` — inchangée ;
 *  - ligne SÉRIE : `recurrence` non nul — jamais affichée telle quelle ;
 *  - ligne EXCEPTION : `seriesId` + `occurrenceDay` — remplace UNE occurrence,
 *    ou la supprime quand `cancelled` est vrai.
 *
 * Ce module est pur : il ne lit ni n'écrit la base. Les écritures (modifier
 * une occurrence, la série, ou la suite) vivent dans
 * `data/repositories/calendar.ts`.
 */

/** Sépare l'identifiant d'une occurrence calculée de celui de sa série. */
const OCCURRENCE_SEPARATOR = '~';

export const occurrenceId = (seriesId: ID, day: DayKey): ID =>
  `${seriesId}${OCCURRENCE_SEPARATOR}${day}`;

export function parseOccurrenceId(id: ID): { seriesId: ID; day: DayKey } | null {
  const at = id.lastIndexOf(OCCURRENCE_SEPARATOR);
  if (at < 0) return null;
  return { seriesId: id.slice(0, at), day: id.slice(at + 1) };
}

/** Vrai pour une occurrence calculée — elle n'existe pas en base sous cet id. */
export const isVirtualOccurrence = (event: Pick<CalendarEvent, 'id'>): boolean =>
  parseOccurrenceId(event.id) !== null;

/** Vrai pour tout événement appartenant à une série, réel ou calculé. */
export const belongsToSeries = (event: Pick<CalendarEvent, 'seriesId'>): boolean =>
  (event.seriesId ?? null) !== null;

/** Vrai pour la ligne de DÉFINITION d'une série. */
export const isSeriesMaster = (event: Pick<CalendarEvent, 'recurrence'>): boolean =>
  (event.recurrence ?? null) !== null;

/**
 * Jours où la série tombe réellement, dans la fenêtre demandée.
 *
 * La fenêtre est bornée des deux côtés : une série sans date de fin ne
 * produit que ce que l'appelant a demandé de voir, jamais une liste infinie.
 */
export function occurrenceDays(
  recurrence: Recurrence,
  from: DayKey,
  to: DayKey,
): DayKey[] {
  if (recurrence.weekdays.length === 0) return [];
  const start = from > recurrence.startDay ? from : recurrence.startDay;
  const end = recurrence.endDay !== null && recurrence.endDay < to ? recurrence.endDay : to;
  if (start > end) return [];

  const wanted = new Set(recurrence.weekdays);
  const days: DayKey[] = [];
  let cursor = parseDayKey(start);
  // Borne de sûreté : deux ans de créneaux quotidiens, très au-delà de toute
  // fenêtre d'affichage réelle. Sans elle, une date de fin aberrante saisie à
  // la main ferait tourner la boucle indéfiniment.
  for (let guard = 0; guard < 800; guard += 1) {
    const day = dayKey(cursor);
    if (day > end) break;
    if (wanted.has(weekdayOf(day))) days.push(day);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/**
 * Déplie les séries sur une fenêtre : la liste rendue ne contient que des
 * événements DATÉS, prêts à être affichés, chargés et planifiés. Tout le reste
 * du calendrier peut donc l'ignorer complètement.
 *
 * Les exceptions l'emportent sur la définition de la série, et une occurrence
 * annulée disparaît sans que la série en souffre.
 */
export function expandRecurring(
  events: readonly CalendarEvent[],
  from: DayKey,
  to: DayKey,
): CalendarEvent[] {
  const masters = events.filter(isSeriesMaster);
  const exceptions = events.filter((event) => !isSeriesMaster(event) && belongsToSeries(event));
  const plain = events.filter((event) => !isSeriesMaster(event) && !belongsToSeries(event));

  const overrides = new Map<string, CalendarEvent>();
  for (const exception of exceptions) {
    const day = exception.occurrenceDay ?? exception.day;
    overrides.set(`${exception.seriesId}${OCCURRENCE_SEPARATOR}${day}`, exception);
  }

  const expanded: CalendarEvent[] = [...plain];
  for (const master of masters) {
    for (const day of occurrenceDays(master.recurrence!, from, to)) {
      const override = overrides.get(occurrenceId(master.id, day));
      if (override) continue; // ajoutée plus bas, avec son propre identifiant
      expanded.push(occurrenceOf(master, day));
    }
  }

  // Les exceptions non annulées sont de vraies lignes : elles s'ajoutent
  // telles quelles, à condition de tomber dans la fenêtre.
  for (const exception of exceptions) {
    if (exception.cancelled) continue;
    if (exception.day < from || exception.day > to) continue;
    expanded.push(exception);
  }

  return expanded;
}

/** Une occurrence concrète d'une série, à la date voulue. */
export function occurrenceOf(master: CalendarEvent, day: DayKey): CalendarEvent {
  return {
    ...master,
    id: occurrenceId(master.id, day),
    day,
    // L'occurrence n'est pas elle-même une série : sans cela, elle serait
    // dépliée une seconde fois par tout code qui la relirait.
    recurrence: null,
    seriesId: master.id,
    occurrenceDay: day,
  };
}
