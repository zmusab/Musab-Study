import { describe, expect, it } from 'vitest';
import {
  answerStats,
  bucketByDay,
  chapterProgress,
  computeStreak,
  formatDuration,
  goalProgress,
  masteryBand,
  masteryTrend,
  MIN_REVIEWED_CARDS,
  overallMastery,
  recentActivity,
  startOfWeek,
  studyTime,
  subjectProgress,
  upcomingReviews,
  weakPoints,
  weekDays,
} from '@/core/progress';
import { progressView } from '@/core/progress/view';
import { DEFAULT_EASE } from '@/core/srs';
import { dayKey } from '@/lib/date';
import type { Chapter, Flashcard, ReviewLog, Subject } from '@/types';

/**
 * L'exigence testée ici n'est pas seulement « les calculs sont justes » : c'est
 * qu'AUCUN chiffre n'apparaît sans donnée derrière. Plusieurs tests vérifient
 * donc explicitement qu'une statistique reste `null` tant qu'elle n'est pas
 * mesurable, au lieu de retomber sur 0 — un 0 se lit « tu es nul », un `null`
 * se lit « on ne sait pas encore », et la différence est essentielle.
 */

const NOW = new Date('2026-03-18T14:00:00.000Z'); // un mercredi

function subject(id: string, name: string, position = 0): Subject {
  return { id, name, color: '#888888', createdAt: '2026-01-01T00:00:00.000Z', position };
}

function chapter(id: string, subjectId: string, name: string, position = 0): Chapter {
  return { id, subjectId, name, createdAt: '2026-01-01T00:00:00.000Z', position };
}

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
  const at = overrides.at ?? '2026-03-18T09:00:00.000Z';
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

