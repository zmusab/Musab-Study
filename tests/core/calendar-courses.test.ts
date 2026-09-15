import { describe, expect, it } from 'vitest';
import {
  expandRecurring,
  isSeriesMaster,
  isVirtualOccurrence,
  occurrenceDays,
  occurrenceId,
  parseOccurrenceId,
} from '@/core/calendar/recurrence';
import { timetableRows } from '@/core/calendar/timetable';
import { normalizeAvailability, type WeeklyAvailability } from '@/core/calendar/availability';
import { buildAgenda, eventKindMeta, isFixedBlock, isLecture, isStudySession } from '@/core/calendar';
import { dayLoad } from '@/core/calendar/load';
import { committedMinutes, scheduleSessions, type SessionRequest } from '@/core/calendar/planner';
import { planWeek } from '@/core/calendar/plans';
import { DEFAULT_EASE } from '@/core/srs';
import { dayKey } from '@/lib/date';
import type { CalendarEvent, Chapter, Flashcard, Recurrence, ReviewLog, Subject } from '@/types';

/**
 * COURS UNIVERSITAIRES — des blocs FIXES.
 *
 * Deux garanties tenues ici : un cours bloque réellement son créneau pour le
 * planificateur, et il n'est jamais compté comme du travail personnel. La
 * récurrence, elle, n'écrit rien : une série est une ligne, ses occurrences
 * sont calculées.
 */

const NOW = new Date('2026-03-18T08:00:00.000Z'); // mercredi
const TODAY = dayKey(NOW);
const MONDAY = '2026-03-23';
const TUESDAY = '2026-03-24';

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
    room: null,
    teacher: null,
    recurrence: null,
    seriesId: null,
    occurrenceDay: null,
    cancelled: false,
    notes: '',
    done: false,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

const lecture = (overrides: Partial<CalendarEvent> & { id: string; day: string }): CalendarEvent =>
  event({ kind: 'lecture', title: 'Anatomie — CM', ...overrides });

