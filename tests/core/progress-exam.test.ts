import { describe, expect, it } from 'vitest';
import {
  examReadiness,
  mainRecommendation,
  nextEvaluationFor,
  priorityItems,
  readinessLevel,
  strengths,
  upcomingEvaluations,
  urgencyMultiplier,
  URGENCY_HORIZON_DAYS,
  type Evaluation,
} from '@/core/progress/exam';
import { progressView } from '@/core/progress/view';
import { DEFAULT_EASE } from '@/core/srs';
import { dayKey } from '@/lib/date';
import type { CalendarEvent, Chapter, Flashcard, ReviewLog, Subject } from '@/types';

/**
 * Ce qui est vérifié ici va au-delà de l'exactitude arithmétique :
 *  - la SUFFISANCE EXAMEN doit rester `null` tant qu'elle n'est pas mesurable,
 *    et se distinguer réellement de la simple progression ;
 *  - le CALENDRIER ne doit influencer les priorités que si une date existe
 *    vraiment, sans jamais en fabriquer une ;
 *  - la page doit rester pleinement fonctionnelle SANS aucune date connue.
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
    title: 'Contrôle',
    kind: 'midterm',
    startTime: null,
    endTime: null,
    subjectId: 's1',
    notes: '',
    done: false,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Matière solide : 6 cartes bien espacées, réparties sur deux chapitres. */
function solidSubject() {
  const chapters = [chapter('ch1', 's1', 'Crâne'), chapter('ch2', 's1', 'Nerfs')];
  const cards = [
    ...Array.from({ length: 3 }, (_, i) =>
      card({ id: `a${i}`, subjectId: 's1', chapterId: 'ch1', reps: 5, interval: 55, ease: 3 }),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      card({ id: `b${i}`, subjectId: 's1', chapterId: 'ch2', reps: 5, interval: 50, ease: 3 }),
    ),
  ];
  const logs = cards.flatMap((entry, i) =>
    Array.from({ length: 3 }, (_, j) =>
      log({
        id: `l${i}-${j}`,
        itemId: entry.id,
        subjectId: 's1',
        chapterId: entry.chapterId,
        correct: true,
        at: '2026-03-17T09:00:00.000Z',
      }),
    ),
  );
  return { chapters, cards, logs };
}

describe('niveaux de préparation', () => {
  it('applique exactement les paliers demandés', () => {
    expect(readinessLevel(20).level).toBe('insufficient');
    expect(readinessLevel(49).level).toBe('insufficient');
    expect(readinessLevel(50).level).toBe('fragile');
    expect(readinessLevel(69).level).toBe('fragile');
    expect(readinessLevel(70).level).toBe('good');
    expect(readinessLevel(84).level).toBe('good');
    expect(readinessLevel(85).level).toBe('strong');
    expect(readinessLevel(94).level).toBe('strong');
    expect(readinessLevel(95).level).toBe('mastered');
  });

  it('formule des niveaux de préparation, jamais un pronostic de réussite', () => {
    for (const pct of [10, 55, 75, 90, 99]) {
      const label = readinessLevel(pct).label.toLowerCase();
      expect(label).not.toMatch(/réussi|réussite|garanti|certain/);
    }
  });
});