describe('paliers de maîtrise', () => {
  it('classe chaque pourcentage dans un palier unique', () => {
    expect(masteryBand(92).band).toBe('strong');
    expect(masteryBand(80).band).toBe('strong');
    expect(masteryBand(79).band).toBe('good');
    expect(masteryBand(60).band).toBe('good');
    expect(masteryBand(59).band).toBe('fragile');
    expect(masteryBand(40).band).toBe('fragile');
    expect(masteryBand(39).band).toBe('weak');
    expect(masteryBand(0).band).toBe('weak');
  });

  it('n’utilise que des variables de thème, jamais une couleur en dur', () => {
    for (const pct of [0, 45, 65, 95]) expect(masteryBand(pct).colorVar).toMatch(/^var\(--/);
  });
});

describe('maîtrise globale', () => {
  it('refuse de publier un chiffre tant que trop peu de cartes ont été révisées', () => {
    const cards = [card({ id: 'c1', subjectId: 's1', reps: 3, interval: 20 })];
    const result = overallMastery(cards);
    expect(result.pct).toBeNull();
    expect(result.missing).toBe(MIN_REVIEWED_CARDS - 1);
  });

  it('calcule la moyenne sur TOUTES les cartes, jamais seulement les révisées', () => {
    const reviewed = Array.from({ length: 5 }, (_, i) =>
      card({ id: `r${i}`, subjectId: 's1', reps: 4, interval: 60, ease: 3.2 }),
    );
    const untouched = Array.from({ length: 5 }, (_, i) => card({ id: `u${i}`, subjectId: 's1' }));
    const onlyReviewed = overallMastery(reviewed).pct!;
    const mixed = overallMastery([...reviewed, ...untouched]).pct!;
    // Ajouter des cartes jamais ouvertes DOIT faire baisser la maîtrise :
    // les ignorer donnerait un score qui monte en ajoutant du travail non fait.
    expect(mixed).toBeLessThan(onlyReviewed);
    expect(mixed).toBe(Math.round(onlyReviewed / 2));
  });
});

describe('taux de réussite', () => {
  it('reste null sous le seuil de fiabilité', () => {
    const logs = [log({ id: 'l1', itemId: 'c1', subjectId: 's1' })];
    expect(answerStats(logs).successRate).toBeNull();
    expect(answerStats(logs).total).toBe(1);
  });

  it('se calcule dès qu’assez de réponses existent', () => {
    const logs = [
      log({ id: 'l1', itemId: 'c1', subjectId: 's1', correct: true }),
      log({ id: 'l2', itemId: 'c1', subjectId: 's1', correct: true }),
      log({ id: 'l3', itemId: 'c1', subjectId: 's1', correct: false }),
      log({ id: 'l4', itemId: 'c1', subjectId: 's1', correct: true }),
    ];
    expect(answerStats(logs).successRate).toBeCloseTo(0.75);
  });
});

describe('temps de révision', () => {
  it('agrège par jour et laisse les jours sans activité à zéro', () => {
    const logs = [
      log({ id: 'l1', itemId: 'c1', subjectId: 's1', at: '2026-03-16T09:00:00.000Z', elapsedMs: 60_000 }),
      log({ id: 'l2', itemId: 'c1', subjectId: 's1', at: '2026-03-16T09:05:00.000Z', elapsedMs: 30_000 }),
    ];
    const buckets = bucketByDay(logs, weekDays(NOW));
    expect(buckets).toHaveLength(7);
    expect(buckets[0]!.ms).toBe(90_000);
    expect(buckets[0]!.reviews).toBe(2);
    expect(buckets[3]!.ms).toBe(0);
  });

  it('commence la semaine le lundi', () => {
    expect(dayKey(startOfWeek(NOW))).toBe(weekDays(NOW)[0]);
    expect(startOfWeek(NOW).getDay()).toBe(1);
  });

  it('n’annonce aucune variation quand la semaine précédente était vide', () => {
    const logs = [log({ id: 'l1', itemId: 'c1', subjectId: 's1', at: '2026-03-17T09:00:00.000Z' })];
    // Sans référence, « +100 % » serait une invention : on préfère ne rien dire.
    expect(studyTime(logs, NOW).weekDeltaPct).toBeNull();
  });

  it('compare à la semaine précédente quand elle existe', () => {
    const logs = [
      log({ id: 'a', itemId: 'c1', subjectId: 's1', at: '2026-03-10T09:00:00.000Z', elapsedMs: 100_000 }),
      log({ id: 'b', itemId: 'c1', subjectId: 's1', at: '2026-03-17T09:00:00.000Z', elapsedMs: 150_000 }),
    ];
    expect(studyTime(logs, NOW).weekDeltaPct).toBe(50);
  });

  it('désigne le meilleur jour réel de la semaine', () => {
    const logs = [
      log({ id: 'a', itemId: 'c1', subjectId: 's1', at: '2026-03-16T09:00:00.000Z', elapsedMs: 60_000 }),
      log({ id: 'b', itemId: 'c1', subjectId: 's1', at: '2026-03-17T09:00:00.000Z', elapsedMs: 200_000 }),
    ];
    expect(studyTime(logs, NOW).bestDay?.day).toBe('2026-03-17');
  });
});

describe('régularité', () => {
  it('ne casse pas la série parce qu’aujourd’hui n’a pas encore commencé', () => {
    const logs = [
      log({ id: 'a', itemId: 'c1', subjectId: 's1', at: '2026-03-16T09:00:00.000Z' }),
      log({ id: 'b', itemId: 'c1', subjectId: 's1', at: '2026-03-17T09:00:00.000Z' }),
    ];
    expect(computeStreak(logs, NOW).current).toBe(2);
  });

  it('tombe à zéro quand hier ET aujourd’hui sont vides', () => {
    const logs = [log({ id: 'a', itemId: 'c1', subjectId: 's1', at: '2026-03-14T09:00:00.000Z' })];
    expect(computeStreak(logs, NOW).current).toBe(0);
  });

  it('retient la plus longue série jamais atteinte', () => {
    const logs = ['2026-02-01', '2026-02-02', '2026-02-03', '2026-03-17'].map((day, i) =>
      log({ id: `l${i}`, itemId: 'c1', subjectId: 's1', at: `${day}T09:00:00.000Z` }),
    );
    const streak = computeStreak(logs, NOW);
    expect(streak.longest).toBe(3);
    expect(streak.totalActiveDays).toBe(4);
  });

  it('marque aujourd’hui et les jours à venir dans la semaine', () => {
    const week = computeStreak([], NOW).week;
    expect(week.filter((day) => day.isToday)).toHaveLength(1);
    expect(week.filter((day) => day.isFuture).length).toBeGreaterThan(0);
  });
});

describe('progression par matière et par chapitre', () => {
  const subjects = [subject('s1', 'Anatomie'), subject('s2', 'Histologie', 1)];
  const chapters = [chapter('ch1', 's1', 'Crâne'), chapter('ch2', 's1', 'Nerfs')];
  const cards = [
    card({ id: 'c1', subjectId: 's1', chapterId: 'ch1', reps: 5, interval: 60, ease: 3 }),
    card({ id: 'c2', subjectId: 's1', chapterId: 'ch2', reps: 1, interval: 1 }),
    card({ id: 'c3', subjectId: 's1', chapterId: null }),
  ];
  const logs = [
    log({ id: 'l1', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: true, elapsedMs: 20_000 }),
    log({ id: 'l2', itemId: 'c2', subjectId: 's1', chapterId: 'ch2', correct: false, elapsedMs: 40_000 }),
  ];

  it('ne liste pas les matières sans carte', () => {
    const rows = subjectProgress(subjects, chapters, cards, logs, NOW);
    expect(rows.map((row) => row.subject.id)).toEqual(['s1']);
  });

  it('compte les chapitres RÉELLEMENT étudiés, pas ceux qui existent', () => {
    const row = subjectProgress(subjects, chapters, cards, logs, NOW)[0]!;
    expect(row.chaptersTotal).toBe(2);
    expect(row.chaptersStudied).toBe(2);
    expect(row.studyMs).toBe(60_000);
  });

  it('regroupe explicitement les cartes sans chapitre au lieu de les perdre', () => {
    const rows = chapterProgress('s1', chapters, cards, logs);
    expect(rows.map((row) => row.name)).toContain('Sans chapitre');
    expect(rows.reduce((sum, row) => sum + row.cards, 0)).toBe(3);
  });

  it('laisse la maîtrise d’un chapitre jamais révisé à null', () => {
    const rows = chapterProgress('s1', chapters, cards, logs);
    const orphan = rows.find((row) => row.chapterId === null)!;
    expect(orphan.reviewedCards).toBe(0);
    expect(orphan.masteryPct).toBeNull();
  });
});

describe('points faibles', () => {
  const subjects = [subject('s1', 'Anatomie')];
  const chapters = [chapter('ch1', 's1', 'Nerfs crâniens')];
  const cards = [card({ id: 'c1', subjectId: 's1', chapterId: 'ch1' })];

  it('n’invente rien tant que le nombre de réponses est insuffisant', () => {
    const logs = [
      log({ id: 'l1', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: false }),
      log({ id: 'l2', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: false }),
    ];
    expect(weakPoints(subjects, chapters, cards, logs)).toEqual([]);
  });

  it('remonte un chapitre réellement échoué', () => {
    const logs = [
      log({ id: 'l1', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: false }),
      log({ id: 'l2', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: false }),
      log({ id: 'l3', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: true }),
    ];
    const [weak] = weakPoints(subjects, chapters, cards, logs);
    expect(weak?.title).toBe('Nerfs crâniens');
    expect(weak?.scope).toBe('chapter');
    expect(weak?.successRate).toBeCloseTo(1 / 3);
    expect(weak?.cardIds).toEqual(['c1']);
  });

  it('ignore un chapitre bien réussi', () => {
    const logs = Array.from({ length: 4 }, (_, i) =>
      log({ id: `l${i}`, itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: true }),
    );
    expect(weakPoints(subjects, chapters, cards, logs)).toEqual([]);
  });

  it('ne remonte pas une carte supprimée dont le journal subsiste', () => {
    const logs = Array.from({ length: 4 }, (_, i) =>
      log({ id: `l${i}`, itemId: 'disparue', subjectId: 's1', chapterId: 'ch1', correct: false }),
    );
    expect(weakPoints(subjects, chapters, [], logs)).toEqual([]);
  });
});

describe('activité récente', () => {
  it('regroupe par jour et par matière sans rien inventer', () => {
    const subjects = [subject('s1', 'Anatomie')];
    const logs = [
      log({ id: 'a', itemId: 'c1', subjectId: 's1', at: '2026-03-17T09:00:00.000Z', correct: true, elapsedMs: 10_000 }),
      log({ id: 'b', itemId: 'c2', subjectId: 's1', at: '2026-03-17T09:10:00.000Z', correct: false, elapsedMs: 20_000 }),
      log({ id: 'c', itemId: 'c1', subjectId: 's1', at: '2026-03-16T09:00:00.000Z', correct: true, elapsedMs: 5_000 }),
    ];
    const sessions = recentActivity(logs, subjects);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.reviews).toBe(2);
    expect(sessions[0]!.correct).toBe(1);
    expect(sessions[0]!.ms).toBe(30_000);
  });

  it('nomme honnêtement une matière supprimée', () => {
    const logs = [log({ id: 'a', itemId: 'c1', subjectId: 'disparue' })];
    expect(recentActivity(logs, [])[0]!.subjectName).toBe('Matière supprimée');
  });
});

