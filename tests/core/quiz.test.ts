import { describe, it, expect } from 'vitest';
import {
  buildQuiz,
  scopeCards,
  summarizeQuiz,
  type QuizAnswerRecord,
  type QuizTables,
} from '@/core/quiz';
import { DEFAULT_EASE } from '@/core/srs';
import type { Chapter, Flashcard, ReviewLog, Subject } from '@/types';

/**
 * Le principe testé partout ici : un quiz ne montre et ne journalise que des
 * données RÉELLES. Une bonne/mauvaise réponse de distracteur, un chapitre,
 * une matière — tout doit se retrouver, inchangé, dans les cartes fournies en
 * entrée. Rien n'est inventé quand les données manquent : le quiz se bloque
 * et le dit plutôt que de simuler des options.
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
  const at = overrides.at ?? '2026-03-10T09:00:00.000Z';
  return {
    chapterId: null,
    itemKind: 'card',
    at,
    day: '2026-03-10',
    correct: true,
    rating: 2,
    confidence: 'medium',
    elapsedMs: 4000,
    ...overrides,
  };
}

/** Générateur déterministe pour des tests reproductibles. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const subjects: Subject[] = [subject('s1', 'Anatomie'), subject('s2', 'Physiologie')];
const chapters: Chapter[] = [
  chapter('ch1', 's1', 'Nerfs crâniens'),
  chapter('ch2', 's1', 'Ostéologie'),
];

/** Six cartes aux réponses toutes distinctes : assez pour bâtir des QCM. */
const richCards: Flashcard[] = [
  card({ id: 'c1', subjectId: 's1', chapterId: 'ch1', difficulty: 1 }),
  card({ id: 'c2', subjectId: 's1', chapterId: 'ch1', difficulty: 2 }),
  card({ id: 'c3', subjectId: 's1', chapterId: 'ch1', difficulty: 3 }),
  card({ id: 'c4', subjectId: 's1', chapterId: 'ch2', difficulty: 1 }),
  card({ id: 'c5', subjectId: 's1', chapterId: 'ch2', difficulty: 2 }),
  card({ id: 'c6', subjectId: 's1', chapterId: 'ch2', difficulty: 3 }),
];

const emptyTables = (cards: Flashcard[] = richCards, logs: ReviewLog[] = []): QuizTables => ({
  subjects,
  chapters,
  cards,
  logs,
});

