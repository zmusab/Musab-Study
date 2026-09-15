import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  buildAgenda,
  dueByDay,
  durationLabel,
  eventKindMeta,
  examBrief,
  isStudySession,
  monthMatrix,
  planStudySessions,
  sessionState,
  spreadDays,
  upcomingEvents,
  weekOf,
} from '@/core/calendar';
import { DEFAULT_EASE } from '@/core/srs';
import { dayKey } from '@/lib/date';
import type { CalendarEvent, Chapter, Flashcard, ReviewLog, Subject } from '@/types';

/**
 * Deux exigences se recoupent ici :
 *  - le calendrier ne fabrique RIEN — pas d'événement de remplissage, pas de
 *    date déduite, pas d'échéance projetée au-delà de ce que la répétition
 *    espacée connaît ;
 *  - les cartes dues restent AGRÉGÉES : une carte ne devient jamais une ligne
 *    d'agenda, sinon un mois chargé devient illisible.
 */

const NOW = new Date('2026-03-18T14:00:00.000Z'); // mercredi

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

describe('grille du mois', () => {
  it('commence toujours un lundi et finit un dimanche', () => {
    const weeks = monthMatrix(new Date('2026-03-10T12:00:00.000Z'), NOW);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0]![0]!.day).toBe(weekOf(new Date('2026-03-01T12:00:00.000Z'))[0]);
  });

  it('ne force pas six semaines quand le mois en tient cinq', () => {
    // Février 2026 commence un dimanche : cinq semaines suffisent, une
    // sixième ligne serait entièrement vide.
    const weeks = monthMatrix(new Date('2026-02-10T12:00:00.000Z'), NOW);
    expect(weeks.length).toBeLessThanOrEqual(6);
    expect(weeks.some((week) => week.some((cell) => cell.inMonth))).toBe(true);
  });

  it('marque les débords de mois et le jour courant', () => {
    const weeks = monthMatrix(NOW, NOW);
    const flat = weeks.flat();
    expect(flat.filter((cell) => cell.isToday)).toHaveLength(1);
    expect(flat.some((cell) => !cell.inMonth)).toBe(true);
  });
});

describe('cartes dues', () => {
  const subjects = [subject('s1', 'Anatomie'), subject('s2', 'Histologie', 1)];
  const days = weekOf(NOW);

  it('agrège par jour au lieu de produire une ligne par carte', () => {
    const tomorrow = new Date(2026, 2, 19).toISOString();
    const cards = [
      card({ id: 'c1', subjectId: 's1', due: tomorrow }),
      card({ id: 'c2', subjectId: 's1', due: tomorrow }),
      card({ id: 'c3', subjectId: 's2', due: tomorrow }),
    ];
    const buckets = dueByDay(cards, days, subjects, NOW);
    expect(buckets.size).toBe(1);
    const bucket = buckets.get('2026-03-19')!;
    expect(bucket.cards).toBe(3);
    expect(bucket.subjects.map((entry) => entry.name)).toEqual(['Anatomie', 'Histologie']);
    expect(bucket.cardIds).toHaveLength(3);
  });

  it('ramène le retard sur aujourd’hui plutôt que de rougir le passé', () => {
    const cards = [card({ id: 'vieux', subjectId: 's1', due: '2026-02-01T00:00:00.000Z' })];
    const buckets = dueByDay(cards, days, subjects, NOW);
    expect(buckets.get('2026-02-01')).toBeUndefined();
    expect(buckets.get(dayKey(NOW))!.overdue).toBe(1);
  });

  it('ne projette rien au-delà des jours demandés', () => {
    const cards = [card({ id: 'loin', subjectId: 's1', due: '2026-09-01T00:00:00.000Z' })];
    expect(dueByDay(cards, days, subjects, NOW).size).toBe(0);
  });
});

describe('état d’une séance', () => {
  it('déduit « manquée » d’une séance passée jamais commencée', () => {
    expect(sessionState(event({ id: 'e1', day: '2026-03-10' }), NOW)).toBe('missed');
  });

  it('ne considère pas manquée une séance encore à venir', () => {
    expect(sessionState(event({ id: 'e1', day: '2026-03-25' }), NOW)).toBe('planned');
  });

  it('respecte les états explicitement enregistrés', () => {
    expect(sessionState(event({ id: 'e1', day: '2026-03-10', status: 'started' }), NOW)).toBe('started');
    expect(sessionState(event({ id: 'e2', day: '2026-03-10', status: 'done', done: true }), NOW)).toBe('done');
  });

  it('reste correct pour un événement enregistré avant l’ajout de `status`', () => {
    const legacy = { ...event({ id: 'old', day: '2026-03-25' }), status: undefined };
    expect(sessionState(legacy, NOW)).toBe('planned');
    expect(sessionState({ ...legacy, done: true }, NOW)).toBe('done');
  });
});

