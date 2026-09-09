import { describe, expect, it } from 'vitest';
import { studyBudgetUntil } from '@/core/calendar/examBudget';
import {
  DEFAULT_AVAILABILITY,
  WEEKDAY_ORDER,
  type WeeklyAvailability,
} from '@/core/calendar/availability';
import type { CalendarEvent, DayKey } from '@/types';

/**
 * TEMPS RÉELLEMENT DISPONIBLE D'ICI L'ÉVALUATION.
 *
 * Ce qui est vérifié ici n'est pas « un chiffre s'affiche » mais que le chiffre
 * DIMINUE quand la réalité de l'emploi du temps le veut : un cours ajouté, une
 * séance déjà planifiée, une plage non déclarée. Et surtout qu'« aucune plage
 * déclarée » ne se confond jamais avec « plus une minute de libre » — deux
 * affirmations opposées.
 */

function availabilityWith(hours: { start: string; end: string } | null): WeeklyAvailability {
  return Object.fromEntries(
    WEEKDAY_ORDER.map((id) => [
      id,
      {
        morning: { id: 'morning' as const, label: 'Matin', enabled: false, start: '09:00', end: '12:00' },
        afternoon: hours
          ? { id: 'afternoon' as const, label: 'Après-midi', enabled: true, start: hours.start, end: hours.end }
          : { id: 'afternoon' as const, label: 'Après-midi', enabled: false, start: '14:00', end: '18:00' },
        evening: { id: 'evening' as const, label: 'Soir', enabled: false, start: '20:00', end: '22:00' },
      },
    ]),
  ) as WeeklyAvailability;
}

function event(partial: Partial<CalendarEvent> & { day: DayKey; kind: CalendarEvent['kind'] }): CalendarEvent {
  return {
    id: `e-${partial.day}-${partial.kind}-${partial.startTime ?? 'x'}`,
    title: 'Événement',
    startTime: null,
    endTime: null,
    subjectId: null,
    chapterId: null,
    importance: 2,
    notes: null,
    done: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as CalendarEvent;
}

// Lundi 5 janvier 2026, 8 h du matin : rien de la journée n'est encore écoulé.
const MONDAY_MORNING = new Date('2026-01-05T08:00:00');

describe('studyBudgetUntil', () => {
  it('compte les plages déclarées des jours qui restent, jour de l’examen exclu', () => {
    // 4 h/jour déclarées, examen jeudi → lundi, mardi, mercredi = 3 jours.
    const budget = studyBudgetUntil(
      '2026-01-08',
      [],
      availabilityWith({ start: '14:00', end: '18:00' }),
      45,
      MONDAY_MORNING,
    );
    expect(budget.days).toBe(3);
    expect(budget.freeMinutes).toBe(3 * 240);
    expect(budget.hasDeclaredAvailability).toBe(true);
    expect(budget.isOver).toBe(false);
  });

  it('retire les cours qui mordent sur les plages déclarées', () => {
    const availability = availabilityWith({ start: '14:00', end: '18:00' });
    const withoutCourse = studyBudgetUntil('2026-01-08', [], availability, 45, MONDAY_MORNING);
    const withCourse = studyBudgetUntil(
      '2026-01-08',
      [event({ day: '2026-01-06', kind: 'lecture', startTime: '14:00', endTime: '16:00' })],
      availability,
      45,
      MONDAY_MORNING,
    );
    expect(withCourse.freeMinutes).toBe(withoutCourse.freeMinutes - 120);
  });

  it('déduit les séances de révision déjà planifiées du temps qui reste', () => {
    const budget = studyBudgetUntil(
      '2026-01-08',
      [event({ day: '2026-01-06', kind: 'review', startTime: '16:00', endTime: '17:00' })],
      availabilityWith({ start: '14:00', end: '18:00' }),
      45,
      MONDAY_MORNING,
    );
    expect(budget.plannedMinutes).toBe(60);
    expect(budget.remainingMinutes).toBe(budget.freeMinutes - 60);
  });

  it('traduit le reste en séances entières de la durée habituelle', () => {
    const budget = studyBudgetUntil(
      '2026-01-06',
      [],
      availabilityWith({ start: '14:00', end: '16:00' }),
      45,
      MONDAY_MORNING,
    );
    // 120 min libres, séances de 45 min : deux séances entières, pas 2,67.
    expect(budget.remainingMinutes).toBe(120);
    expect(budget.remainingSessions).toBe(2);
  });

  it('distingue « aucune plage déclarée » de « plus une minute de libre »', () => {
    const nothingDeclared = studyBudgetUntil('2026-01-08', [], availabilityWith(null), 45, MONDAY_MORNING);
    expect(nothingDeclared.hasDeclaredAvailability).toBe(false);
    expect(nothingDeclared.freeMinutes).toBe(0);

    // Des plages existent, mais un cours les occupe entièrement : cette fois
    // le zéro est un vrai zéro, et il faut pouvoir le dire autrement.
    const fullyBooked = studyBudgetUntil(
      '2026-01-06',
      [event({ day: '2026-01-05', kind: 'lecture', startTime: '14:00', endTime: '18:00' })],
      availabilityWith({ start: '14:00', end: '18:00' }),
      45,
      MONDAY_MORNING,
    );
    expect(fullyBooked.hasDeclaredAvailability).toBe(true);
    expect(fullyBooked.freeMinutes).toBe(0);
  });

  it('ne compte pas les heures d’aujourd’hui déjà écoulées', () => {
    // 16 h : la plage 14 h–18 h n'offre plus que deux heures aujourd'hui.
    const budget = studyBudgetUntil(
      '2026-01-06',
      [],
      availabilityWith({ start: '14:00', end: '18:00' }),
      45,
      new Date('2026-01-05T16:00:00'),
    );
    expect(budget.freeMinutes).toBe(120);
  });

  it('ne budgète rien pour une évaluation d’aujourd’hui ou déjà passée', () => {
    const today = studyBudgetUntil('2026-01-05', [], DEFAULT_AVAILABILITY, 45, MONDAY_MORNING);
    expect(today.isOver).toBe(true);
    expect(today.days).toBe(0);

    const past = studyBudgetUntil('2026-01-01', [], DEFAULT_AVAILABILITY, 45, MONDAY_MORNING);
    expect(past.isOver).toBe(true);
  });

  it('ne descend jamais sous zéro quand le planifié dépasse le disponible', () => {
    const budget = studyBudgetUntil(
      '2026-01-06',
      [
        event({ day: '2026-01-05', kind: 'review', startTime: '14:00', endTime: '16:00' }),
        event({ day: '2026-01-05', kind: 'review', startTime: '16:00', endTime: '18:00' }),
        event({ day: '2026-01-05', kind: 'review', startTime: '18:00', endTime: '20:00' }),
      ],
      availabilityWith({ start: '14:00', end: '16:00' }),
      45,
      MONDAY_MORNING,
    );
    expect(budget.remainingMinutes).toBe(0);
    expect(budget.remainingSessions).toBe(0);
  });

  it('compte une séance sans horaire pour la durée habituelle, jamais pour zéro', () => {
    const budget = studyBudgetUntil(
      '2026-01-06',
      [event({ day: '2026-01-05', kind: 'review' })],
      availabilityWith({ start: '14:00', end: '18:00' }),
      45,
      MONDAY_MORNING,
    );
    expect(budget.plannedMinutes).toBe(45);
  });
});