describe('suffisance examen', () => {
  it('reste non mesurable sans carte révisée, et dit ce qui manque', () => {
    const cards = [card({ id: 'c1', subjectId: 's1' })];
    const result = examReadiness('s1', [], cards, [], NOW);
    expect(result.pct).toBeNull();
    expect(result.level).toBeNull();
    expect(result.missingReason).toMatch(/carte/);
  });

  it('reste non mesurable sans assez de réponses enregistrées', () => {
    const cards = Array.from({ length: 6 }, (_, i) =>
      card({ id: `c${i}`, subjectId: 's1', reps: 2, interval: 10 }),
    );
    const result = examReadiness('s1', [], cards, [log({ id: 'l1', itemId: 'c0', subjectId: 's1' })], NOW);
    expect(result.pct).toBeNull();
    expect(result.missingReason).toMatch(/réponses/);
  });

  it('publie une note explicable, décomposée en quatre signaux pondérés', () => {
    const { chapters, cards, logs } = solidSubject();
    const result = examReadiness('s1', chapters, cards, logs, NOW);
    expect(result.pct).not.toBeNull();
    expect(result.components.map((component) => component.key)).toEqual([
      'mastery',
      'reliability',
      'coverage',
      'freshness',
    ]);
    // Les deux signaux de connaissance forment une vraie moyenne.
    const base = result.components.filter((component) => component.role === 'base');
    expect(base.reduce((sum, component) => sum + component.weight, 0)).toBeCloseTo(1);
    // Les modulateurs ne peuvent que retirer : leur plancher est < 1.
    for (const component of result.components.filter((c) => c.role === 'modulator')) {
      expect(component.weight).toBeGreaterThan(0);
      expect(component.weight).toBeLessThan(1);
    }
    for (const component of result.components) {
      expect(component.pct).toBeGreaterThanOrEqual(0);
      expect(component.pct).toBeLessThanOrEqual(100);
    }
  });

  it('se distingue réellement de la progression : un programme à moitié couvert la fait chuter', () => {
    const { chapters, cards, logs } = solidSubject();
    // Même maîtrise sur les cartes travaillées, mais un chapitre entier
    // jamais ouvert : la progression moyenne bouge peu, la suffisance chute.
    const withUntouched = [
      ...cards,
      ...Array.from({ length: 3 }, (_, i) => card({ id: `z${i}`, subjectId: 's1', chapterId: 'ch3' })),
    ];
    const extendedChapters = [...chapters, chapter('ch3', 's1', 'Vaisseaux')];
    const before = examReadiness('s1', chapters, cards, logs, NOW).pct!;
    const after = examReadiness('s1', extendedChapters, withUntouched, logs, NOW).pct!;
    expect(after).toBeLessThan(before);
  });

  it('ne récompense pas le simple fait d’avoir révisé : la note reste sous la connaissance réelle', () => {
    // Cas vécu : 15 % de maîtrise mais une séance le jour même. Une version
    // additive affichait 49 % de suffisance — un chiffre rassurant pour un
    // niveau qui ne l'est pas.
    const chapters = [chapter('ch1', 's1', 'Crâne')];
    const cards = Array.from({ length: 7 }, (_, i) =>
      card({ id: `c${i}`, subjectId: 's1', chapterId: 'ch1', reps: 1, interval: 1, ease: 1.9 }),
    );
    const logs = cards.flatMap((entry, i) => [
      log({ id: `a${i}`, itemId: entry.id, subjectId: 's1', chapterId: 'ch1', correct: i % 3 !== 0 }),
    ]);
    const result = examReadiness('s1', chapters, cards, logs, NOW);
    const mastery = result.components.find((component) => component.key === 'mastery')!.pct;
    const reliability = result.components.find((component) => component.key === 'reliability')!.pct;
    // La note ne peut pas dépasser la meilleure des deux connaissances mesurées.
    expect(result.pct!).toBeLessThanOrEqual(Math.max(mastery, reliability));
  });

  it('une couverture partielle fait baisser la note même à maîtrise identique', () => {
    const chapters = [chapter('ch1', 's1', 'Crâne'), chapter('ch2', 's1', 'Nerfs')];
    const worked = Array.from({ length: 6 }, (_, i) =>
      card({ id: `w${i}`, subjectId: 's1', chapterId: 'ch1', reps: 5, interval: 55, ease: 3 }),
    );
    const logs = worked.map((entry, i) =>
      log({ id: `l${i}`, itemId: entry.id, subjectId: 's1', chapterId: 'ch1', correct: true }),
    );
    const full = examReadiness('s1', [chapters[0]!], worked, logs, NOW).pct!;
    const partial = examReadiness(
      's1',
      chapters,
      [...worked, card({ id: 'x', subjectId: 's1', chapterId: 'ch2' })],
      logs,
      NOW,
    ).pct!;
    expect(partial).toBeLessThan(full);
  });

  it('est tirée vers le bas par le chapitre le plus faible', () => {
    const { chapters, cards, logs } = solidSubject();
    const weakened = cards.map((entry) =>
      entry.chapterId === 'ch2' ? { ...entry, interval: 2, ease: 1.4, reps: 1 } : entry,
    );
    const result = examReadiness('s1', chapters, weakened, logs, NOW);
    expect(result.weakest?.name).toBe('Nerfs');
    expect(result.pct!).toBeLessThan(examReadiness('s1', chapters, cards, logs, NOW).pct!);
  });

  it('pénalise les erreurs répétées via la fiabilité', () => {
    const { chapters, cards, logs } = solidSubject();
    const relapsed = cards.map((entry) => ({ ...entry, lapses: 4 }));
    const clean = examReadiness('s1', chapters, cards, logs, NOW);
    const withLapses = examReadiness('s1', chapters, relapsed, logs, NOW);
    const reliabilityOf = (r: typeof clean) => r.components.find((c) => c.key === 'reliability')!.pct;
    expect(reliabilityOf(withLapses)).toBeLessThan(reliabilityOf(clean));
    expect(withLapses.pct!).toBeLessThan(clean.pct!);
  });

  it('baisse quand les révisions vieillissent, sans jamais tomber à zéro', () => {
    const { chapters, cards, logs } = solidSubject();
    const later = new Date('2026-06-18T14:00:00.000Z');
    const fresh = examReadiness('s1', chapters, cards, logs, NOW);
    const stale = examReadiness('s1', chapters, cards, logs, later);
    expect(stale.pct!).toBeLessThan(fresh.pct!);
    expect(stale.components.find((c) => c.key === 'freshness')!.pct).toBeGreaterThan(0);
  });

  it('reste bornée entre 0 et 100', () => {
    const { chapters, cards, logs } = solidSubject();
    const result = examReadiness('s1', chapters, cards, logs, NOW);
    expect(result.pct!).toBeGreaterThanOrEqual(0);
    expect(result.pct!).toBeLessThanOrEqual(100);
  });
});