describe('scopeCards — le vivier, sans rien inventer', () => {
  it('filtre par matière', () => {
    const result = scopeCards({ kind: 'subject', subjectId: 's1' }, emptyTables());
    expect(result).toHaveLength(6);
    expect(result.every((c) => c.subjectId === 's1')).toBe(true);
  });

  it('filtre par chapitre', () => {
    const result = scopeCards({ kind: 'chapter', subjectId: 's1', chapterId: 'ch1' }, emptyTables());
    expect(result.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('filtre par plusieurs matières', () => {
    const cards = [...richCards, card({ id: 'p1', subjectId: 's2' })];
    const result = scopeCards({ kind: 'subjects', subjectIds: ['s2'] }, emptyTables(cards));
    expect(result.map((c) => c.id)).toEqual(['p1']);
  });

  it('cartes dues : uniquement celles dont l’échéance est passée', () => {
    const cards = [
      card({ id: 'due1', subjectId: 's1', due: '2026-03-01T00:00:00.000Z' }),
      card({ id: 'future', subjectId: 's1', due: '2026-04-01T00:00:00.000Z' }),
    ];
    const result = scopeCards({ kind: 'due' }, emptyTables(cards), NOW);
    expect(result.map((c) => c.id)).toEqual(['due1']);
  });

  it('points faibles : uniquement les cartes des chapitres mesurés comme faibles', () => {
    // ch1 : 5 réponses, 20% de réussite → faible. ch2 : aucune réponse.
    const logs: ReviewLog[] = Array.from({ length: 5 }, (_, i) =>
      log({ id: `l${i}`, itemId: 'c1', subjectId: 's1', chapterId: 'ch1', correct: i === 0 }),
    );
    const result = scopeCards({ kind: 'weak' }, emptyTables(richCards, logs));
    expect(result.every((c) => c.chapterId === 'ch1')).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('sans point faible mesuré, le vivier est vide plutôt qu’inventé', () => {
    const result = scopeCards({ kind: 'weak' }, emptyTables(richCards, []));
    expect(result).toEqual([]);
  });
});

describe('buildQuiz — construction de QCM réels', () => {
  it('construit le nombre de questions demandé quand les données suffisent', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(),
      { count: 4, difficulty: 'mixed', now: NOW, random: seeded(1) },
    );
    expect(result.blocked).toBeNull();
    expect(result.questions).toHaveLength(4);
  });

  it('chaque question a exactement 4 options, dont la bonne réponse une seule fois', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(),
      { count: 6, difficulty: 'mixed', now: NOW, random: seeded(2) },
    );
    for (const question of result.questions) {
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options.map((o) => o.toLowerCase())).size).toBe(4);
      expect(question.options[question.correctIndex]).toBe(
        richCards.find((c) => c.id === question.cardId)!.answer,
      );
    }
  });

  it('ne montre et ne journalise que des réponses réellement présentes dans les cartes', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(),
      { count: 6, difficulty: 'mixed', now: NOW, random: seeded(3) },
    );
    const realAnswers = new Set(richCards.map((c) => c.answer));
    for (const question of result.questions) {
      for (const option of question.options) expect(realAnswers.has(option)).toBe(true);
    }
  });

  it('filtre par difficulté quand assez de cartes portent ce niveau', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(),
      { count: 2, difficulty: 'easy', now: NOW, random: seeded(4) },
    );
    expect(result.blocked).toBeNull();
    for (const question of result.questions) expect(question.difficulty).toBe(1);
  });

  it('élargit la difficulté plutôt que de bloquer un quiz possible', () => {
    // Une seule carte « facile » sur ce périmètre restreint : 4 demandées.
    const cards = [card({ id: 'x1', subjectId: 's1', chapterId: 'ch1', difficulty: 1 })];
    const result = buildQuiz(
      { kind: 'chapter', subjectId: 's1', chapterId: 'ch1' },
      emptyTables([...cards, ...richCards]),
      { count: 4, difficulty: 'easy', now: NOW, random: seeded(5) },
    );
    // Pas assez de cartes "faciles" seules (1), mais le chapitre en contient
    // d'autres au total : le quiz s'élargit au lieu de rester bloqué à 1.
    expect(result.blocked).toBeNull();
    expect(result.questions.length).toBeGreaterThan(1);
  });

  it('se bloque honnêtement quand le périmètre ne contient aucune carte', () => {
    const result = buildQuiz(
      { kind: 'chapter', subjectId: 's1', chapterId: 'ch2' },
      emptyTables([]),
      { count: 5, difficulty: 'mixed', now: NOW },
    );
    expect(result.questions).toEqual([]);
    expect(result.blocked).not.toBeNull();
  });

  it('se bloque quand aucune réponse distincte ne permet un choix multiple', () => {
    // Une seule carte dans tout le périmètre : aucun distracteur possible.
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables([card({ id: 'lonely', subjectId: 's1' })]),
      { count: 3, difficulty: 'mixed', now: NOW },
    );
    expect(result.questions).toEqual([]);
    expect(result.blocked).toMatch(/distinctes/);
  });

  it('cherche d’abord les distracteurs dans le même chapitre', () => {
    // ch1 porte ici 4 cartes (assez pour 3 distracteurs sans sortir du
    // chapitre) ; ch2 a des réponses différentes, qui ne doivent pas apparaître.
    const ch1Cards = [
      card({ id: 'a1', subjectId: 's1', chapterId: 'ch1' }),
      card({ id: 'a2', subjectId: 's1', chapterId: 'ch1' }),
      card({ id: 'a3', subjectId: 's1', chapterId: 'ch1' }),
      card({ id: 'a4', subjectId: 's1', chapterId: 'ch1' }),
    ];
    const result = buildQuiz(
      { kind: 'chapter', subjectId: 's1', chapterId: 'ch1' },
      emptyTables([...ch1Cards, ...richCards.filter((c) => c.chapterId === 'ch2')]),
      { count: 1, difficulty: 'mixed', now: NOW, random: seeded(6) },
    );
    expect(result.blocked).toBeNull();
    const question = result.questions[0]!;
    const ch1Answers = new Set(ch1Cards.map((c) => c.answer));
    for (const option of question.options) expect(ch1Answers.has(option)).toBe(true);
  });

  it('propose un indice dérivé du texte réel de la réponse', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(),
      { count: 1, difficulty: 'mixed', now: NOW, random: seeded(7) },
    );
    const question = result.questions[0]!;
    const answer = richCards.find((c) => c.id === question.cardId)!.answer;
    expect(question.hint).toContain(answer.split(' ')[0]);
  });

  it('avant un examen, fait passer les chapitres les plus faibles en tête', () => {
    // ch1 : mastery SM-2 réellement haute (beaucoup de révisions, ease fort).
    // ch2 : mastery SM-2 réellement basse (peu d'intervalle, ease faible).
    // Les deux sont mesurées — aucune n'est « jamais révisée » — donc le
    // classement ne peut venir que de la différence de maîtrise réelle.
    const strongCards = ['c1', 'c2', 'c3'].map((id) =>
      richCards.find((c) => c.id === id)!,
    ).map((c) => ({ ...c, reps: 8, interval: 60, ease: 2.6 }));
    const weakCards = ['c4', 'c5', 'c6'].map((id) =>
      richCards.find((c) => c.id === id)!,
    ).map((c) => ({ ...c, reps: 3, interval: 1, ease: 1.4 }));
    const result = buildQuiz(
      { kind: 'exam', subjectId: 's1' },
      emptyTables([...strongCards, ...weakCards]),
      { count: 3, difficulty: 'mixed', now: NOW, random: seeded(8) },
    );
    expect(result.questions[0]!.chapterId).toBe('ch2');
  });
});

