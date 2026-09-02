import type { CalendarEvent, DayKey } from '@/types';
import { addMinutes } from './index';

/**
 * DISPONIBILITÉS — quand je peux réellement travailler.
 *
 * Le planificateur ne suppose JAMAIS qu'une journée entière est libre. Il
 * place les séances dans des plages déclarées (matin, après-midi, soir), et
 * seulement dans celles qui sont activées. Sans plage active, il ne propose
 * rien plutôt que de remplir la journée d'office.
 *
 * Les valeurs par défaut sont des repères raisonnables, pas une prescription :
 * elles se modifient depuis le calendrier et sont enregistrées dans le profil.
 */

export type SlotId = 'morning' | 'afternoon' | 'evening';

export interface AvailabilitySlot {
  id: SlotId;
  label: string;
  enabled: boolean;
  /** « HH:MM » locales. */
  start: string;
  end: string;
}

export type Availability = Record<SlotId, AvailabilitySlot>;

export const SLOT_ORDER: readonly SlotId[] = ['morning', 'afternoon', 'evening'];

export const DEFAULT_AVAILABILITY: Availability = {
  morning: { id: 'morning', label: 'Matin', enabled: false, start: '09:00', end: '12:00' },
  afternoon: { id: 'afternoon', label: 'Après-midi', enabled: true, start: '14:00', end: '18:00' },
  evening: { id: 'evening', label: 'Soir', enabled: true, start: '20:00', end: '22:00' },
};

/**
 * Forme telle qu'elle est ENREGISTRÉE dans le profil : chaque champ est
 * facultatif, y compris à l'intérieur d'une plage. Un profil écrit avant
 * l'ajout d'un champ doit rester lisible.
 */
export type StoredAvailability = Partial<Record<SlotId, Partial<Omit<AvailabilitySlot, 'id' | 'label'>>>>;

/** Fusionne des disponibilités partielles avec les valeurs par défaut. */
export function normalizeAvailability(stored: StoredAvailability | undefined): Availability {
  return {
    morning: { ...DEFAULT_AVAILABILITY.morning, ...stored?.morning },
    afternoon: { ...DEFAULT_AVAILABILITY.afternoon, ...stored?.afternoon },
    evening: { ...DEFAULT_AVAILABILITY.evening, ...stored?.evening },
  };
}

export interface TimeRange {
  start: string;
  end: string;
}

export const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export const fromMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Minutes réellement disponibles dans une journée, selon les plages actives. */
export function availableMinutes(availability: Availability): number {
  return SLOT_ORDER.reduce((total, id) => {
    const slot = availability[id];
    if (!slot.enabled) return total;
    return total + Math.max(0, toMinutes(slot.end) - toMinutes(slot.start));
  }, 0);
}

/**
 * Créneaux déjà occupés d'une journée, à partir des événements RÉELS qui
 * portent une heure. Un événement sans heure n'occupe aucun créneau précis :
 * il pèse sur la charge de la journée (voir `load.ts`) sans bloquer une plage.
 */
export function busyRanges(events: readonly CalendarEvent[], day: DayKey): TimeRange[] {
  return events
    .filter((event) => event.day === day && event.startTime !== null)
    .map((event) => ({
      start: event.startTime!,
      // Sans heure de fin, on réserve une heure : c'est la durée par défaut
      // proposée par le formulaire, donc l'hypothèse la moins surprenante.
      end: event.endTime ?? addMinutes(event.startTime!, 60),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Première fenêtre libre d'au moins `minutes`, dans les plages activées et en
 * évitant les créneaux déjà occupés. Renvoie `null` quand la journée ne peut
 * rien accueillir — le planificateur passe alors au jour suivant plutôt que
 * de superposer deux séances.
 */
export function firstFreeWindow(
  availability: Availability,
  busy: readonly TimeRange[],
  minutes: number,
): TimeRange | null {
  for (const id of SLOT_ORDER) {
    const slot = availability[id];
    if (!slot.enabled) continue;

    let cursor = toMinutes(slot.start);
    const slotEnd = toMinutes(slot.end);
    const overlapping = busy
      .map((range) => ({ start: toMinutes(range.start), end: toMinutes(range.end) }))
      .filter((range) => range.end > cursor && range.start < slotEnd)
      .sort((a, b) => a.start - b.start);

    for (const range of overlapping) {
      if (range.start - cursor >= minutes) {
        return { start: fromMinutes(cursor), end: fromMinutes(cursor + minutes) };
      }
      cursor = Math.max(cursor, range.end);
    }
    if (slotEnd - cursor >= minutes) {
      return { start: fromMinutes(cursor), end: fromMinutes(cursor + minutes) };
    }
  }
  return null;
}