describe('évaluations du calendrier', () => {
  const subjects = [subject('s1', 'Anatomie')];

  it('ne retient que les événements qui sont vraiment des évaluations', () => {
    const events = [
      event({ id: 'e1', day: '2026-03-25', kind: 'midterm' }),
      event({ id: 'e2', day: '2026-03-26', kind: 'course' }),
      event({ id: 'e3', day: '2026-03-27', kind: 'review' }),
      event({ id: 'e4', day: '2026-03-28', kind: 'final' }),
    ];
    expect(upcomingEvaluations(events, subjects, NOW).map((e) => e.event.id)).toEqual(['e1', 'e4']);
  });

  it('ignore le passé et les évaluations déjà faites', () => {
    const events = [
      event({ id: 'passe', day: '2026-03-01' }),
      event({ id: 'fait', day: '2026-03-25', done: true }),
      event({ id: 'ok', day: '2026-03-25' }),
    ];
    expect(upcomingEvaluations(events, subjects, NOW).map((e) => e.event.id)).toEqual(['ok']);
  });

  it('calcule le compte à rebours depuis la date réelle, jamais depuis une estimation', () => {
    const [evaluation] = upcomingEvaluations([event({ id: 'e1', day: '2026-03-23' })], subjects, NOW);
    expect(evaluation!.daysUntil).toBe(5);
    expect(evaluation!.subjectName).toBe('Anatomie');
  });

  it('classe le plus proche en premier, puis le plus lourd', () => {
    const events = [
      event({ id: 'devoir', day: '2026-03-20', kind: 'task' }),
      event({ id: 'final', day: '2026-03-20', kind: 'final' }),
      event({ id: 'loin', day: '2026-04-20', kind: 'exam' }),
    ];
    expect(upcomingEvaluations(events, subjects, NOW).map((e) => e.event.id)).toEqual([
      'final',
      'devoir',
      'loin',
    ]);
  });

  it('ne renvoie rien quand aucune date n’est enregistrée', () => {
    expect(upcomingEvaluations([], subjects, NOW)).toEqual([]);
    expect(nextEvaluationFor([], 's1')).toBeNull();
  });
});

describe('multiplicateur d’urgence', () => {
  const make = (daysUntil: number, weight = 1): Evaluation =>
    ({ daysUntil, weight }) as Evaluation;

  it('vaut exactement 1 sans aucune date connue', () => {
    expect(urgencyMultiplier(null)).toBe(1);
  });

  it('vaut 1 pour une échéance encore lointaine', () => {
    expect(urgencyMultiplier(make(URGENCY_HORIZON_DAYS + 1))).toBe(1);
  });

  it('croît à mesure que la date approche', () => {
    expect(urgencyMultiplier(make(20))).toBeLessThan(urgencyMultiplier(make(5)));
    expect(urgencyMultiplier(make(0))).toBeCloseTo(2);
  });

  it('pèse plus lourd pour un examen final que pour un devoir', () => {
    expect(urgencyMultiplier(make(3, 1.5))).toBeGreaterThan(urgencyMultiplier(make(3, 0.5)));
  });
});

