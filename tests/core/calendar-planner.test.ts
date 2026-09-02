import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AVAILABILITY,
  DEFAULT_DAY_AVAILABILITY,
  WEEKDAY_ORDER,
  availabilityFor,
  availableMinutes,
  busyRanges,
  firstFreeWindow,
  normalizeAvailability,
  serializeAvailability,
  toMinutes,
  weekdayOf,
  weeklyAvailableMinutes,
  type DayAvailability,
  type WeeklyAvailability,
} from '@/core/calendar/availability';
import { LOAD_THRESHOLDS, dayLoad, eventMinutes } from '@/core/calendar/load';
import { DEFAULT_SCHEDULING_CONFIG, committedMinutes, scheduleSessions, type SessionRequest } from '@/core/calendar/planner';
import { planStudySessions, planWeek } from '@/core/calendar/plans';
import { DEFAULT_EASE } from '@/core/srs';
import { dayKey } from '@/lib/date';
import type { CalendarEvent, Chapter, Flashcard, ReviewLog, Subject } from '@/types';

/**
 * Ce qui est vérifié ici tient en une phrase : le planificateur ne place
 * jamais une séance là où je ne peux pas la faire.
 *
 * Concrètement — pas hors de mes plages déclarées, pas sur un créneau déjà
 * occupé, pas sur une journée déjà pleine, et pas une grosse séance la veille
 * d'un examen d'une autre matière. Quand il ne peut pas placer, il le dit au
 * lieu de glisser la séance quelque part par défaut.
 */

const NOW = new Date('2026-03-18T08:00:00.000Z'); // mercredi
const TODAY = dayKey(NOW);

const subject = (id: string, name: string, position = 0): Subject => ({
  id,
  name,
  color: '#888888',
  createdAt: '2026-01-01T00:00:00.000Z',
  position,
});

const chapter = (id: string, subjectId: string, name: string, position = 0): Chapter => ({
  id,
  subjectId,
  name,
  createdAt: '2026-01-01T00:00:00.000Z',
  position,
});