describe('summarizeQuiz — résultat, sans donnée fabriquée', () => {
  const built = buildQuiz(
    { kind: 'subject', subjectId: 's1' },
    emptyTables(),
    { count: 4, difficulty: 'mixed', now: NOW, random: seeded(9) },
  );

  const answers: QuizAnswerRecord[] = built.questions.map((question, i) => ({
    question,
    selectedIndex: question.correctIndex,
    correct: i !== 0, // la première question est ratée
    elapsedMs: 5000,
  }));

  it('compte le score exactement sur les réponses fournies', () => {
    const result = summarizeQuiz(answers);
    expect(result.total).toBe(4);
    expect(result.correct).toBe(3);
    expect(result.scorePct).toBe(75);
  });

  it('additionne le temps réellement passé, sans l’inventer', () => {
    const result = summarizeQuiz(answers);
    expect(result.elapsedMs).toBe(4 * 5000);
  });

  it('liste les questions ratées, et elles seules', () => {
    const result = summarizeQuiz(answers);
    expect(result.missed).toHaveLength(1);
    expect(result.missed[0]!.question.id).toBe(built.questions[0]!.id);
  });

  it('détecte un chapitre faible seulement s’il est réellement sous le seuil', () => {
    const allWrong: QuizAnswerRecord[] = built.questions.map((question) => ({
      question,
      selectedIndex: (question.correctIndex + 1) % 4,
      correct: false,
      elapsedMs: 3000,
    }));
    const result = summarizeQuiz(allWrong);
    expect(result.weakChapters.length).toBeGreaterThan(0);
    expect(result.weakChapters.every((c) => c.successRate < 0.6)).toBe(true);
  });

  it('un score parfait ne signale aucun chapitre faible', () => {
    const allCorrect: QuizAnswerRecord[] = built.questions.map((question) => ({
      question,
      selectedIndex: question.correctIndex,
      correct: true,
      elapsedMs: 3000,
    }));
    expect(summarizeQuiz(allCorrect).weakChapters).toEqual([]);
  });
});