describe('agenda d’une journée', () => {
  const subjects = [subject('s1', 'Anatomie')];
  const chapters = [chapter('ch1', 's1', 'Nerfs')];

  it('sépare évaluations, séances et révisions dues', () => {
    const events = [
      event({ id: 'exam', day: '2026-03-19', kind: 'midterm', title: 'Contrôle' }),
      event({ id: 'sess', day: '2026-03-19', kind: 'review', title: 'Révision nerfs', chapterId: 'ch1' }),
      event({ id: 'task', day: '2026-03-19', kind: 'task', title: 'Rendre le dossier' }),
    ];
    const due = dueByDay(
      [card({ id: 'c1', subjectId: 's1', due: new Date(2026, 2, 19).toISOString() })],
      ['2026-03-19'],
      subjects,
      NOW,
    );
    const agenda = buildAgenda('2026-03-19', events, due, subjects, chapters, NOW);

    expect(agenda.evaluations.map((entry) => entry.event.id)).toEqual(['exam']);
    expect(agenda.sessions.map((entry) => entry.event.id)).toEqual(['sess']);
    expect(agenda.others.map((entry) => entry.event.id)).toEqual(['task']);
    expect(agenda.due?.cards).toBe(1);
    expect(agenda.isEmpty).toBe(false);
    expect(agenda.sessions[0]!.chapterName).toBe('Nerfs');
  });

  it('déclare vide une journée sans événement ET sans carte due', () => {
    const agenda = buildAgenda('2026-03-20', [], new Map(), subjects, chapters, NOW);
    expect(agenda.isEmpty).toBe(true);
  });

  it('classe les événements par heure, ceux sans heure à la fin', () => {
    const events = [
      event({ id: 'apres', day: '2026-03-19', startTime: '16:00' }),
      event({ id: 'journee', day: '2026-03-19' }),
      event({ id: 'matin', day: '2026-03-19', startTime: '08:30' }),
    ];
    const agenda = buildAgenda('2026-03-19', events, new Map(), subjects, chapters, NOW);
    expect(agenda.sessions.map((entry) => entry.event.id)).toEqual(['matin', 'apres', 'journee']);
  });
});

describe('genres d’événement', () => {
  it('distingue les familles utilisées par l’affichage', () => {
    expect(eventKindMeta('final').family).toBe('evaluation');
    expect(eventKindMeta('review').family).toBe('session');
    expect(eventKindMeta('task').family).toBe('goal');
    expect(isStudySession({ kind: 'course' })).toBe(true);
    expect(isStudySession({ kind: 'exam' })).toBe(false);
  });

  it('donne un rang supérieur aux évaluations', () => {
    expect(eventKindMeta('final').rank).toBeGreaterThan(eventKindMeta('course').rank);
  });
});

describe('plan de révision', () => {
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

  it('ne propose rien quand l’évaluation est passée', () => {
    const plan = planStudySessions('2026-03-10', 's1', 'Anatomie', chapters, cards, logs, NOW);
    expect(plan.sessions).toEqual([]);
    expect(plan.blocked).toMatch(/passée|aujourd/);
  });

  it('ne propose rien pour une matière sans flashcard', () => {
    const plan = planStudySessions('2026-04-01', 's1', 'Anatomie', chapters, [], [], NOW);
    expect(plan.sessions).toEqual([]);
    expect(plan.blocked).toMatch(/aucune flashcard/i);
  });

  it('répartit les séances sur les jours disponibles, sans dépasser l’examen', () => {
    const plan = planStudySessions('2026-03-30', 's1', 'Anatomie', chapters, cards, logs, NOW);
    expect(plan.sessions.length).toBeGreaterThan(1);
    for (const session of plan.sessions) {
      expect(session.day >= dayKey(NOW)).toBe(true);
      expect(session.day < '2026-03-30').toBe(true);
    }
    // Les jours ne se répètent pas : une séance par jour au maximum.
    const days = plan.sessions.map((session) => session.day);
    expect(new Set(days).size).toBe(days.length);
  });

  it('donne davantage de séances au chapitre le plus faible', () => {
    const plan = planStudySessions('2026-03-30', 's1', 'Anatomie', chapters, cards, logs, NOW);
    const count = (chapterId: string) =>
      plan.sessions.filter((session) => session.chapterId === chapterId).length;
    expect(count('ch2')).toBeGreaterThanOrEqual(count('ch1'));
  });

  it('réserve la veille à une révision générale', () => {
    const plan = planStudySessions('2026-03-30', 's1', 'Anatomie', chapters, cards, logs, NOW);
    const last = plan.sessions[plan.sessions.length - 1]!;
    expect(last.day).toBe('2026-03-29');
    expect(last.chapterId).toBeNull();
    expect(last.title).toMatch(/générale/);
  });

  it('rattache à chaque séance les cartes réellement concernées', () => {
    const plan = planStudySessions('2026-03-30', 's1', 'Anatomie', chapters, cards, logs, NOW);
    for (const session of plan.sessions) {
      expect(session.cardIds.length).toBeGreaterThan(0);
      if (session.chapterId !== null) {
        const ids = cards.filter((entry) => entry.chapterId === session.chapterId).map((entry) => entry.id);
        expect(session.cardIds.sort()).toEqual(ids.sort());
      }
    }
  });

  it('reste tenable quand l’examen est très lointain', () => {
    const plan = planStudySessions('2026-08-30', 's1', 'Anatomie', chapters, cards, logs, NOW, {
      maxSessions: 8,
    });
    expect(plan.sessions.length).toBeLessThanOrEqual(8);
  });
});