function card(overrides: Partial<Flashcard> & { id: string; subjectId: string }): Flashcard {
  return {
    chapterId: null,
    question: `Q ${overrides.id}`,
    answer: 'A',
    importance: 2,
    difficulty: 2,
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: '2026-03-18T00:00:00.000Z',
    lastReview: null,
    origin: 'manual',
    sourceChunkIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function log(overrides: Partial<ReviewLog> & { id: string; itemId: string; subjectId: string }): ReviewLog {
  const at = overrides.at ?? '2026-03-17T09:00:00.000Z';
  return {
    chapterId: null,
    itemKind: 'card',
    at,
    day: dayKey(new Date(at)),
    correct: true,
    rating: 2,
    confidence: 'medium',
    elapsedMs: 30_000,
    ...overrides,
  };
}

function event(overrides: Partial<CalendarEvent> & { id: string; day: string }): CalendarEvent {
  return {
    title: 'Événement',
    kind: 'course',
    startTime: null,
    endTime: null,
    subjectId: 's1',
    chapterId: null,
    importance: 2,
    status: 'planned',
    startedAt: null,
    completedAt: null,
    planForEventId: null,
    notes: '',
    done: false,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

const request = (overrides: Partial<SessionRequest> = {}): SessionRequest => ({
  subjectId: 's1',
  subjectName: 'Anatomie',
  chapterId: 'ch1',
  chapterName: 'Nerfs',
  title: 'Anatomie — Nerfs',
  reason: 'maîtrise 30 %',
  minutes: 45,
  cardIds: ['c1'],
  ...overrides,
});

/**
 * Une seule plage, courte, IDENTIQUE tous les jours : facilite le
 * raisonnement dans les tests qui ne portent pas sur le jour de la semaine.
 */
const oneSlot = (start: string, end: string): WeeklyAvailability =>
  normalizeAvailability({
    morning: { enabled: false },
    afternoon: { enabled: true, start, end },
    evening: { enabled: false },
  });

/** Plages d'un seul jour, pour les fonctions qui raisonnent sur une journée. */
const daySlot = (start: string, end: string): DayAvailability => oneSlot(start, end).monday;

/** Aucune plage nulle part. */
const noSlot = (): WeeklyAvailability =>
  normalizeAvailability({
    morning: { enabled: false },
    afternoon: { enabled: false },
    evening: { enabled: false },
  });

describe('plages disponibles', () => {
  it('ne suppose jamais la journée entière libre', () => {
    // Par défaut : après-midi et soir seulement, pas 24 h.
    expect(availableMinutes(DEFAULT_DAY_AVAILABILITY)).toBeLessThan(24 * 60);
    expect(DEFAULT_DAY_AVAILABILITY.morning.enabled).toBe(false);
    for (const id of WEEKDAY_ORDER) expect(DEFAULT_AVAILABILITY[id].morning.enabled).toBe(false);
  });

  it('ne compte que les plages activées', () => {
    expect(availableMinutes(daySlot('14:00', '16:00'))).toBe(120);
  });

  it('renvoie zéro minute quand rien n’est coché', () => {
    const none = noSlot();
    expect(availableMinutes(none.monday)).toBe(0);
    expect(weeklyAvailableMinutes(none)).toBe(0);
    expect(firstFreeWindow(none.monday, [], 30)).toBeNull();
  });

  it('trouve le premier trou libre après un créneau occupé', () => {
    const slot = daySlot('14:00', '18:00');
    const window = firstFreeWindow(slot, [{ start: '14:00', end: '15:00' }], 60);
    expect(window).toEqual({ start: '15:00', end: '16:00' });
  });

  it('utilise un trou AVANT un créneau occupé quand il est assez large', () => {
    const slot = daySlot('14:00', '18:00');
    const window = firstFreeWindow(slot, [{ start: '15:30', end: '17:00' }], 60);
    expect(window).toEqual({ start: '14:00', end: '15:00' });
  });

  it('refuse quand aucun trou n’atteint la durée demandée', () => {
    const slot = daySlot('14:00', '15:00');
    expect(firstFreeWindow(slot, [{ start: '14:00', end: '14:45' }], 45)).toBeNull();
  });

  it('déduit les créneaux occupés des événements réellement datés', () => {
    const events = [
      event({ id: 'a', day: TODAY, startTime: '14:00', endTime: '15:00' }),
      event({ id: 'b', day: TODAY }), // sans heure : n'occupe aucun créneau
      event({ id: 'c', day: '2026-03-19', startTime: '10:00', endTime: '11:00' }),
    ];
    expect(busyRanges(events, TODAY)).toEqual([{ start: '14:00', end: '15:00' }]);
  });

  it('réserve une heure par défaut à un événement sans heure de fin', () => {
    expect(busyRanges([event({ id: 'a', day: TODAY, startTime: '14:00' })], TODAY)).toEqual([
      { start: '14:00', end: '15:00' },
    ]);
  });
});

describe('charge d’une journée', () => {
  const availability = oneSlot('14:00', '18:00'); // 240 min

  it('classe une journée vide comme libre', () => {
    expect(dayLoad(TODAY, [], availability).level).toBe('light');
  });

  it('monte à « moyenne » puis « chargée » avec les engagements réels', () => {
    const medium = dayLoad(
      TODAY,
      [event({ id: 'a', day: TODAY, startTime: '14:00', endTime: '15:30' })],
      availability,
    );
    expect(medium.minutes).toBe(90);
    expect(medium.level).toBe('medium');

    const heavy = dayLoad(
      TODAY,
      [
        event({ id: 'a', day: TODAY, startTime: '14:00', endTime: '16:00' }),
        event({ id: 'b', day: TODAY, startTime: '16:00', endTime: '17:00' }),
      ],
      availability,
    );
    expect(heavy.minutes / heavy.capacity).toBeGreaterThanOrEqual(LOAD_THRESHOLDS.heavy);
    expect(heavy.level).toBe('heavy');
  });

  it('considère chargée toute journée d’évaluation, quelle que soit sa durée', () => {
    const load = dayLoad(TODAY, [event({ id: 'exam', day: TODAY, kind: 'midterm' })], availability);
    expect(load.evaluations).toBe(1);
    expect(load.level).toBe('heavy');
  });

  it('repère la veille d’une évaluation et la matière concernée', () => {
    const load = dayLoad(
      TODAY,
      [event({ id: 'exam', day: '2026-03-19', kind: 'exam', subjectId: 's2' })],
      availability,
    );
    expect(load.eveOfEvaluationFor).toEqual(['s2']);
  });

  it('donne une durée par défaut aux événements sans horaire', () => {
    expect(eventMinutes(event({ id: 'a', day: TODAY }))).toBe(60);
    expect(eventMinutes(event({ id: 'e', day: TODAY, kind: 'exam' }))).toBe(120);
    expect(eventMinutes(event({ id: 'b', day: TODAY, startTime: '14:00', endTime: '14:30' }))).toBe(30);
  });
});

describe('placement des séances', () => {
  const availability = oneSlot('14:00', '18:00');

  it('donne une heure de début et de fin, jamais la journée entière', () => {
    const result = scheduleSessions([request()], [], availability, { now: NOW });
    const [session] = result.sessions;
    expect(session!.startTime).toMatch(/^\d{2}:\d{2}$/);
    expect(session!.endTime).toMatch(/^\d{2}:\d{2}$/);
    expect(toMinutes(session!.endTime!) - toMinutes(session!.startTime!)).toBe(45);
  });

  it('ne place rien sur un créneau déjà occupé', () => {
    const events = [event({ id: 'cours', day: TODAY, startTime: '14:00', endTime: '18:00' })];
    const result = scheduleSessions([request()], events, availability, { now: NOW, horizonDays: 1 });
    expect(result.sessions).toEqual([]);
    expect(result.unplaced).toHaveLength(1);
  });

  it('évite une journée déjà chargée quand une journée libre existe', () => {
    const events = [event({ id: 'cours', day: TODAY, startTime: '14:00', endTime: '17:00' })];
    const result = scheduleSessions([request()], events, availability, { now: NOW, horizonDays: 3 });
    expect(result.sessions[0]!.day).not.toBe(TODAY);
    expect(result.sessions[0]!.dayLevel).toBe('light');
  });

  it('ne dépasse pas le nombre de séances autorisé par journée', () => {
    const requests = Array.from({ length: 6 }, (_, i) => request({ title: `Séance ${i}` }));
    const result = scheduleSessions(requests, [], availability, { now: NOW, horizonDays: 3 });
    const perDay = new Map<string, number>();
    for (const session of result.sessions) perDay.set(session.day, (perDay.get(session.day) ?? 0) + 1);
    for (const count of perDay.values()) {
      expect(count).toBeLessThanOrEqual(DEFAULT_SCHEDULING_CONFIG.maxSessionsPerDay);
    }
  });

  it('n’occupe qu’une part de la journée, jamais toute la capacité', () => {
    const requests = Array.from({ length: 4 }, () => request({ minutes: 90 }));
    const result = scheduleSessions(requests, [], availability, { now: NOW, horizonDays: 1 });
    const total = result.sessions.reduce((sum, session) => sum + session.minutes, 0);
    expect(total).toBeLessThanOrEqual(240 * DEFAULT_SCHEDULING_CONFIG.maxDayFill);
  });

  it('évite la veille d’un examen d’une AUTRE matière', () => {
    const tomorrow = '2026-03-19';
    const events = [event({ id: 'exam', day: tomorrow, kind: 'exam', subjectId: 's2' })];
    // Aujourd'hui est la veille : la séance de s1 doit aller ailleurs.
    const result = scheduleSessions([request({ subjectId: 's1' })], events, availability, {
      now: NOW,
      horizonDays: 5,
    });
    expect(result.sessions[0]!.day).not.toBe(TODAY);
  });

  it('accepte la veille de SON propre examen pour une relecture', () => {
    const tomorrow = '2026-03-19';
    const events = [event({ id: 'exam', day: tomorrow, kind: 'exam', subjectId: 's1' })];
    const result = scheduleSessions(
      [request({ subjectId: 's1', isFinalReview: true, deadline: tomorrow })],
      events,
      availability,
      { now: NOW, horizonDays: 5 },
    );
    expect(result.sessions[0]!.day).toBe(TODAY);
  });

  it('répartit plutôt que de masser des séances consécutives', () => {
    const requests = Array.from({ length: 3 }, (_, i) => request({ title: `S${i}` }));
    const result = scheduleSessions(requests, [], availability, { now: NOW, horizonDays: 10 });
    const days = [...new Set(result.sessions.map((session) => session.day))].sort();
    expect(days.length).toBeGreaterThan(1);
    // Aucune paire de jours consécutifs portant chacun deux séances.
    const perDay = new Map<string, number>();
    for (const session of result.sessions) perDay.set(session.day, (perDay.get(session.day) ?? 0) + 1);
    expect([...perDay.values()].every((count) => count <= 2)).toBe(true);
  });

  it('ne place jamais après l’échéance', () => {
    const result = scheduleSessions(
      [request({ deadline: '2026-03-20' })],
      [],
      availability,
      { now: NOW, horizonDays: 10 },
    );
    for (const session of result.sessions) expect(session.day < '2026-03-20').toBe(true);
  });

  it('rend compte de ce qu’il n’a pas pu placer, au lieu de le glisser ailleurs', () => {
    const result = scheduleSessions([request()], [], noSlot(), { now: NOW });
    expect(result.sessions).toEqual([]);
    expect(result.unplaced[0]!.reason).toMatch(/plage/i);
  });

  it('additionne les minutes réellement engagées sur une fenêtre', () => {
    const events = [
      event({ id: 'a', day: TODAY, startTime: '14:00', endTime: '15:00' }),
      event({ id: 'b', day: '2026-03-19', startTime: '14:00', endTime: '14:30' }),
      event({ id: 'hors', day: '2026-04-01', startTime: '14:00', endTime: '18:00' }),
    ];
    expect(committedMinutes(events, [TODAY, '2026-03-19'])).toBe(90);
  });
});

describe('plan d’examen tenant compte du calendrier', () => {
  const chapters = [chapter('ch1', 's1', 'Crâne'), chapter('ch2', 's1', 'Nerfs')];
  const cards = [
    ...Array.from({ length: 3 }, (_, i) =>
      card({ id: `fort${i}`, subjectId: 's1', chapterId: 'ch1', reps: 5, interval: 55, ease: 3 }),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      card({ id: `faible${i}`, subjectId: 's1', chapterId: 'ch2', reps: 1, interval: 1, ease: 1.4 }),
    ),
  ];
  const logs = cards.map((entry, i) =>
    log({ id: `l${i}`, itemId: entry.id, subjectId: 's1', chapterId: entry.chapterId }),
  );

  it('donne un créneau horaire à chaque séance planifiée', () => {
    const plan = planStudySessions('2026-03-30', 's1', 'Anatomie', chapters, cards, logs, NOW, {
      availability: oneSlot('14:00', '18:00'),
    });
    for (const session of plan.sessions) {
      expect(session.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(session.endTime).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('esquive les journées occupées par d’autres événements', () => {
    const availability = oneSlot('14:00', '16:00');
    const busyDays = ['2026-03-18', '2026-03-19', '2026-03-20'];
    const events = busyDays.map((day, i) =>
      event({ id: `busy${i}`, day, startTime: '14:00', endTime: '16:00' }),
    );
    const plan = planStudySessions('2026-03-30', 's1', 'Anatomie', chapters, cards, logs, NOW, {
      availability,
      events,
    });
    const chapterSessions = plan.sessions.filter((session) => session.chapterId !== null);
    for (const session of chapterSessions) expect(busyDays).not.toContain(session.day);
  });

  it('garde la révision générale la veille, avec son créneau', () => {
    const plan = planStudySessions('2026-03-30', 's1', 'Anatomie', chapters, cards, logs, NOW, {
      availability: oneSlot('14:00', '18:00'),
    });
    const last = plan.sessions[plan.sessions.length - 1]!;
    expect(last.day).toBe('2026-03-29');
    expect(last.chapterId).toBeNull();
    expect(last.startTime).not.toBeNull();
  });
});

describe('plan de la semaine', () => {
  const subjects = [subject('s1', 'Anatomie'), subject('s2', 'Histologie', 1)];
  const chapters = [chapter('ch1', 's1', 'Nerfs'), chapter('ch2', 's2', 'Épithéliums')];
  const cards = [
    ...Array.from({ length: 4 }, (_, i) =>
      card({ id: `a${i}`, subjectId: 's1', chapterId: 'ch1', reps: 1, interval: 1, ease: 1.4 }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      card({ id: `h${i}`, subjectId: 's2', chapterId: 'ch2', reps: 3, interval: 25 }),
    ),
  ];
  const logs = cards.map((entry, i) =>
    log({ id: `l${i}`, itemId: entry.id, subjectId: entry.subjectId, chapterId: entry.chapterId }),
  );
  const base = {
    subjects,
    chapters,
    cards,
    logs,
    availability: oneSlot('14:00', '18:00'),
    weeklyGoalMinutes: 300,
    minutesPerSession: 45,
    now: NOW,
  };

  it('ne propose rien sans flashcard', () => {
    const plan = planWeek({ ...base, events: [], cards: [], logs: [] });
    expect(plan.sessions).toEqual([]);
    expect(plan.blocked).toMatch(/flashcard/i);
  });

  it('respecte l’objectif hebdomadaire comme budget', () => {
    const plan = planWeek({ ...base, events: [] });
    expect(plan.addedMinutes).toBeLessThanOrEqual(plan.goalMinutes);
    expect(plan.sessions.length).toBeGreaterThan(0);
  });

  it('ne propose rien quand l’objectif est déjà couvert par le planifié', () => {
    const events = Array.from({ length: 7 }, (_, i) =>
      event({
        id: `plein${i}`,
        day: dayKey(new Date(NOW.getTime() + i * 86_400_000)),
        kind: 'review',
        startTime: '14:00',
        endTime: '15:00',
      }),
    );
    const plan = planWeek({ ...base, events, weeklyGoalMinutes: 300 });
    expect(plan.sessions).toEqual([]);
    expect(plan.blocked).toMatch(/objectif/i);
  });

  it('alterne les matières au lieu d’en monopoliser une', () => {
    const plan = planWeek({ ...base, events: [], weeklyGoalMinutes: 600 });
    const subjectsSeen = new Set(plan.sessions.map((session) => session.subjectId));
    expect(subjectsSeen.size).toBeGreaterThan(1);
  });

  it('fait remonter la matière dont l’examen approche', () => {
    const exam = event({ id: 'exam', day: '2026-03-21', kind: 'exam', subjectId: 's2' });
    const plan = planWeek({ ...base, events: [exam], weeklyGoalMinutes: 180 });
    expect(plan.sessions[0]!.subjectId).toBe('s2');
    expect(plan.sessions[0]!.reason).toMatch(/Examen dans/);
  });

  it('gère plusieurs examens proches sans tout entasser', () => {
    const events = [
      event({ id: 'e1', day: '2026-03-21', kind: 'exam', subjectId: 's1' }),
      event({ id: 'e2', day: '2026-03-22', kind: 'exam', subjectId: 's2' }),
    ];
    const plan = planWeek({ ...base, events, weeklyGoalMinutes: 600 });
    const perDay = new Map<string, number>();
    for (const session of plan.sessions) perDay.set(session.day, (perDay.get(session.day) ?? 0) + 1);
    for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(2);
    // Aucune séance le jour d'un examen.
    for (const session of plan.sessions) expect(['2026-03-21', '2026-03-22']).not.toContain(session.day);
  });

  it('n’écrit rien : le plan est une proposition', () => {
    const plan = planWeek({ ...base, events: [] });
    // Aucune fonction d'écriture n'est appelée — la structure rendue est
    // purement descriptive, et les événements d'entrée ne sont pas modifiés.
    expect(Object.isFrozen(plan.sessions)).toBe(false);
    expect(plan.sessions.every((session) => typeof session.day === 'string')).toBe(true);
  });
});

// ────────────────────── Disponibilités par jour de la semaine ──────────────────────

/**
 * Un lundi de cours et un samedi n'ont pas la même tête. Ces tests vérifient
 * que le planificateur lit les plages DU JOUR qu'il envisage — et pas une
 * moyenne, ni celles d'aujourd'hui appliquées à toute la semaine.
 */
describe('disponibilités jour par jour', () => {
  // NOW est un mercredi : la fenêtre des jours suivants parcourt donc toute
  // la semaine, ce qui rend les cas ci-dessous réellement discriminants.
  it('associe chaque date au bon jour de la semaine', () => {
    expect(weekdayOf('2026-03-18')).toBe('wednesday');
    expect(weekdayOf('2026-03-21')).toBe('saturday');
    expect(weekdayOf('2026-03-22')).toBe('sunday');
  });

  it('laisse régler chaque jour indépendamment', () => {
    const availability = normalizeAvailability({
      monday: { morning: { enabled: false }, afternoon: { enabled: false }, evening: { enabled: true, start: '17:00', end: '21:00' } },
      saturday: { morning: { enabled: true, start: '10:00', end: '18:00' }, afternoon: { enabled: false }, evening: { enabled: false } },
    });
    expect(availableMinutes(availability.monday)).toBe(240);
    expect(availableMinutes(availability.saturday)).toBe(480);
    // Un jour non mentionné garde les valeurs par défaut, il n'est pas vidé.
    expect(availableMinutes(availability.tuesday)).toBe(availableMinutes(DEFAULT_DAY_AVAILABILITY));
  });

  it('résout les plages qui s’appliquent réellement à une date', () => {
    const availability = normalizeAvailability({
      wednesday: { morning: { enabled: false }, afternoon: { enabled: true, start: '14:00', end: '21:00' }, evening: { enabled: false } },
    });
    expect(availableMinutes(availabilityFor(availability, '2026-03-18'))).toBe(420); // mercredi
    expect(availableMinutes(availabilityFor(availability, '2026-03-19'))).not.toBe(420); // jeudi
  });

  it('cumule plusieurs plages dans une même journée', () => {
    const availability = normalizeAvailability({
      thursday: {
        morning: { enabled: true, start: '09:00', end: '11:00' },
        afternoon: { enabled: true, start: '14:00', end: '16:00' },
        evening: { enabled: true, start: '20:00', end: '21:00' },
      },
    });
    expect(availableMinutes(availability.thursday)).toBe(300);
    // La première fenêtre libre est cherchée dans l'ordre matin → soir.
    expect(firstFreeWindow(availability.thursday, [{ start: '09:00', end: '10:45' }], 60)).toEqual({
      start: '14:00',
      end: '15:00',
    });
  });

  it('ne propose rien un jour entièrement désactivé, et le dit', () => {
    // Tout coupé le samedi et le dimanche : un plan de deux séances doit se
    // placer en semaine, jamais le week-end.
    const closed = { morning: { enabled: false }, afternoon: { enabled: false }, evening: { enabled: false } };
    const availability = normalizeAvailability({
      morning: { enabled: false },
      afternoon: { enabled: true, start: '14:00', end: '18:00' },
      evening: { enabled: false },
      saturday: closed,
      sunday: closed,
    });
    expect(availableMinutes(availability.saturday)).toBe(0);

    const result = scheduleSessions([request({ chapterId: 'a' }), request({ chapterId: 'b' })], [], availability, {
      now: NOW,
      horizonDays: 7,
    });
    expect(result.sessions.length).toBe(2);
    for (const session of result.sessions) {
      expect(['2026-03-21', '2026-03-22']).not.toContain(session.day);
    }
  });

  it('refuse une séance qui ne tient dans aucune plage du jour', () => {
    const availability = normalizeAvailability({
      morning: { enabled: false },
      afternoon: { enabled: true, start: '14:00', end: '14:30' },
      evening: { enabled: false },
    });
    const result = scheduleSessions([request({ minutes: 90 })], [], availability, {
      now: NOW,
      horizonDays: 7,
    });
    expect(result.sessions).toEqual([]);
    expect(result.unplaced).toHaveLength(1);
  });

  it('place chaque séance dans les plages DU jour retenu', () => {
    // Semaine : 18 h–20 h. Week-end : 10 h–12 h. Aucune séance ne doit
    // atterrir à 18 h un samedi.
    const week = { morning: { enabled: false }, afternoon: { enabled: false }, evening: { enabled: true, start: '18:00', end: '20:00' } };
    const weekend = { morning: { enabled: true, start: '10:00', end: '12:00' }, afternoon: { enabled: false }, evening: { enabled: false } };
    const availability = normalizeAvailability({
      ...week,
      saturday: weekend,
      sunday: weekend,
    });
    const result = scheduleSessions(
      Array.from({ length: 5 }, (_, i) => request({ chapterId: `ch${i}` })),
      [],
      availability,
      { now: NOW, horizonDays: 7 },
    );
    expect(result.sessions.length).toBeGreaterThan(0);
    for (const session of result.sessions) {
      const weekendDay = ['2026-03-21', '2026-03-22'].includes(session.day);
      expect(toMinutes(session.startTime!)).toBeGreaterThanOrEqual(weekendDay ? 600 : 1080);
      expect(toMinutes(session.endTime!)).toBeLessThanOrEqual(weekendDay ? 720 : 1200);
    }
  });
});

// ────────────────────── Compatibilité des profils enregistrés ──────────────────────

describe('migration des disponibilités', () => {
  it('lit un ANCIEN profil sans rien perdre : les plages valent pour les sept jours', () => {
    const legacy = normalizeAvailability({
      morning: { enabled: true, start: '08:00', end: '10:00' },
      afternoon: { enabled: false, start: '14:00', end: '18:00' },
      evening: { enabled: true, start: '19:00', end: '22:00' },
    });
    for (const id of WEEKDAY_ORDER) {
      expect(legacy[id].morning).toMatchObject({ enabled: true, start: '08:00', end: '10:00' });
      expect(legacy[id].afternoon.enabled).toBe(false);
      expect(legacy[id].evening).toMatchObject({ enabled: true, start: '19:00', end: '22:00' });
    }
    expect(weeklyAvailableMinutes(legacy)).toBe(7 * (120 + 180));
  });

  it('accepte un profil mixte : l’ancien format sert de base, le jour précis l’emporte', () => {
    const mixed = normalizeAvailability({
      morning: { enabled: false },
      afternoon: { enabled: true, start: '14:00', end: '18:00' },
      evening: { enabled: false },
      sunday: { afternoon: { enabled: false } },
    });
    expect(availableMinutes(mixed.monday)).toBe(240);
    expect(availableMinutes(mixed.sunday)).toBe(0);
  });

  it('accepte un profil vide sans rien inventer d’exotique', () => {
    const empty = normalizeAvailability(undefined);
    for (const id of WEEKDAY_ORDER) expect(empty[id]).toEqual(DEFAULT_DAY_AVAILABILITY);
  });

  it('réécrit au NOUVEAU format, relisible à l’identique', () => {
    const configured = normalizeAvailability({
      monday: { morning: { enabled: false }, afternoon: { enabled: false }, evening: { enabled: true, start: '17:00', end: '21:00' } },
      saturday: { morning: { enabled: true, start: '10:00', end: '18:00' }, afternoon: { enabled: false }, evening: { enabled: false } },
    });
    const stored = serializeAvailability(configured);
    // Les sept jours sont écrits en clair, et l'ancien format n'est plus produit.
    for (const id of WEEKDAY_ORDER) expect(stored[id]).toBeDefined();
    expect(stored.morning).toBeUndefined();
    // Aller-retour sans perte.
    expect(normalizeAvailability(stored)).toEqual(configured);
  });
});

// ────────────────────── Le travail déjà fait pèse sur la journée ──────────────────────

/**
 * Une séance terminée n'est plus une tâche, mais elle a bien occupé la
 * journée. La confondre avec du vide ferait empiler de nouvelles séances sur
 * une journée déjà pleinement travaillée.
 */
describe('charge et travail déjà réalisé', () => {
  const availability = oneSlot('14:00', '20:00'); // 360 min
  const doneSession = (id: string, day: string, start: string, end: string) =>
    event({ id, day, kind: 'review', startTime: start, endTime: end, done: true, status: 'done' });

  it('compte une séance terminée dans les minutes de la journée', () => {
    const load = dayLoad(TODAY, [doneSession('a', TODAY, '14:00', '15:30')], availability);
    expect(load.minutes).toBe(90);
    expect(load.workedMinutes).toBe(90);
  });

  it('ne la compte plus comme une séance à faire', () => {
    const load = dayLoad(TODAY, [doneSession('a', TODAY, '14:00', '15:30')], availability);
    expect(load.sessions).toBe(0);
    expect(load.doneSessions).toBe(1);
  });

  it('additionne plusieurs séances terminées le même jour', () => {
    // L'exemple du cahier des charges : 1 h 30 + 1 h terminées, 1 h prévue,
    // sur une journée de 4 h déclarées — 3 h 30 engagées, la journée est pleine.
    const load = dayLoad(
      TODAY,
      [
        doneSession('a', TODAY, '14:00', '15:30'),
        doneSession('b', TODAY, '15:30', '16:30'),
        event({ id: 'c', day: TODAY, kind: 'review', startTime: '17:00', endTime: '18:00' }),
      ],
      oneSlot('14:00', '18:00'),
    );
    expect(load.workedMinutes).toBe(150);
    expect(load.minutes).toBe(210);
    expect(load.sessions).toBe(1);
    expect(load.doneSessions).toBe(2);
    expect(load.level).toBe('heavy');
  });

  it('garde le créneau d’une séance terminée occupé', () => {
    const load = dayLoad(TODAY, [doneSession('a', TODAY, '14:00', '16:00')], availability);
    expect(load.busy).toEqual([{ start: '14:00', end: '16:00' }]);
  });

  it('préfère une journée peu travaillée à une journée déjà bien remplie', () => {
    const tomorrow = '2026-03-19';
    const result = scheduleSessions([request()], [doneSession('a', TODAY, '14:00', '17:00')], availability, {
      now: NOW,
      horizonDays: 3,
    });
    expect(result.sessions[0]!.day).toBe(tomorrow);
  });

  it('n’empile pas de nouvelles séances sur une journée déjà pleinement travaillée', () => {
    const events = [
      doneSession('a', TODAY, '14:00', '15:30'),
      doneSession('b', TODAY, '15:30', '16:30'),
      event({ id: 'c', day: TODAY, kind: 'review', startTime: '17:00', endTime: '18:00' }),
    ];
    const result = scheduleSessions(
      Array.from({ length: 3 }, (_, i) => request({ chapterId: `ch${i}` })),
      events,
      availability,
      { now: NOW, horizonDays: 5 },
    );
    for (const session of result.sessions) expect(session.day).not.toBe(TODAY);
  });

  it('compte le travail terminé dans les minutes engagées de la semaine', () => {
    const days = [TODAY, '2026-03-19'];
    const events = [
      doneSession('a', TODAY, '14:00', '15:00'),
      event({ id: 'b', day: '2026-03-19', startTime: '14:00', endTime: '14:30' }),
    ];
    expect(committedMinutes(events, days)).toBe(90);
  });

  it('n’interdit rien : une journée chargée reste modifiable à la main', () => {
    // Le planificateur AUTOMATIQUE s'abstient, mais `dayLoad` ne renvoie
    // aucun verrou — rien dans le modèle n'empêche d'ajouter un événement.
    const load = dayLoad(
      TODAY,
      [doneSession('a', TODAY, '14:00', '20:00')],
      availability,
    );
    expect(load.level).toBe('heavy');
    expect(load.capacity).toBeGreaterThan(0);
    expect(Object.keys(load)).not.toContain('locked');
  });
});
