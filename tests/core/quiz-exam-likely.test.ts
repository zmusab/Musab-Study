import { describe, it, expect } from 'vitest';
import { buildQuiz, scopeCards, type QuizTables } from '@/core/quiz';
import {
  chapterSignalsFromAnalyses,
  rankForExamLikely,
  scoreExamLikelihood,
  weaknessScore,
} from '@/core/quiz/examLikely';
import type { Evaluation } from '@/core/progress/exam';
import { DEFAULT_EASE } from '@/core/srs';
import { dayKey } from '@/lib/date';
import type { CalendarEvent, Chapter, ChapterAnalysis, Flashcard, Notion, ReviewLog, Subject } from '@/types';

/**
 * « EXAMEN PROBABLE » — une ESTIMATION, jamais une prédiction.
 *
 * Le principe testé partout ici : le badge de probabilité (🟢🟡🟠) ne dépend
 * QUE de signaux réellement enregistrés — importance déclarée d'une carte,
 * analyse IA déjà validée d'un chapitre, examen réellement au calendrier —
 * jamais de la performance personnelle de l'étudiant (qui influence
 * uniquement l'ORDRE des questions, jamais le badge affiché). Rien n'est
 * inventé quand un signal manque : le score reste bas, il n'est jamais
 * compensé par une supposition.
 */

const NOW = new Date('2026-03-18T08:00:00.000Z');

const subject = (id: string, name: string): Subject => ({
  id,
  name,
  color: '#888',
  createdAt: '2026-01-01T00:00:00.000Z',
  position: 0,
});

const chapter = (id: string, subjectId: string, name: string): Chapter => ({
  id,
  subjectId,
  name,
  createdAt: '2026-01-01T00:00:00.000Z',
  position: 0,
});

function card(overrides: Partial<Flashcard> & { id: string; subjectId: string }): Flashcard {
  return {
    chapterId: null,
    question: `Question ${overrides.id}`,
    answer: `Réponse ${overrides.id}`,
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
  return {
    chapterId: null,
    itemKind: 'card',
    at: '2026-03-10T09:00:00.000Z',
    day: '2026-03-10',
    correct: true,
    rating: 2,
    confidence: 'medium',
    elapsedMs: 4000,
    ...overrides,
  };
}

const concept = (overrides: Partial<Notion> & { id: string }): Notion => ({
  label: `Notion ${overrides.id}`,
  importance: 2,
  isPitfall: false,
  citations: [],
  ...overrides,
});

const citation = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    chunkId: `chk${i}`,
    documentId: 'doc1',
    documentName: 'Cours',
    chapterId: 'ch1',
    chapterName: 'Nerfs crâniens',
    subjectName: 'Anatomie',
    excerpt: 'extrait',
    page: null,
  }));