describe('spreadDays', () => {
  it('répartit au lieu de masser en début de période', () => {
    const days = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(spreadDays(days, 4)).toEqual(['a', 'c', 'e', 'g']);
  });

  it('renvoie tout quand on demande plus que disponible', () => {
    expect(spreadDays(['a', 'b'], 5)).toEqual(['a', 'b']);
    expect(spreadDays([], 3)).toEqual([]);
  });
});

describe('fiche d’examen', () => {
  const subjects = [subject('s1', 'Anatomie')];
  const chapters = [chapter('ch1', 's1', 'Nerfs')];
  const cards = [
    card({ id: 'c1', subjectId: 's1', chapterId: 'ch1', reps: 1, interval: 1, due: '2026-03-10T00:00:00.000Z' }),
  ];
  const logs = [log({ id: 'l1', itemId: 'c1', subjectId: 's1', chapterId: 'ch1' })];

  it('compte les cartes dues et les chapitres faibles réels', () => {
    const exam = event({ id: 'exam', day: '2026-03-25', kind: 'exam', title: 'Examen' });
    const brief = examBrief(exam, subjects, chapters, cards, logs, [exam], NOW);
    expect(brief.daysUntil).toBe(7);
    expect(brief.dueCards).toBe(1);
    expect(brief.weakChapters.length).toBeGreaterThan(0);
    expect(brief.subjectName).toBe('Anatomie');
  });

  it('suit l’avancement du plan rattaché', () => {
    const exam = event({ id: 'exam', day: '2026-03-25', kind: 'exam' });
    const plan = [
      event({ id: 'p1', day: '2026-03-20', kind: 'review', planForEventId: 'exam' }),
      event({ id: 'p2', day: '2026-03-21', kind: 'review', planForEventId: 'exam', status: 'done', done: true }),
      event({ id: 'autre', day: '2026-03-22', kind: 'review' }),
    ];
    const brief = examBrief(exam, subjects, chapters, cards, logs, [exam, ...plan], NOW);
    expect(brief.plannedSessions).toBe(2);
    expect(brief.completedSessions).toBe(1);
  });
});

describe('prochaines évaluations', () => {
  it('ne retient que les évaluations à venir et non faites', () => {
    const events = [
      event({ id: 'passe', day: '2026-03-01', kind: 'exam' }),
      event({ id: 'faite', day: '2026-03-25', kind: 'exam', done: true }),
      event({ id: 'seance', day: '2026-03-25', kind: 'review' }),
      event({ id: 'ok', day: '2026-03-25', kind: 'exam' }),
    ];
    expect(upcomingEvents(events, NOW).map((entry) => entry.id)).toEqual(['ok']);
  });
});

describe('formatage des horaires', () => {
  it('calcule une durée lisible', () => {
    expect(durationLabel('08:00', '09:30')).toBe('1 h 30');
    expect(durationLabel('08:00', '08:45')).toBe('45 min');
    expect(durationLabel('08:00', '10:00')).toBe('2 h');
  });

  it('refuse une durée nulle ou négative plutôt que d’afficher n’importe quoi', () => {
    expect(durationLabel('10:00', '09:00')).toBeNull();
    expect(durationLabel('10:00', '10:00')).toBeNull();
    expect(durationLabel(null, '10:00')).toBeNull();
  });

  it('ajoute des minutes sans déborder de la journée', () => {
    expect(addMinutes('08:00', 90)).toBe('09:30');
    expect(addMinutes('23:30', 90)).toBe('23:59');
  });
});