describe('priorités', () => {
  const subjects = [subject('s1', 'Anatomie'), subject('s2', 'Chimie', 1)];
  const chapters = [chapter('ch1', 's1', 'Crâne'), chapter('ch2', 's1', 'Nerfs'), chapter('ch3', 's2', 'Liaisons')];
  const cards = [
    card({ id: 'fort', subjectId: 's1', chapterId: 'ch1', reps: 6, interval: 60, ease: 3.1 }),
    card({ id: 'faible', subjectId: 's1', chapterId: 'ch2', reps: 2, interval: 2, ease: 1.4 }),
    card({ id: 'chimie', subjectId: 's2', chapterId: 'ch3', reps: 3, interval: 20 }),
  ];
  const logs = [
    log({ id: 'l1', itemId: 'fort', subjectId: 's1', chapterId: 'ch1', correct: true }),
    log({ id: 'l2', itemId: 'faible', subjectId: 's1', chapterId: 'ch2', correct: false }),
    log({ id: 'l3', itemId: 'faible', subjectId: 's1', chapterId: 'ch2', correct: false }),
    log({ id: 'l4', itemId: 'chimie', subjectId: 's2', chapterId: 'ch3', correct: true }),
  ];

  it('classe le chapitre le plus faible en tête, même sans aucune date d’examen', () => {
    const items = priorityItems(subjects, chapters, cards, logs, [], NOW);
    expect(items[0]!.chapterName).toBe('Nerfs');
    expect(items[0]!.evaluation).toBeNull();
    expect(items[0]!.reasons.length).toBeGreaterThan(0);
  });

  it('n’invente pas de note pour un chapitre jamais révisé', () => {
    const untouched = [...cards, card({ id: 'neuf', subjectId: 's2', chapterId: 'ch3' })];
    const items = priorityItems(subjects, chapters, untouched, logs, [], NOW);
    for (const item of items) {
      if (item.masteryPct === null) expect(item.reasons).toContain('jamais révisé');
    }
  });

  it('remonte une matière dont l’examen approche, à faiblesse égale', () => {
    const withoutExam = priorityItems(subjects, chapters, cards, logs, [], NOW);
    const evaluations = upcomingEvaluations(
      [event({ id: 'e1', day: '2026-03-20', kind: 'final', subjectId: 's2' })],
      subjects,
      NOW,
    );
    const withExam = priorityItems(subjects, chapters, cards, logs, evaluations, NOW);

    const rank = (items: typeof withoutExam, subjectId: string) =>
      items.findIndex((item) => item.subjectId === subjectId);
    expect(rank(withExam, 's2')).toBeLessThan(rank(withoutExam, 's2'));
    expect(withExam.find((item) => item.subjectId === 's2')!.reasons[0]).toMatch(/Examen final dans 2 jours/);
  });

  it('n’attribue une évaluation qu’à la matière réellement concernée', () => {
    const evaluations = upcomingEvaluations(
      [event({ id: 'e1', day: '2026-03-20', subjectId: 's2' })],
      subjects,
      NOW,
    );
    const items = priorityItems(subjects, chapters, cards, logs, evaluations, NOW);
    expect(items.filter((item) => item.subjectId === 's1').every((item) => item.evaluation === null)).toBe(true);
  });
});