const series = (
  id: string,
  recurrence: Recurrence,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent =>
  lecture({ id, day: recurrence.startDay, recurrence, startTime: '08:00', endTime: '10:00', ...overrides });

const request = (overrides: Partial<SessionRequest> = {}): SessionRequest => ({
  subjectId: 's1',
  subjectName: 'Anatomie',
  chapterId: 'ch1',
  chapterName: 'Nerfs',
  title: 'Anatomie — Nerfs',
  reason: 'maîtrise 30 %',
  minutes: 90,
  cardIds: ['c1'],
  ...overrides,
});

/** Une seule plage large, tous les jours : 08 h–21 h. */
const wideDay = (): WeeklyAvailability =>
  normalizeAvailability({
    morning: { enabled: true, start: '08:00', end: '12:00' },
    afternoon: { enabled: true, start: '12:00', end: '18:00' },
    evening: { enabled: true, start: '18:00', end: '21:00' },
  });

// ────────────────────────────── Récurrence ──────────────────────────────

describe('récurrence d’un cours', () => {
  it('tombe chaque semaine le jour demandé', () => {
    const days = occurrenceDays(
      { weekdays: ['monday'], startDay: '2026-03-16', endDay: '2026-04-13' },
      '2026-03-16',
      '2026-04-13',
    );
    expect(days).toEqual(['2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06', '2026-04-13']);
  });

  it('gère plusieurs jours dans la même semaine', () => {
    const days = occurrenceDays(
      { weekdays: ['tuesday', 'thursday'], startDay: '2026-03-16', endDay: '2026-03-27' },
      '2026-03-16',
      '2026-03-27',
    );
    expect(days).toEqual(['2026-03-17', '2026-03-19', '2026-03-24', '2026-03-26']);
  });

  it('respecte la date de début et la date de fin', () => {
    const recurrence: Recurrence = { weekdays: ['monday'], startDay: '2026-03-23', endDay: '2026-03-30' };
    const days = occurrenceDays(recurrence, '2026-03-01', '2026-04-30');
    expect(days).toEqual(['2026-03-23', '2026-03-30']);
  });

  it('sans date de fin, ne produit que ce que la fenêtre demande', () => {
    const days = occurrenceDays(
      { weekdays: ['monday'], startDay: '2026-03-16', endDay: null },
      '2026-03-16',
      '2026-04-06',
    );
    expect(days).toHaveLength(4);
  });

  it('ne produit rien sans jour coché', () => {
    expect(occurrenceDays({ weekdays: [], startDay: '2026-03-16', endDay: null }, '2026-03-16', '2026-05-16'))
      .toEqual([]);
  });

  it('distingue une occurrence calculée d’une vraie ligne', () => {
    const id = occurrenceId('evt_1', MONDAY);
    expect(parseOccurrenceId(id)).toEqual({ seriesId: 'evt_1', day: MONDAY });
    expect(isVirtualOccurrence({ id })).toBe(true);
    expect(isVirtualOccurrence({ id: 'evt_1' })).toBe(false);
  });
});

describe('dépliage des séries', () => {
  const master = series('serie', { weekdays: ['monday'], startDay: '2026-03-16', endDay: '2026-04-13' });

  it('remplace la ligne série par ses occurrences datées', () => {
    const expanded = expandRecurring([master], '2026-03-16', '2026-03-30');
    expect(expanded).toHaveLength(3);
    // La définition elle-même n'apparaît jamais dans le calendrier.
    expect(expanded.some(isSeriesMaster)).toBe(false);
    expect(expanded.map((row) => row.day)).toEqual(['2026-03-16', '2026-03-23', '2026-03-30']);
    expect(expanded.every((row) => row.startTime === '08:00')).toBe(true);
    expect(expanded.every((row) => row.seriesId === 'serie')).toBe(true);
  });

  it('laisse les événements ordinaires intacts', () => {
    const plain = event({ id: 'plain', day: TODAY, kind: 'review', startTime: '14:00', endTime: '15:00' });
    const expanded = expandRecurring([master, plain], TODAY, '2026-03-30');
    expect(expanded.find((row) => row.id === 'plain')).toEqual(plain);
  });

  it('laisse une EXCEPTION l’emporter sur la série, ce jour-là seulement', () => {
    const exception = lecture({
      id: 'exc',
      day: MONDAY,
      seriesId: 'serie',
      occurrenceDay: MONDAY,
      startTime: '10:00',
      endTime: '12:00',
      room: 'Amphi B',
    });
    const expanded = expandRecurring([master, exception], '2026-03-16', '2026-03-30');
    const monday = expanded.find((row) => row.day === MONDAY)!;
    expect(monday.id).toBe('exc');
    expect(monday.startTime).toBe('10:00');
    expect(monday.room).toBe('Amphi B');
    // Les autres occurrences gardent l'horaire de la série.
    expect(expanded.filter((row) => row.startTime === '08:00')).toHaveLength(2);
  });

  it('fait disparaître une occurrence annulée sans toucher au reste', () => {
    const cancelled = lecture({
      id: 'exc',
      day: MONDAY,
      seriesId: 'serie',
      occurrenceDay: MONDAY,
      cancelled: true,
    });
    const expanded = expandRecurring([master, cancelled], '2026-03-16', '2026-03-30');
    expect(expanded.map((row) => row.day)).toEqual(['2026-03-16', '2026-03-30']);
  });

  it('scinder une série ne réécrit pas le passé', () => {
    // Forme exacte produite par « cette occurrence et les suivantes » :
    // l'ancienne série s'arrête la veille, une nouvelle reprend ensuite.
    const past = series('ancienne', { weekdays: ['monday'], startDay: '2026-03-16', endDay: '2026-03-22' });
    const next = series(
      'nouvelle',
      { weekdays: ['monday'], startDay: MONDAY, endDay: '2026-04-13' },
      { startTime: '10:00', endTime: '12:00' },
    );
    const expanded = expandRecurring([past, next], '2026-03-16', '2026-03-30');
    expect(expanded.find((row) => row.day === '2026-03-16')!.startTime).toBe('08:00');
    expect(expanded.find((row) => row.day === MONDAY)!.startTime).toBe('10:00');
  });
});

// ────────────────────── Un cours n'est pas une séance d'étude ──────────────────────

describe('cours et séance d’étude sont deux choses différentes', () => {
  const course = lecture({ id: 'l1', day: TODAY, startTime: '08:00', endTime: '10:00' });

  it('un cours n’est pas une séance d’étude', () => {
    expect(isLecture(course)).toBe(true);
    expect(isStudySession(course)).toBe(false);
    expect(eventKindMeta('lecture').family).toBe('fixed');
  });

  it('une séance d’étude reste une séance d’étude', () => {
    expect(isStudySession(event({ id: 's', day: TODAY, kind: 'review' }))).toBe(true);
    expect(isLecture(event({ id: 's', day: TODAY, kind: 'review' }))).toBe(false);
  });

  it('un cours ne compte pas dans les minutes d’étude de la semaine', () => {
    const study = event({ id: 'study', day: TODAY, kind: 'review', startTime: '14:00', endTime: '15:00' });
    expect(committedMinutes([course, study], [TODAY])).toBe(60);
  });

  it('un cours a sa propre couleur, distincte des séances et des évaluations', () => {
    const colors = new Set(
      (['lecture', 'review', 'exam', 'task'] as const).map((kind) => eventKindMeta(kind).colorVar),
    );
    expect(colors.size).toBe(4);
  });

  it('l’agenda du jour range les cours à part', () => {
    const study = event({ id: 'study', day: TODAY, kind: 'review', startTime: '14:00' });
    const agenda = buildAgenda(TODAY, [course, study], new Map(), [], [], NOW);
    expect(agenda.fixed.map((entry) => entry.event.id)).toEqual(['l1']);
    expect(agenda.sessions.map((entry) => entry.event.id)).toEqual(['study']);
    expect(agenda.others).toEqual([]);
  });
});

// ────────────────────── Les cours bloquent les créneaux ──────────────────────

describe('les cours bloquent le planificateur', () => {
  const availability = wideDay();

  it('pèse sur la charge du jour sans devenir une tâche à faire', () => {
    const load = dayLoad(TODAY, [lecture({ id: 'l', day: TODAY, startTime: '08:00', endTime: '10:00' })], availability);
    expect(load.minutes).toBe(120);
    expect(load.sessions).toBe(0);
    expect(load.doneSessions).toBe(0);
    expect(load.busy).toEqual([{ start: '08:00', end: '10:00' }]);
  });

  it('réduit la place disponible sans confisquer la journée', () => {
    // 08 h–12 h déclarées, cours de 08 h à 10 h : il reste deux heures, pas
    // quatre — et surtout pas zéro.
    const morning = normalizeAvailability({
      morning: { enabled: true, start: '08:00', end: '12:00' },
      afternoon: { enabled: false },
      evening: { enabled: false },
    });
    const load = dayLoad(TODAY, [lecture({ id: 'l', day: TODAY, startTime: '08:00', endTime: '10:00' })], morning);
    expect(load.capacity).toBe(240);
    expect(load.freeCapacity).toBe(120);
    // Un cours n'est pas du travail personnel : il ne consomme pas le budget
    // que le plan s'autorise.
    expect(load.studyMinutes).toBe(0);
  });

  it('ne retient d’un cours que ce qui empiète vraiment sur mes plages', () => {
    const afternoon = normalizeAvailability({
      morning: { enabled: false },
      afternoon: { enabled: true, start: '14:00', end: '18:00' },
      evening: { enabled: false },
    });
    const load = dayLoad(TODAY, [lecture({ id: 'l', day: TODAY, startTime: '08:00', endTime: '10:00' })], afternoon);
    expect(load.freeCapacity).toBe(240);
  });

  it('place une séance dans le seul jour disponible, après le cours', () => {
    // Cas décisif : une seule plage (08 h–12 h), un cours de 08 h à 10 h. La
    // séance doit tenir dans le trou restant plutôt que d'être refusée.
    const morning = normalizeAvailability({
      morning: { enabled: true, start: '08:00', end: '12:00' },
      afternoon: { enabled: false },
      evening: { enabled: false },
    });
    const result = scheduleSessions(
      [request({ minutes: 90 })],
      [lecture({ id: 'l', day: TODAY, startTime: '08:00', endTime: '10:00' })],
      morning,
      { now: NOW, horizonDays: 1 },
    );
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.startTime).toBe('10:00');
  });

  it('ne place jamais une séance pendant un cours', () => {
    // Disponible 08 h–21 h, cours de 08 h à 12 h : la séance doit commencer
    // après midi, pas au début de la plage déclarée.
    const events = [lecture({ id: 'l', day: TODAY, startTime: '08:00', endTime: '12:00' })];
    const result = scheduleSessions([request()], events, availability, {
      now: NOW,
      horizonDays: 1,
    });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.startTime).toBe('12:00');
  });

  it('se glisse dans un vrai trou entre deux cours', () => {
    // 08–10, 10:15–12:00, puis 15:00–17:00 : le seul trou d'1 h 30 est 12:00.
    const events = [
      lecture({ id: 'a', day: TODAY, startTime: '08:00', endTime: '10:00' }),
      lecture({ id: 'b', day: TODAY, startTime: '10:15', endTime: '12:00' }),
      lecture({ id: 'c', day: TODAY, startTime: '15:00', endTime: '17:00' }),
    ];
    const result = scheduleSessions([request()], events, availability, { now: NOW, horizonDays: 1 });
    expect(result.sessions[0]!.startTime).toBe('12:00');
    expect(result.sessions[0]!.endTime).toBe('13:30');
  });

  it('passe au jour suivant quand les cours ne laissent aucun trou assez large', () => {
    const events = [
      lecture({ id: 'a', day: TODAY, startTime: '08:00', endTime: '20:00' }),
    ];
    const result = scheduleSessions([request()], events, availability, { now: NOW, horizonDays: 3 });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.day).not.toBe(TODAY);
  });

  it('n’entre pas en conflit avec un examen daté', () => {
    const events = [
      event({ id: 'exam', day: TUESDAY, kind: 'exam', startTime: '08:00', endTime: '11:00' }),
      lecture({ id: 'l', day: TUESDAY, startTime: '14:00', endTime: '18:00' }),
    ];
    const result = scheduleSessions([request({ deadline: '2026-03-25' })], events, availability, {
      now: NOW,
      horizonDays: 7,
    });
    for (const session of result.sessions) {
      if (session.day !== TUESDAY) continue;
      expect(['11:00', '18:00']).toContain(session.startTime);
    }
  });

  it('travaille sur les occurrences dépliées d’une série, pas sur sa définition', () => {
    const master = series('serie', { weekdays: ['wednesday'], startDay: '2026-03-01', endDay: null }, {
      startTime: '08:00',
      endTime: '12:00',
    });
    const expanded = expandRecurring([master], TODAY, TODAY);
    const result = scheduleSessions([request()], expanded, availability, { now: NOW, horizonDays: 1 });
    expect(result.sessions[0]!.startTime).toBe('12:00');
  });
});