describe('évolution de la maîtrise', () => {
  it('ne trace rien sans carte', () => {
    expect(masteryTrend([], [], 4, NOW)).toEqual([]);
  });

  it('reconstruit une progression croissante en rejouant les révisions', () => {
    const cards = [card({ id: 'c1', subjectId: 's1', createdAt: '2026-02-01T00:00:00.000Z' })];
    const logs = [
      log({ id: 'l1', itemId: 'c1', subjectId: 's1', at: '2026-02-10T09:00:00.000Z', rating: 3 }),
      log({ id: 'l2', itemId: 'c1', subjectId: 's1', at: '2026-02-20T09:00:00.000Z', rating: 3 }),
      log({ id: 'l3', itemId: 'c1', subjectId: 's1', at: '2026-03-05T09:00:00.000Z', rating: 3 }),
      log({ id: 'l4', itemId: 'c1', subjectId: 's1', at: '2026-03-16T09:00:00.000Z', rating: 3 }),
    ];
    const points = masteryTrend(cards, logs, 6, NOW);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[points.length - 1]!.masteryPct).toBeGreaterThan(points[0]!.masteryPct);
  });

  it('ignore une carte qui n’existait pas encore à la date du point', () => {
    const cards = [card({ id: 'récente', subjectId: 's1', createdAt: '2026-03-17T00:00:00.000Z' })];
    const points = masteryTrend(cards, [], 6, NOW);
    // Seuls les relevés postérieurs à la création comptent : les semaines
    // antérieures ne doivent pas afficher une carte inexistante à 0 %.
    expect(points.every((point) => point.cards === 1)).toBe(true);
    expect(points.length).toBeLessThanOrEqual(2);
  });
});

