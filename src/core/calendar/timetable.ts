import type { CalendarEvent, WeekdayId } from '@/types';
import {
  SLOT_ORDER,
  fromMinutes,
  toMinutes,
  type WeeklyAvailability,
} from './availability';

/**
 * EMPLOI DU TEMPS D'UNE JOURNÉE TYPE — les cours, et ce qui reste entre eux.
 *
 * Logique pure : elle répond à « quand puis-je réellement travailler le
 * lundi ? » en retirant les cours des plages déclarées disponibles. C'est la
 * même soustraction que celle du planificateur (`firstFreeWindow`), présentée
 * cette fois pour être lue.
 *
 * Rien n'est inventé : sans plage déclarée, il n'y a aucun créneau libre à
 * afficher, et la vue le dit plutôt que d'en supposer.
 */

export interface TimetableRow {
  kind: 'lecture' | 'free';
  start: string;
  end: string;
  label: string;
  detail: string | null;
}

/** En dessous, un « créneau libre » n'est pas un créneau de travail. */
const MIN_FREE_MINUTES = 15;
/** Durée retenue pour un cours sans heure de fin — la même hypothèse qu'ailleurs. */
const DEFAULT_LECTURE_MINUTES = 60;

export function timetableRows(
  lectures: readonly CalendarEvent[],
  availability: WeeklyAvailability,
  weekday: WeekdayId,
): TimetableRow[] {
  const busy = lectures
    .filter((event) => event.startTime !== null)
    .map((event) => {
      const start = toMinutes(event.startTime!);
      const end = event.endTime ? toMinutes(event.endTime) : start + DEFAULT_LECTURE_MINUTES;
      return { start, end: Math.max(end, start), event };
    })
    .sort((a, b) => a.start - b.start);

  const rows: TimetableRow[] = busy.map(({ start, end, event }) => ({
    kind: 'lecture' as const,
    start: fromMinutes(start),
    end: fromMinutes(end),
    label: event.title,
    detail: [event.room, event.teacher].filter(Boolean).join(' · ') || null,
  }));

  const day = availability[weekday];
  const gaps: { start: number; end: number }[] = [];
  const merged: { start: number; end: number }[] = [];
  for (const id of SLOT_ORDER) {
    const slot = day[id];
    if (!slot.enabled) continue;
    let cursor = toMinutes(slot.start);
    const slotEnd = toMinutes(slot.end);
    for (const range of busy) {
      if (range.end <= cursor || range.start >= slotEnd) continue;
      if (range.start > cursor) gaps.push({ start: cursor, end: range.start });
      cursor = Math.max(cursor, range.end);
    }
    if (slotEnd > cursor) gaps.push({ start: cursor, end: slotEnd });
  }

  // Deux plages qui se touchent (après-midi finissant quand le soir commence)
  // ne forment qu'un seul créneau libre : la frontière entre deux plages
  // déclarées n'est pas une interruption réelle du temps disponible.
  gaps.sort((a, b) => a.start - b.start);
  for (const gap of gaps) {
    const last = merged[merged.length - 1];
    if (last && gap.start <= last.end) last.end = Math.max(last.end, gap.end);
    else merged.push({ ...gap });
  }
  for (const gap of merged) {
    if (gap.end - gap.start >= MIN_FREE_MINUTES) rows.push(free(gap.start, gap.end));
  }

  return rows.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/**
 * Un créneau libre annonce sa DURÉE : « 10:00 libre » ne dit pas si j'ai vingt
 * minutes ou quatre heures devant moi, alors que c'est toute la question.
 */
const free = (start: number, end: number): TimetableRow => {
  const span = end - start;
  const hours = Math.floor(span / 60);
  const rest = span % 60;
  return {
    kind: 'free',
    start: fromMinutes(start),
    end: fromMinutes(end),
    label: `libre · ${hours > 0 ? `${hours} h${rest > 0 ? ` ${rest}` : ''}` : `${rest} min`}`,
    detail: null,
  };
};