describe('recommandation principale', () => {
  it('ne recommande rien sans priorité', () => {
    expect(mainRecommendation([])).toBeNull();
  });

  it('mentionne l’échéance quand elle existe réellement', () => {
    const subjects = [subject('s1', 'Anatomie')];
    const chapters = [chapter('ch1', 's1', 'Nerfs')];
    const cards = [card({ id: 'c1', subjectId: 's1', chapterId: 'ch1', reps: 2, interval: 2, ease: 1.4 })];
    const logs = [
      log({ id: 'l1', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: false }),
      log({ id: 'l2', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: false }),
      log({ id: 'l3', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: false }),
    ];
    const evaluations = upcomingEvaluations([event({ id: 'e1', day: '2026-03-23' })], subjects, NOW);
    const reco = mainRecommendation(priorityItems(subjects, chapters, cards, logs, evaluations, NOW))!;
    expect(reco.title).toContain('Nerfs');
    expect(reco.body).toContain('5 jours');
    expect(reco.cardIds).toContain('c1');
  });

  it('reste utile et silencieuse sur les dates quand aucune n’existe', () => {
    const subjects = [subject('s1', 'Anatomie')];
    const chapters = [chapter('ch1', 's1', 'Nerfs')];
    const cards = [card({ id: 'c1', subjectId: 's1', chapterId: 'ch1', reps: 2, interval: 2, ease: 1.4 })];
    const logs = [log({ id: 'l1', itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: false })];
    const reco = mainRecommendation(priorityItems(subjects, chapters, cards, logs, [], NOW))!;
    expect(reco.body).not.toMatch(/jour[s]? \./);
    expect(reco.body).not.toMatch(/examen|contrôle/i);
    expect(reco.evaluation).toBeNull();
  });
});

describe('points forts', () => {
  it('ne retient que des chapitres réellement solides', () => {
    const { chapters, cards, logs } = solidSubject();
    const items = strengths([subject('s1', 'Anatomie')], chapters, cards, logs);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.masteryPct).toBeGreaterThanOrEqual(80);
  });

  it('ne remplit pas la liste avec le « moins mauvais »', () => {
    const chapters = [chapter('ch1', 's1', 'Crâne')];
    const cards = [card({ id: 'c1', subjectId: 's1', chapterId: 'ch1', reps: 2, interval: 5 })];
    const logs = [log({ id: 'l1', itemId: 'c1', subjectId: 's1', chapterId: 'ch1' })];
    expect(strengths([subject('s1', 'Anatomie')], chapters, cards, logs)).toEqual([]);
  });
});

describe('vue complète avec calendrier', () => {
  const goals = { weeklyStudyMinutes: 60, weeklyReviews: 10 };

  it('fonctionne intégralement sans aucune date d’examen', () => {
    const { chapters, cards, logs } = solidSubject();
    const view = progressView(
      { subjects: [subject('s1', 'Anatomie')], chapters, cards, logs, events: [] },
      { goals, now: NOW },
    );
    expect(view.evaluations).toEqual([]);
    expect(view.focus).toBeNull();
    expect(view.globalReadiness).not.toBeNull();
    expect(view.priorities.length).toBeGreaterThan(0);
    expect(view.recommendation).not.toBeNull();
  });

  it('détecte une date ajoutée au calendrier et met la matière en focus', () => {
    const { chapters, cards, logs } = solidSubject();
    const subjects = [subject('s1', 'Anatomie')];
    const before = progressView({ subjects, chapters, cards, logs, events: [] }, { goals, now: NOW });
    const after = progressView(
      { subjects, chapters, cards, logs, events: [event({ id: 'e1', day: '2026-03-23', kind: 'exam' })] },
      { goals, now: NOW },
    );
    expect(before.focus).toBeNull();
    expect(after.focus?.subject.id).toBe('s1');
    expect(after.focus?.evaluation?.daysUntil).toBe(5);
    // La suffisance ne change pas : c'est une mesure du niveau, pas du délai.
    expect(after.globalReadiness!.pct).toBe(before.globalReadiness!.pct);
  });

  it('n’expose aucune évaluation quand le calendrier est vide', () => {
    const view = progressView(
      { subjects: [], chapters: [], cards: [], logs: [], events: [] },
      { goals, now: NOW },
    );
    expect(view.evaluations).toEqual([]);
    expect(view.globalReadiness).toBeNull();
    expect(view.recommendation).toBeNull();
    expect(view.strengths).toEqual([]);
  });

  it('restreint aussi les évaluations à la matière filtrée', () => {
    const { chapters, cards, logs } = solidSubject();
    const subjects = [subject('s1', 'Anatomie'), subject('s2', 'Chimie', 1)];
    const events = [
      event({ id: 'e1', day: '2026-03-23', subjectId: 's1' }),
      event({ id: 'e2', day: '2026-03-24', subjectId: 's2' }),
    ];
    const scoped = progressView({ subjects, chapters, cards, logs, events }, { subjectId: 's1', goals, now: NOW });
    expect(scoped.evaluations.map((e) => e.event.id)).toEqual(['e1']);
  });
});