describe('prochaines révisions', () => {
  it('ramène les cartes en retard sur aujourd’hui', () => {
    const subjects = [subject('s1', 'Anatomie')];
    const cards = [
      card({ id: 'c1', subjectId: 's1', due: '2026-03-01T00:00:00.000Z' }),
      card({ id: 'c2', subjectId: 's1', due: '2026-03-19T00:00:00.000Z' }),
    ];
    const days = upcomingReviews(cards, subjects, 7, NOW);
    expect(days[0]!.label).toBe('Aujourd’hui');
    expect(days[0]!.cards).toBe(1);
    expect(days[1]!.label).toBe('Demain');
    expect(days[1]!.cards).toBe(1);
  });

  it('ignore les échéances au-delà de l’horizon', () => {
    const cards = [card({ id: 'c1', subjectId: 's1', due: '2026-06-01T00:00:00.000Z' })];
    expect(upcomingReviews(cards, [subject('s1', 'A')], 7, NOW).every((day) => day.cards === 0)).toBe(true);
  });
});

describe('objectifs', () => {
  it('mesure la semaine en cours, pas tout l’historique', () => {
    const logs = [
      log({ id: 'a', itemId: 'c1', subjectId: 's1', at: '2026-03-17T09:00:00.000Z', elapsedMs: 600_000 }),
      log({ id: 'b', itemId: 'c1', subjectId: 's1', at: '2026-03-01T09:00:00.000Z', elapsedMs: 600_000 }),
    ];
    const [timeGoal, reviewGoal] = goalProgress({ weeklyStudyMinutes: 60, weeklyReviews: 10 }, logs, NOW);
    expect(timeGoal!.current).toBe(10);
    expect(timeGoal!.pct).toBe(17);
    expect(reviewGoal!.current).toBe(1);
  });

  it('plafonne à 100 % sans jamais dépasser', () => {
    const logs = Array.from({ length: 50 }, (_, i) =>
      log({ id: `l${i}`, itemId: 'c1', subjectId: 's1', at: '2026-03-17T09:00:00.000Z' }),
    );
    expect(goalProgress({ weeklyStudyMinutes: 1, weeklyReviews: 1 }, logs, NOW)[0]!.pct).toBe(100);
  });
});

