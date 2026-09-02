import type { CalendarEvent, DayKey, StoredAvailability, StoredDayAvailability, WeekdayId } from '@/types';
import { parseDayKey } from '@/lib/date';
import { addMinutes } from './index';

/**
 * DISPONIBILITÉS — quand je peux réellement travailler, JOUR PAR JOUR.
 *
 * Le planificateur ne suppose JAMAIS qu'une journée entière est libre, ni que
 * tous les jours se ressemblent : un lundi de cours et un samedi n'ont rien à
 * voir. Chaque jour de la semaine porte donc ses trois plages (matin,
 * après-midi, soir), activables et réglables indépendamment.
 *
 * Deux garanties :
 *  - une plage non cochée n'accueille rien ;
 *  - un jour dont aucune plage n'est cochée est intégralement écarté du
 *    planificateur automatique. Il reste évidemment possible d'y créer une
 *    séance à la main : c'est une préférence de planification, pas un verrou.
 *
 * Les valeurs par défaut sont des repères, pas une prescription : aucun
 * horaire d'exemple n'est imposé, seulement une base neutre identique pour
 * les sept jours, que l'écran « Mes disponibilités » sert à remplacer.
 */

// ────────────────────────────── Plages d'une journée ──────────────────────────────

export type SlotId = 'morning' | 'afternoon' | 'evening';

export interface AvailabilitySlot {
  id: SlotId;
  label: string;
  enabled: boolean;
  /** « HH:MM » locales. */
  start: string;
  end: string;
}

/** Les trois plages d'UNE journée. */
export type DayAvailability = Record<SlotId, AvailabilitySlot>;

export const SLOT_ORDER: readonly SlotId[] = ['morning', 'afternoon', 'evening'];

export const DEFAULT_DAY_AVAILABILITY: DayAvailability = {
  morning: { id: 'morning', label: 'Matin', enabled: false, start: '09:00', end: '12:00' },
  afternoon: { id: 'afternoon', label: 'Après-midi', enabled: true, start: '14:00', end: '18:00' },
  evening: { id: 'evening', label: 'Soir', enabled: true, start: '20:00', end: '22:00' },
};

// ────────────────────────────── Les sept jours ──────────────────────────────

/**
 * Les noms de jours sont déclarés avec le modèle, dans `types/` : ils
 * apparaissent aussi bien dans les disponibilités enregistrées que dans la
 * récurrence d'un cours, et une seule définition évite qu'ils divergent.
 */
export type { WeekdayId } from '@/types';

/** La semaine commence le lundi, comme la grille du calendrier. */
export const WEEKDAY_ORDER: readonly WeekdayId[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const WEEKDAY_LABELS: Record<WeekdayId, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
};

export const WEEKDAY_SHORT: Record<WeekdayId, string> = {
  monday: 'Lun',
  tuesday: 'Mar',
  wednesday: 'Mer',
  thursday: 'Jeu',
  friday: 'Ven',
  saturday: 'Sam',
  sunday: 'Dim',
};

/** Disponibilités de la semaine entière. */
export type WeeklyAvailability = Record<WeekdayId, DayAvailability>;

const cloneDay = (day: DayAvailability): DayAvailability => ({
  morning: { ...day.morning },
  afternoon: { ...day.afternoon },
  evening: { ...day.evening },
});

export const DEFAULT_AVAILABILITY: WeeklyAvailability = Object.fromEntries(
  WEEKDAY_ORDER.map((id) => [id, cloneDay(DEFAULT_DAY_AVAILABILITY)]),
) as WeeklyAvailability;

/** `Date.getDay()` renvoie 0 pour dimanche — cette table remet l'ordre. */
const BY_JS_DAY: readonly WeekdayId[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function weekdayOf(day: DayKey): WeekdayId {
  return BY_JS_DAY[parseDayKey(day).getDay()]!;
}

/** Les plages qui s'appliquent réellement à une date donnée. */
export function availabilityFor(availability: WeeklyAvailability, day: DayKey): DayAvailability {
  return availability[weekdayOf(day)];
}

// ────────────────────────────── Lecture du profil ──────────────────────────────

/**
 * La forme persistée est déclarée avec le reste du modèle, dans `types/` :
 * c'est elle qui décrit une ligne de la table `profile`, pas ce module.
 */
export type { StoredAvailability, StoredDayAvailability } from '@/types';

const mergeDay = (base: DayAvailability, stored: StoredDayAvailability | undefined): DayAvailability => ({
  morning: { ...base.morning, ...stored?.morning },
  afternoon: { ...base.afternoon, ...stored?.afternoon },
  evening: { ...base.evening, ...stored?.evening },
});

/**
 * Fusionne des disponibilités partielles avec les valeurs par défaut, en
 * migrant l'ancien format vers le nouveau sans rien perdre : des plages
 * déclarées une fois pour toutes deviennent les plages des sept jours.
 */
export function normalizeAvailability(stored: StoredAvailability | undefined): WeeklyAvailability {
  const legacy: StoredDayAvailability | undefined =
    stored && SLOT_ORDER.some((id) => stored[id] !== undefined)
      ? { morning: stored.morning, afternoon: stored.afternoon, evening: stored.evening }
      : undefined;

  // L'ancien réglage devient la base de chaque jour ; le réglage par jour,
  // quand il existe, se pose par-dessus.
  const base = legacy ? mergeDay(DEFAULT_DAY_AVAILABILITY, legacy) : DEFAULT_DAY_AVAILABILITY;

  return Object.fromEntries(
    WEEKDAY_ORDER.map((id) => [id, mergeDay(base, stored?.[id])]),
  ) as WeeklyAvailability;
}

/**
 * Forme à écrire en base. On enregistre les sept jours en clair : une ligne
 * lisible telle quelle vaut mieux qu'un format compressé qu'il faudrait
 * réinterpréter, et l'ancien format n'est plus produit.
 */
export function serializeAvailability(availability: WeeklyAvailability): StoredAvailability {
  return Object.fromEntries(
    WEEKDAY_ORDER.map((id) => [
      id,
      Object.fromEntries(
        SLOT_ORDER.map((slot) => {
          const { enabled, start, end } = availability[id][slot];
          return [slot, { enabled, start, end }];
        }),
      ),
    ]),
  ) as StoredAvailability;
}

// ────────────────────────────── Heures et fenêtres ──────────────────────────────

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

/** Minutes réellement disponibles dans une journée, selon ses plages actives. */
export function availableMinutes(day: DayAvailability): number {
  return SLOT_ORDER.reduce((total, id) => {
    const slot = day[id];
    if (!slot.enabled) return total;
    return total + Math.max(0, toMinutes(slot.end) - toMinutes(slot.start));
  }, 0);
}

/** Minutes disponibles sur la semaine entière — le plafond hebdomadaire réel. */
export function weeklyAvailableMinutes(availability: WeeklyAvailability): number {
  return WEEKDAY_ORDER.reduce((total, id) => total + availableMinutes(availability[id]), 0);
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
 * Première fenêtre libre d'au moins `minutes`, dans les plages activées de
 * CETTE journée et en évitant les créneaux déjà occupés. Renvoie `null` quand
 * la journée ne peut rien accueillir — le planificateur passe alors au jour
 * suivant plutôt que de superposer deux séances.
 */
export function firstFreeWindow(
  day: DayAvailability,
  busy: readonly TimeRange[],
  minutes: number,
): TimeRange | null {
  for (const id of SLOT_ORDER) {
    const slot = day[id];
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