// ────────────────────────────── Emploi du temps ──────────────────────────────

describe('emploi du temps hebdomadaire', () => {
  const availability = wideDay();

  it('liste les cours et les vrais trous entre eux', () => {
    const rows = timetableRows(
      [
        lecture({ id: 'a', day: MONDAY, title: 'Anatomie', startTime: '08:00', endTime: '10:00' }),
        lecture({ id: 'b', day: MONDAY, title: 'Histologie', startTime: '10:15', endTime: '12:00' }),
      ],
      availability,
      'monday',
    );
    expect(rows.map((row) => `${row.start} ${row.label}`)).toEqual([
      '08:00 Anatomie',
      '10:00 libre · 15 min',
      '10:15 Histologie',
      // Les plages qui se touchent (12 h–18 h puis 18 h–21 h) ne font qu'un
      // seul créneau libre : leur frontière n'interrompt rien.
      '12:00 libre · 9 h',
    ]);
  });

  it('n’annonce aucun créneau libre un jour sans plage déclarée', () => {
    const closed = normalizeAvailability({
      morning: { enabled: false },
      afternoon: { enabled: false },
      evening: { enabled: false },
    });
    const rows = timetableRows([lecture({ id: 'a', day: MONDAY, startTime: '08:00', endTime: '10:00' })], closed, 'monday');
    expect(rows.filter((row) => row.kind === 'free')).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it('affiche la salle et l’enseignant quand ils sont renseignés', () => {
    const rows = timetableRows(
      [lecture({ id: 'a', day: MONDAY, startTime: '08:00', endTime: '10:00', room: 'Amphi B', teacher: 'Dr Popa' })],
      availability,
      'monday',
    );
    expect(rows[0]!.detail).toBe('Amphi B · Dr Popa');
  });

  it('ne fabrique aucun horaire pour un cours sans heure', () => {
    const rows = timetableRows([lecture({ id: 'a', day: MONDAY })], availability, 'monday');
    expect(rows.filter((row) => row.kind === 'block')).toEqual([]);
  });
});

// ────────────────────────── « Temps pour soi » ──────────────────────────

/**
 * Sport, repas, repos, rendez-vous. Comme un cours, ce temps occupe la
 * journée ; comme lui, il n'est jamais du travail personnel mesuré.
 */
describe('temps pour soi', () => {
  const availability = wideDay();
  const personal = (overrides: Partial<CalendarEvent> & { id: string; day: string }): CalendarEvent =>
    event({ kind: 'personal', title: 'Natation', ...overrides });

  it('a sa propre couleur et son propre libellé', () => {
    expect(eventKindMeta('personal').label).toBe('Temps pour soi');
    const colors = new Set(
      (['personal', 'lecture', 'review', 'exam', 'task'] as const).map((kind) => eventKindMeta(kind).colorVar),
    );
    expect(colors.size).toBe(5);
  });

  it('n’est ni une séance d’étude ni un cours, mais bloque comme un cours', () => {
    const block = personal({ id: 'p', day: TODAY, startTime: '18:00', endTime: '20:00' });
    expect(isStudySession(block)).toBe(false);
    expect(isLecture(block)).toBe(false);
    expect(isFixedBlock(block)).toBe(true);
  });

  it('occupe la journée sans jamais compter comme du travail', () => {
    const load = dayLoad(TODAY, [personal({ id: 'p', day: TODAY, startTime: '18:00', endTime: '20:00' })], availability);
    expect(load.minutes).toBe(120);
    expect(load.studyMinutes).toBe(0);
    expect(load.sessions).toBe(0);
    expect(load.busy).toEqual([{ start: '18:00', end: '20:00' }]);
  });

  it('ne compte pas dans les minutes d’étude de la semaine', () => {
    const block = personal({ id: 'p', day: TODAY, startTime: '18:00', endTime: '20:00' });
    const study = event({ id: 's', day: TODAY, kind: 'review', startTime: '14:00', endTime: '15:00' });
    expect(committedMinutes([block, study], [TODAY])).toBe(60);
  });

  it('réduit la place laissée aux séances, exactement comme un cours', () => {
    const morning = normalizeAvailability({
      morning: { enabled: true, start: '08:00', end: '12:00' },
      afternoon: { enabled: false },
      evening: { enabled: false },
    });
    const load = dayLoad(TODAY, [personal({ id: 'p', day: TODAY, startTime: '08:00', endTime: '10:00' })], morning);
    expect(load.freeCapacity).toBe(120);
  });

  it('n’accueille jamais une séance sur son créneau', () => {
    const result = scheduleSessions(
      [request()],
      [personal({ id: 'p', day: TODAY, startTime: '08:00', endTime: '12:00' })],
      availability,
      { now: NOW, horizonDays: 1 },
    );
    expect(result.sessions[0]!.startTime).toBe('12:00');
  });

  it('cumule avec les cours pour réduire la journée', () => {
    // Une matinée de cours et une soirée de sport : il ne reste que
    // l'après-midi, et c'est là que la séance doit tomber.
    const events = [
      lecture({ id: 'l', day: TODAY, startTime: '08:00', endTime: '12:00' }),
      personal({ id: 'p', day: TODAY, startTime: '13:30', endTime: '21:00' }),
    ];
    const result = scheduleSessions([request({ minutes: 90 })], events, availability, {
      now: NOW,
      horizonDays: 1,
    });
    expect(result.sessions[0]!.startTime).toBe('12:00');
    expect(result.sessions[0]!.endTime).toBe('13:30');
  });

  it('se range dans l’agenda avec les cours, jamais avec les séances', () => {
    const agenda = buildAgenda(
      TODAY,
      [
        personal({ id: 'p', day: TODAY, startTime: '18:00' }),
        event({ id: 's', day: TODAY, kind: 'review', startTime: '14:00' }),
      ],
      new Map(),
      [],
      [],
      NOW,
    );
    expect(agenda.fixed.map((entry) => entry.event.id)).toEqual(['p']);
    expect(agenda.sessions.map((entry) => entry.event.id)).toEqual(['s']);
  });

  it('apparaît dans l’emploi du temps avec sa couleur', () => {
    const rows = timetableRows(
      [personal({ id: 'p', day: MONDAY, title: 'Natation', startTime: '18:00', endTime: '20:00' })],
      availability,
      'monday',
    );
    const block = rows.find((row) => row.kind === 'block')!;
    expect(block.label).toBe('Natation');
    expect(block.color).toBe(eventKindMeta('personal').colorVar);
  });
});

// ──────────────── Les données pilotent réellement la priorité ────────────────

/**
 * « Si beaucoup de flashcards d'Anatomie sont dues ou en retard, le système
 * doit augmenter la priorité d'Anatomie. » Ce qui suit le vérifie sur des
 * cartes réelles, sans jamais toucher à leurs échéances SM-2.
 */
describe('les cartes dues et en retard pilotent la priorité', () => {
  const subjects: Subject[] = [
    { id: 's1', name: 'Anatomie', color: '#888', createdAt: '2026-01-01T00:00:00.000Z', position: 0 },
    { id: 's2', name: 'Physiologie', color: '#888', createdAt: '2026-01-01T00:00:00.000Z', position: 1 },
  ];
  const chapters: Chapter[] = [];

  /** Deux matières identiques, sauf l'échéance de leurs cartes. */
  const cardsFor = (subjectId: string, dueIso: string, count = 4): Flashcard[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `${subjectId}-c${i}`,
      subjectId,
      chapterId: null,
      question: 'Q',
      answer: 'A',
      importance: 2 as const,
      difficulty: 2 as const,
      ease: DEFAULT_EASE,
      interval: 5,
      reps: 3,
      lapses: 0,
      due: dueIso,
      lastReview: '2026-03-10T00:00:00.000Z',
      origin: 'manual' as const,
      sourceChunkIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    }));

  const base = {
    events: [] as CalendarEvent[],
    subjects,
    chapters,
    logs: [] as ReviewLog[],
    availability: wideDay(),
    weeklyGoalMinutes: 600,
    minutesPerSession: 45,
    now: NOW,
  };

  it('fait passer devant la matière dont les cartes sont en retard', () => {
    const plan = planWeek({
      ...base,
      // Anatomie : quatre cartes en retard de deux semaines.
      // Physiologie : quatre cartes qui arriveront à échéance plus tard.
      cards: [
        ...cardsFor('s1', '2026-03-04T00:00:00.000Z'),
        ...cardsFor('s2', '2026-04-15T00:00:00.000Z'),
      ],
    });
    expect(plan.sessions[0]!.subjectId).toBe('s1');
    expect(plan.sessions[0]!.reason).toMatch(/en retard/);
  });

  it('distingue une carte simplement due d’une carte en retard', () => {
    const plan = planWeek({
      ...base,
      cards: [
        // Dues aujourd'hui d'un côté, en retard de trois semaines de l'autre.
        ...cardsFor('s1', '2026-03-18T00:00:00.000Z'),
        ...cardsFor('s2', '2026-02-25T00:00:00.000Z'),
      ],
    });
    expect(plan.sessions[0]!.subjectId).toBe('s2');
  });

  it('n’invente aucune échéance : les cartes ne sont jamais réécrites', () => {
    const cards = [...cardsFor('s1', '2026-03-04T00:00:00.000Z'), ...cardsFor('s2', '2026-04-15T00:00:00.000Z')];
    const before = cards.map((card) => ({ due: card.due, interval: card.interval, ease: card.ease }));
    planWeek({ ...base, cards });
    expect(cards.map((card) => ({ due: card.due, interval: card.interval, ease: card.ease }))).toEqual(before);
  });

  it('rattache à chaque séance les cartes réelles du chapitre visé', () => {
    const cards = cardsFor('s1', '2026-03-04T00:00:00.000Z');
    const plan = planWeek({ ...base, cards });
    expect(plan.sessions[0]!.cardIds.sort()).toEqual(cards.map((card) => card.id).sort());
  });
});