describe('formatage des durées', () => {
  it('n’affiche jamais une heure décimale', () => {
    expect(formatDuration(600_000)).toBe('10 min');
    expect(formatDuration(3_600_000)).toBe('1 h');
    expect(formatDuration(6_120_000)).toBe('1 h 42');
  });

  it('ne compte pas un temps d’étude en secondes', () => {
    // « 2 s cette semaine » après une première séance : un chiffre exact, et
    // une mesure qui se lit comme un bug.
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(2_000)).toBe('moins d’1 min');
    expect(formatDuration(45_000)).toBe('moins d’1 min');
    expect(formatDuration(59_999)).toBe('moins d’1 min');
    expect(formatDuration(60_000)).toBe('1 min');
  });
});

describe('vue complète', () => {
  const tables = {
    events: [],
    subjects: [subject('s1', 'Anatomie'), subject('s2', 'Histologie', 1)],
    chapters: [chapter('ch1', 's1', 'Crâne')],
    cards: [
      card({ id: 'c1', subjectId: 's1', chapterId: 'ch1', reps: 3, interval: 20 }),
      card({ id: 'c2', subjectId: 's2', reps: 2, interval: 10 }),
    ],
    logs: [
      log({ id: 'l1', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', elapsedMs: 30_000, at: '2026-03-17T09:00:00.000Z' }),
      log({ id: 'l2', itemId: 'c2', subjectId: 's2', elapsedMs: 90_000, at: '2026-03-17T09:00:00.000Z' }),
    ],
  };
  const goals = { weeklyStudyMinutes: 60, weeklyReviews: 10 };

  it('reste cohérente sans aucune donnée', () => {
    const view = progressView({ subjects: [], chapters: [], cards: [], logs: [], events: [] }, { goals, now: NOW });
    expect(view.hasAnySubject).toBe(false);
    expect(view.mastery.pct).toBeNull();
    expect(view.answers.successRate).toBeNull();
    expect(view.recommendation).toBeNull();
    expect(view.weak).toEqual([]);
    expect(view.activity).toEqual([]);
    expect(view.trend).toEqual([]);
    expect(view.time.weekMs).toBe(0);
    expect(view.streak.current).toBe(0);
  });

  it('restreint TOUTES les statistiques à la matière filtrée', () => {
    const all = progressView(tables, { goals, now: NOW });
    const scoped = progressView(tables, { subjectId: 's1', goals, now: NOW });
    expect(all.totalStudyMs).toBe(120_000);
    expect(scoped.totalStudyMs).toBe(30_000);
    expect(scoped.answers.total).toBe(1);
    expect(scoped.subjects.map((row) => row.subject.id)).toEqual(['s1']);
    // Le drapeau « il existe des matières » reste global : sinon filtrer une
    // matière vide afficherait l'écran « crée ta première matière ».
    expect(scoped.hasAnySubject).toBe(true);
  });

  it('supporte un gros volume sans perdre la cohérence des totaux', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      card({ id: `c${i}`, subjectId: 's1', chapterId: 'ch1', reps: 2, interval: 15 }),
    );
    const manyLogs = many.flatMap((entry, i) =>
      Array.from({ length: 5 }, (_, j) =>
        log({
          id: `l${i}-${j}`,
          itemId: entry.id,
          subjectId: 's1',
          chapterId: 'ch1',
          correct: j % 3 !== 0,
          elapsedMs: 12_000,
          at: '2026-03-17T09:00:00.000Z',
        }),
      ),
    );
    const view = progressView(
      {
        subjects: [subject('s1', 'Anatomie')],
        chapters: [chapter('ch1', 's1', 'Crâne')],
        cards: many,
        logs: manyLogs,
        events: [],
      },
      { goals, now: NOW },
    );
    expect(view.answers.total).toBe(2000);
    expect(view.totalStudyMs).toBe(2000 * 12_000);
    expect(view.activity).toHaveLength(1);
    expect(view.activity[0]!.reviews).toBe(2000);
    expect(view.weak[0]!.title).toBe('Crâne');
  });
});