const analysis = (overrides: Partial<ChapterAnalysis> & { id: string; chapterId: string; subjectId: string }): ChapterAnalysis => ({
  notions: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/** Événement d'examen réel, à N jours de NOW. */
function examEvent(id: string, subjectId: string, daysFromNow: number): CalendarEvent {
  const day = dayKey(new Date(NOW.getTime() + daysFromNow * 86_400_000));
  return {
    id,
    title: 'Examen',
    kind: 'exam',
    day,
    startTime: null,
    endTime: null,
    subjectId,
    notes: '',
    done: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const subjects: Subject[] = [subject('s1', 'Anatomie')];
const chapters: Chapter[] = [chapter('ch1', 's1', 'Nerfs crâniens'), chapter('ch2', 's1', 'Ostéologie')];

describe('chapterSignalsFromAnalyses — agrégats réels d’une analyse IA déjà enregistrée', () => {
  it('un chapitre sans analyse n’a simplement pas d’entrée', () => {
    const signals = chapterSignalsFromAnalyses([]);
    expect(signals.has('ch1')).toBe(false);
  });

  it('agrège l’importance maximale, la part de pièges et la répétition moyenne', () => {
    const a = analysis({
      id: 'a1',
      chapterId: 'ch1',
      subjectId: 's1',
      notions: [
        concept({ id: 'n1', importance: 3, isPitfall: true, citations: citation(2) }),
        concept({ id: 'n2', importance: 1, isPitfall: false, citations: citation(1) }),
      ],
    });
    const signals = chapterSignalsFromAnalyses([a]);
    const signal = signals.get('ch1')!;
    expect(signal.maxImportance).toBe(3);
    expect(signal.pitfallShare).toBe(0.5);
    expect(signal.avgCitations).toBe(1.5);
    expect(signal.notionCount).toBe(2);
  });

  it('un chapitre analysé sans la moindre notion n’a pas d’entrée non plus', () => {
    const a = analysis({ id: 'a2', chapterId: 'ch2', subjectId: 's1', notions: [] });
    expect(chapterSignalsFromAnalyses([a]).has('ch2')).toBe(false);
  });
});

describe('scoreExamLikelihood — jamais une prédiction, toujours justifié par un fait réel', () => {
  it('une carte marquée « tombe à l’examen », sans autre signal, est déjà en probabilité élevée', () => {
    const c = card({ id: 'c1', subjectId: 's1', importance: 3 });
    const { score, info } = scoreExamLikelihood(c, 'Nerfs crâniens', undefined, null);
    expect(score).toBeGreaterThanOrEqual(0.7);
    expect(info.level).toBe('high');
    expect(info.reasons.some((r) => r.includes('tombe à l’examen'))).toBe(true);
    expect(info.chapterName).toBe('Nerfs crâniens');
  });

  it('sans aucun signal, la probabilité reste faible et le dit honnêtement', () => {
    const c = card({ id: 'c2', subjectId: 's1', importance: 1 });
    const { info } = scoreExamLikelihood(c, null, undefined, null);
    expect(info.level).toBe('low');
    expect(info.reasons[0]).toMatch(/aucune analyse de cours ni examen proche/);
  });

  it('jamais la phrase « tombera à l’examen » ou toute formulation de certitude', () => {
    const c = card({ id: 'c3', subjectId: 's1', importance: 3 });
    const signal = { maxImportance: 3 as const, pitfallShare: 1, avgCitations: 3, notionCount: 2 };
    const evaluation: Evaluation = {
      event: examEvent('e1', 's1', 2),
      label: 'Examen',
      subjectId: 's1',
      subjectName: 'Anatomie',
      day: dayKey(new Date(NOW.getTime() + 2 * 86_400_000)),
      daysUntil: 2,
      weight: 1,
    };
    const { info } = scoreExamLikelihood(c, 'Nerfs crâniens', signal, evaluation);
    for (const reason of info.reasons) {
      expect(reason).not.toMatch(/tombera|va tomber|certain|garanti/i);
    }
  });

  it('une analyse IA du chapitre relève le score même si la carte elle-même n’est pas marquée importante', () => {
    const c = card({ id: 'c4', subjectId: 's1', importance: 2 });
    const signal = { maxImportance: 3 as const, pitfallShare: 0, avgCitations: 1, notionCount: 1 };
    const withSignal = scoreExamLikelihood(c, 'Nerfs crâniens', signal, null);
    const withoutSignal = scoreExamLikelihood(c, 'Nerfs crâniens', undefined, null);
    expect(withSignal.score).toBeGreaterThan(withoutSignal.score);
    expect(withSignal.info.reasons.some((r) => r.includes('essentielle'))).toBe(true);
  });

  it('un piège fréquent identifié dans le cours est cité comme raison réelle', () => {
    const c = card({ id: 'c5', subjectId: 's1' });
    const signal = { maxImportance: 2 as const, pitfallShare: 1, avgCitations: 1, notionCount: 1 };
    const { info } = scoreExamLikelihood(c, 'Nerfs crâniens', signal, null);
    expect(info.reasons.some((r) => r.includes('erreur fréquente'))).toBe(true);
  });

  it('une notion répétée à plusieurs endroits du cours est signalée comme telle', () => {
    const c = card({ id: 'c6', subjectId: 's1' });
    const repeated = { maxImportance: 2 as const, pitfallShare: 0, avgCitations: 2, notionCount: 1 };
    const once = { maxImportance: 2 as const, pitfallShare: 0, avgCitations: 1, notionCount: 1 };
    expect(scoreExamLikelihood(c, null, repeated, null).info.reasons.some((r) => r.includes('plusieurs endroits'))).toBe(
      true,
    );
    expect(scoreExamLikelihood(c, null, once, null).info.reasons.some((r) => r.includes('plusieurs endroits'))).toBe(
      false,
    );
  });

  it('la proximité d’un examen ne relève le score QUE pour une notion déjà fondamentale', () => {
    const near: Evaluation = {
      event: examEvent('e2', 's1', 3),
      label: 'Examen',
      subjectId: 's1',
      subjectName: 'Anatomie',
      day: dayKey(new Date(NOW.getTime() + 3 * 86_400_000)),
      daysUntil: 3,
      weight: 1,
    };
    const fundamental = card({ id: 'c7', subjectId: 's1', importance: 3 });
    const secondary = card({ id: 'c8', subjectId: 's1', importance: 1 });

    const fundamentalNear = scoreExamLikelihood(fundamental, null, undefined, near);
    const fundamentalFar = scoreExamLikelihood(fundamental, null, undefined, null);
    expect(fundamentalNear.score).toBeGreaterThan(fundamentalFar.score);
    expect(fundamentalNear.info.reasons.some((r) => r.includes('Examen dans'))).toBe(true);

    // Une notion secondaire ne devient pas « plus probable » juste parce
    // qu'un examen approche — la proximité seule ne justifie rien.
    const secondaryNear = scoreExamLikelihood(secondary, null, undefined, near);
    const secondaryFar = scoreExamLikelihood(secondary, null, undefined, null);
    expect(secondaryNear.score).toBe(secondaryFar.score);
    expect(secondaryNear.info.reasons.some((r) => r.includes('Examen dans'))).toBe(false);
  });

  it('un examen trop lointain n’avance aucun bonus, même pour une notion fondamentale', () => {
    const far: Evaluation = {
      event: examEvent('e3', 's1', 60),
      label: 'Examen',
      subjectId: 's1',
      subjectName: 'Anatomie',
      day: dayKey(new Date(NOW.getTime() + 60 * 86_400_000)),
      daysUntil: 60,
      weight: 1,
    };
    const c = card({ id: 'c9', subjectId: 's1', importance: 3 });
    const withFar = scoreExamLikelihood(c, null, undefined, far);
    const withNone = scoreExamLikelihood(c, null, undefined, null);
    expect(withFar.score).toBe(withNone.score);
  });

  it('le score ne dépasse jamais 1 même en combinant tous les signaux', () => {
    const near: Evaluation = {
      event: examEvent('e4', 's1', 1),
      label: 'Examen',
      subjectId: 's1',
      subjectName: 'Anatomie',
      day: dayKey(new Date(NOW.getTime() + 86_400_000)),
      daysUntil: 1,
      weight: 1,
    };
    const c = card({ id: 'c10', subjectId: 's1', importance: 3 });
    const signal = { maxImportance: 3 as const, pitfallShare: 1, avgCitations: 5, notionCount: 3 };
    const { score } = scoreExamLikelihood(c, 'Nerfs crâniens', signal, near);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('weaknessScore — une lacune mesurée, jamais supposée', () => {
  it('une carte jamais révisée reste neutre, ni forte ni faible', () => {
    const c = card({ id: 'w1', subjectId: 's1', reps: 0 });
    expect(weaknessScore(c, [])).toBe(0.5);
  });

  it('un taux de réussite réellement mesuré (assez de réponses) détermine la lacune', () => {
    const c = card({ id: 'w2', subjectId: 's1' });
    const logs: ReviewLog[] = Array.from({ length: 4 }, (_, i) =>
      log({ id: `l${i}`, itemId: 'w2', subjectId: 's1', correct: i === 0 }),
    );
    expect(weaknessScore(c, logs)).toBeCloseTo(0.75, 5);
  });

  it('trop peu de réponses pour un taux fiable : neutre, jamais un taux inventé', () => {
    const c = card({ id: 'w3', subjectId: 's1', reps: 1 });
    const logs: ReviewLog[] = [log({ id: 'l0', itemId: 'w3', subjectId: 's1', correct: false })];
    expect(weaknessScore(c, logs)).toBe(0.3);
  });
});

describe('rankForExamLikely — la personnalisation change l’ordre, jamais le badge', () => {
  it('classe les cartes par probabilité de contenu ET lacune réelle combinées', () => {
    const strongContent = card({ id: 'r1', subjectId: 's1', importance: 3 }); // base 0.85, pas de log → faiblesse 0.5
    const weakContentButStruggled = card({ id: 'r2', subjectId: 's1', importance: 1 }); // base 0.2
    const logs: ReviewLog[] = Array.from({ length: 4 }, (_, i) =>
      log({ id: `l${i}`, itemId: 'r2', subjectId: 's1', correct: false }),
    ); // faiblesse 1
    const { ordered } = rankForExamLikely(
      [weakContentButStruggled, strongContent],
      new Map(),
      () => null,
      logs,
      null,
    );
    expect(ordered[0]!.id).toBe('r1');
  });

  it('deux étudiants aux lacunes différentes reçoivent un ORDRE différent, sans changer le score de contenu', () => {
    const x = card({ id: 'p1', subjectId: 's1', importance: 2 });
    const y = card({ id: 'p2', subjectId: 's1', importance: 2 });

    const noHistory = rankForExamLikely([x, y], new Map(), () => null, [], null);
    // Même score de contenu, aucune lacune mesurée : ordre stable, insertion.
    expect(noHistory.ordered.map((c) => c.id)).toEqual(['p1', 'p2']);
    expect(noHistory.infoByCardId.get('p1')!.score).toBe(noHistory.infoByCardId.get('p2')!.score);

    // Un étudiant qui échoue systématiquement sur p2 : p2 doit passer devant,
    // sans que son badge de probabilité (le score de CONTENU) ne change.
    const struggledOnY: ReviewLog[] = Array.from({ length: 4 }, (_, i) =>
      log({ id: `ly${i}`, itemId: 'p2', subjectId: 's1', correct: false }),
    );
    const withHistory = rankForExamLikely([x, y], new Map(), () => null, struggledOnY, null);
    expect(withHistory.ordered[0]!.id).toBe('p2');
    expect(withHistory.infoByCardId.get('p2')!.score).toBe(noHistory.infoByCardId.get('p2')!.score);
  });
});

describe('buildQuiz — scope "exam-likely", une ESTIMATION jamais une certitude', () => {
  const richCards: Flashcard[] = [
    card({ id: 'c1', subjectId: 's1', chapterId: 'ch1', importance: 3 }),
    card({ id: 'c2', subjectId: 's1', chapterId: 'ch1', importance: 2 }),
    card({ id: 'c3', subjectId: 's1', chapterId: 'ch1', importance: 1 }),
    card({ id: 'c4', subjectId: 's1', chapterId: 'ch2', importance: 2 }),
    card({ id: 'c5', subjectId: 's1', chapterId: 'ch2', importance: 1 }),
  ];
  const tables = (overrides: Partial<QuizTables> = {}): QuizTables => ({
    subjects,
    chapters,
    cards: richCards,
    logs: [],
    events: [],
    chapterAnalyses: [],
    ...overrides,
  });

  it('sélectionne uniquement les cartes du ou des chapitres choisis', () => {
    const result = scopeCards(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: ['ch1'], evaluationEventId: null },
      tables(),
    );
    expect(result.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('chapterIds vide couvre toute la matière', () => {
    const result = scopeCards(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: [], evaluationEventId: null },
      tables(),
    );
    expect(result).toHaveLength(5);
  });

  it('chaque question porte une estimation réelle (niveau + justification + chapitre réel)', () => {
    const result = buildQuiz(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: [], evaluationEventId: null },
      tables(),
      { count: 5, difficulty: 'mixed', format: 'mixed', now: NOW, random: () => 0.42 },
    );
    expect(result.blocked).toBeNull();
    expect(result.questions.length).toBeGreaterThan(0);
    for (const question of result.questions) {
      expect(question.examLikelihood).not.toBeNull();
      expect(['high', 'medium', 'low']).toContain(question.examLikelihood!.level);
      expect(question.examLikelihood!.reasons.length).toBeGreaterThan(0);
      // Le chapitre affiché est un chapitre réellement enregistré.
      expect(['Nerfs crâniens', 'Ostéologie', null]).toContain(question.examLikelihood!.chapterName);
    }
  });

  it('la carte marquée « tombe à l’examen » (c1) arrive en tête, en probabilité élevée', () => {
    const result = buildQuiz(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: [], evaluationEventId: null },
      tables(),
      { count: 5, difficulty: 'mixed', format: 'vf', now: NOW, random: () => 0.9 },
    );
    const first = result.questions[0]!;
    expect(first.cardId).toBe('c1');
    expect(first.examLikelihood!.level).toBe('high');
  });

  it('un chapitre choisi sans la moindre carte se bloque honnêtement plutôt que de proposer un quiz vide', () => {
    const result = buildQuiz(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: ['ch-vide'], evaluationEventId: null },
      tables(),
      { count: 5, difficulty: 'mixed', now: NOW },
    );
    expect(result.questions).toEqual([]);
    expect(result.blocked).toMatch(/estimer/);
  });

  it('un examen réel enregistré au calendrier renforce l’estimation des notions déjà fondamentales', () => {
    const soonEvent = examEvent('exam1', 's1', 2);
    const withExam = buildQuiz(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: ['ch1'], evaluationEventId: 'exam1' },
      tables({ events: [soonEvent] }),
      { count: 1, difficulty: 'mixed', format: 'vf', now: NOW, random: () => 0.9 },
    );
    const withoutExam = buildQuiz(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: ['ch1'], evaluationEventId: null },
      tables(),
      { count: 1, difficulty: 'mixed', format: 'vf', now: NOW, random: () => 0.9 },
    );
    // La question la plus probable (c1, déjà fondamentale) voit sa
    // justification citer l'examen quand il est réellement sélectionné.
    expect(withExam.questions[0]!.examLikelihood!.reasons.some((r) => r.includes('Examen dans'))).toBe(true);
    expect(withoutExam.questions[0]!.examLikelihood!.reasons.some((r) => r.includes('Examen dans'))).toBe(false);
  });

  it('les analyses IA déjà enregistrées d’un chapitre renforcent son estimation, sans jamais rien inventer', () => {
    const chapterAnalyses: ChapterAnalysis[] = [
      analysis({
        id: 'a1',
        subjectId: 's1',
        chapterId: 'ch2',
        notions: [concept({ id: 'n1', importance: 3, isPitfall: true, citations: citation(2) })],
      }),
    ];
    const result = buildQuiz(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: ['ch2'], evaluationEventId: null },
      tables({ chapterAnalyses }),
      { count: 2, difficulty: 'mixed', format: 'vf', now: NOW, random: () => 0.9 },
    );
    // c4 (ch2, importance carte 2 seule) doit être renforcée par l'analyse du chapitre.
    const c4 = result.questions.find((q) => q.cardId === 'c4')!;
    expect(c4.examLikelihood!.reasons.some((r) => r.includes('essentielle') || r.includes('erreur fréquente'))).toBe(
      true,
    );
  });

  it('les formats QCM et Vrai/Faux fonctionnent normalement sur ce scope, comme sur tout autre', () => {
    const asQcm = buildQuiz(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: [], evaluationEventId: null },
      tables(),
      { count: 5, difficulty: 'mixed', format: 'qcm', now: NOW, random: () => 0.5 },
    );
    for (const q of asQcm.questions) expect(q.options).toHaveLength(4);

    const asVf = buildQuiz(
      { kind: 'exam-likely', subjectId: 's1', chapterIds: [], evaluationEventId: null },
      tables(),
      { count: 5, difficulty: 'mixed', format: 'vf', now: NOW, random: () => 0.5 },
    );
    for (const q of asVf.questions) expect(q.options).toEqual(['Vrai', 'Faux']);
  });
});

describe('buildQuiz — scope "cards", pour rejouer un ensemble précis (ex. « Refaire les questions importantes »)', () => {
  const richCards: Flashcard[] = [
    card({ id: 'c1', subjectId: 's1', chapterId: 'ch1' }),
    card({ id: 'c2', subjectId: 's1', chapterId: 'ch1' }),
    card({ id: 'c3', subjectId: 's1', chapterId: 'ch2' }),
  ];
  const tables: QuizTables = { subjects, chapters, cards: richCards, logs: [] };

  it('ne construit des questions que sur les cartes précisément désignées', () => {
    const result = buildQuiz(
      { kind: 'cards', cardIds: ['c1', 'c3'] },
      tables,
      { count: 5, difficulty: 'mixed', format: 'vf', now: NOW, random: () => 0.9 },
    );
    expect(result.questions.map((q) => q.cardId).sort()).toEqual(['c1', 'c3']);
  });

  it('n’a pas d’estimation « examen probable » — ce n’est pas ce scope', () => {
    const result = buildQuiz(
      { kind: 'cards', cardIds: ['c1'] },
      tables,
      { count: 1, difficulty: 'mixed', format: 'vf', now: NOW },
    );
    expect(result.questions[0]!.examLikelihood).toBeNull();
  });
});

/**
 * LE CLASSEMENT S'APPLIQUE MAINTENANT AUSSI AUX PÉRIMÈTRES ORDINAIRES.
 *
 * Reproche de l'utilisateur, mot pour mot : « le quiz pose les questions
 * aléatoirement alors que j'aurais bien voulu qu'il les pose réellement en
 * analysant mon cours avec les questions les plus probables à l'examen ».
 * C'était littéralement le cas — `priorityOrder` renvoyait `shuffle(pool)`
 * pour tout sauf « Avant un examen » et « Mes points faibles », donc y compris
 * pour « Une matière », le périmètre proposé par défaut.
 */
describe('classement par probabilité d’examen sur un périmètre ordinaire', () => {
  const SUBJECT = subject('s1', 'Anatomie');
  const CH_FORT = chapter('c-fort', 's1', 'Chapitre analysé, notions capitales');
  const CH_FAIBLE = chapter('c-faible', 's1', 'Chapitre sans analyse');

  // Réutilise les fabriques du fichier plutôt que de recomposer un objet à la
  // main : elles portent déjà les champs obligatoires du modèle.
  const analyses: ChapterAnalysis[] = [
    analysis({
      id: 'a-fort',
      subjectId: 's1',
      chapterId: 'c-fort',
      notions: [concept({ id: 'n-capitale', importance: 3, isPitfall: true, citations: citation(2) })],
    }),
  ];

  const cards: Flashcard[] = [
    card({ id: 'banale-1', subjectId: 's1', chapterId: 'c-faible', importance: 1 }),
    card({ id: 'banale-2', subjectId: 's1', chapterId: 'c-faible', importance: 1 }),
    card({ id: 'banale-3', subjectId: 's1', chapterId: 'c-faible', importance: 1 }),
    card({ id: 'capitale', subjectId: 's1', chapterId: 'c-fort', importance: 3 }),
  ];

  const tables: QuizTables = {
    cards,
    subjects: [SUBJECT],
    chapters: [CH_FORT, CH_FAIBLE],
    logs: [] as ReviewLog[],
    chapterAnalyses: analyses,
    events: [] as CalendarEvent[],
  };

  it('met la carte du chapitre analysé comme capitale en tête, sans qu’on choisisse « Examen probable »', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      tables,
      { count: 4, difficulty: 'mixed', format: 'qcm', now: NOW, random: () => 0.5 },
    );
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions[0]!.cardId).toBe('capitale');
  });

  it('et la probabilité estimée est affichée sur ce périmètre aussi', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      tables,
      { count: 4, difficulty: 'mixed', format: 'qcm', now: NOW, random: () => 0.5 },
    );
    expect(result.questions[0]!.examLikelihood).not.toBeNull();
  });

  it('une liste de cartes choisie à la main n’est PAS reclassée ni jugée', () => {
    /*
     * « Rejouer mes erreurs » est une sélection explicite : l'utilisateur a
     * déjà décidé quelles cartes revoir. Y coller un badge de probabilité
     * ajouterait un jugement là où il n'a rien demandé.
     */
    const result = buildQuiz(
      { kind: 'cards', cardIds: ['banale-1', 'capitale'] },
      tables,
      { count: 2, difficulty: 'mixed', format: 'qcm', now: NOW, random: () => 0.5 },
    );
    expect(result.questions.every((question) => question.examLikelihood === null)).toBe(true);
  });
});
