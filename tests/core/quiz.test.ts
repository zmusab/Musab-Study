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
  it('reproduit la capture : ne mélange jamais branches, rapports, trajet et innervation', () => {
    const cards = [
      card({ id: 'frontal', subjectId: 's1', chapterId: 'ch1', origin: 'local', question: 'De quoi se compose Nerf frontal ?', answer: 'Branches ascendantes sensitives pour la peau du front, Branches descendantes (ou palpébrales) pour la partie moyenne de la paupière supérieure et Branches osseuses (osteo-périostées) pour l’os frontal et pour la muqueuse qui tapisse le sinus frontal' }),
      card({ id: 'rapports', subjectId: 's1', chapterId: 'ch1', origin: 'local', question: 'De quoi se compose le nerf ophtalmique ?', answer: 'L’artère carotide interne, Le sinus caverneux et Les nerf III, IV et VI' }),
      card({ id: 'infra', subjectId: 's1', chapterId: 'ch1', origin: 'local', question: 'Quelles sont les branches du nerf infra-orbitaire ?', answer: 'Branches ascendante (ou palpébrales) pour la peau de la paupière inférieure, Branches descendante (ou jugales) pour les joues et Branches internes (ou nasales) pour les ailes du nez' }),
      card({ id: 'alveolaire', subjectId: 's1', chapterId: 'ch1', origin: 'local', question: 'De quoi se compose le nerf alvéolaire supérieur et antérieur ?', answer: 'Il se détache à environ 5 mm en avant de la terminaison du nerf maxillaire et réalise l’innervation des incisives et des canines supérieures' }),
    ];
    const result = buildQuiz(
      { kind: 'cards', cardIds: ['frontal'] },
      emptyTables(cards),
      { count: 1, difficulty: 'mixed', format: 'mixed', now: NOW, random: seeded(2) },
    );
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.format).toBe('recall');
    expect(result.questions[0]!.question).toBe('Quelles sont les branches du nerf frontal ?');
    expect(result.questions[0]!.options).not.toContain(cards[1]!.answer);
    expect(result.questions[0]!.options).not.toContain(cards[3]!.answer);
  });

  it('écarte une ancienne carte générée dont la question et la réponse se contredisent', () => {
    const malformed = card({
      id: 'maxillaire', subjectId: 's1', chapterId: 'ch1', origin: 'local',
      question: 'De quoi se compose le nerf maxillaire (V’’) et le ganglion sphéno-palatin de Meckel ?',
      answer: 'C’est un nerf sensitif. Il chemine par le canal moyen du cavum Meckeli et sort du crâne par le foramen rond.',
    });
    const result = buildQuiz(
      { kind: 'cards', cardIds: [malformed.id] },
      emptyTables([malformed]),
      { count: 1, difficulty: 'mixed', format: 'mixed', now: NOW },
    );
    expect(result.questions).toEqual([]);
    expect(result.blocked).not.toBeNull();
  });

  it('ne recycle aucune proposition entre deux QCM de la même série', () => {
    const pool = Array.from({ length: 12 }, (_, i) => card({
      id: `unique-${i}`, subjectId: 's1', chapterId: 'ch1',
      question: `Question anatomique ${i}`,
      answer: `Réponse anatomique unique ${i}`,
    }));
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' }, emptyTables(pool),
      { count: 3, difficulty: 'mixed', format: 'qcm', now: NOW, random: seeded(33) },
    );
    const seen = new Set<string>();
    for (const question of result.questions) {
      for (const option of question.options) {
        expect(seen.has(option)).toBe(false);
        seen.add(option);
      }
    }
  });

  it('écarte les listes de branches et de trajets pour les quatre muscles de la capture', () => {
    const cards = [
      card({ id: 'muscles', subjectId: 's1', question: 'De quoi se compose 4 muscles droits ?', answer: 'Droit supérieur, Droit inférieur, Droit médial et Droit latéral' }),
      card({ id: 'branches', subjectId: 's1', question: 'Quelles sont les branches du nerf frontal ?', answer: 'Branches ascendantes sensitives pour la peau du front, branches descendantes pour la paupière supérieure' }),
      card({ id: 'nasal', subjectId: 's1', question: 'Quelles sont les branches du nerf nasal ?', answer: 'Ils sont au nombre de 2, 3 et ils réalisent l’innervation sensitive de la muqueuse nasale' }),
      card({ id: 'trajet', subjectId: 's1', question: 'Quels sont les changements de trajet du nerf ?', answer: 'Quand il sort du crâne et Quand il entre dans l’orbite' }),
    ];
    const tables = { subjects, chapters, cards, logs: [] };
    for (let seed = 1; seed <= 20; seed++) {
      const result = buildQuiz({ kind: 'cards', cardIds: ['muscles'] }, tables, { count: 1, difficulty: 'mixed', format: 'mixed', random: seeded(seed) });
      expect(result.questions[0]?.format).toBe('recall');
      expect(result.questions[0]?.question).toBe('Quels sont les 4 muscles droits ?');
      expect(result.questions[0]?.options[0]).toBe(cards[0]!.answer);
    }
    expect(buildQuiz({ kind: 'cards', cardIds: ['muscles'] }, tables, { count: 1, difficulty: 'mixed', format: 'qcm' }).questions).toEqual([]);
  });
  it('privilégie des propositions encore inutilisées dans la série', () => {
    const pool = Array.from({ length: 10 }, (_, i) => card({ id: `variation${i}`, subjectId: 's1', chapterId: 'ch1' }));
    const result = buildQuiz({ kind: 'subject', subjectId: 's1' }, emptyTables(pool), { count: 2, difficulty: 'mixed', random: seeded(8) });
    expect(result.questions).toHaveLength(2);
    const [first, second] = result.questions;
    expect(second!.options.filter(option => first!.options.includes(option)).length).toBeLessThanOrEqual(1);
  });
  it('ne propose pas une liste de branches en réponse à une localisation', () => {
    const locations = ['Dans le canal Alpha', 'Au niveau du massif Beta', 'Sur la face Gamma', 'Près du repère Delta'].map((answer, i) => card({ id: `lieu${i}`, subjectId: 's1', question: `Où se situe la structure ${i} ?`, answer }));
    const unrelated = card({ id: 'branches', subjectId: 's1', question: 'De quoi se compose la structure ?', answer: 'Branche une, branche deux' });
    const result = buildQuiz({ kind: 'cards', cardIds: ['lieu0'] }, emptyTables([...locations, unrelated]), { count: 1, difficulty: 'mixed', random: seeded(4) });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.options).not.toContain(unrelated.answer);
  });
  it('départage les priorités égales aléatoirement entre les séries', () => {
    const pool = Array.from({ length: 12 }, (_, i) => card({ id: `var${i}`, subjectId: 's1' }));
    const generate = (seed: number) => buildQuiz({ kind: 'subject', subjectId: 's1' }, emptyTables(pool), { count: 5, difficulty: 'mixed', random: seeded(seed) }).questions.map(q => q.cardId);
    expect(generate(1)).not.toEqual(generate(42));
  });
  it('construit le nombre de questions demandé quand les données suffisent', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(),
      { count: 4, difficulty: 'mixed', format: 'mixed', now: NOW, random: seeded(1) },
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
      { count: 4, difficulty: 'easy', format: 'mixed', now: NOW, random: seeded(5) },
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

  it('un quiz « par chapitre » cherche ses distracteurs dans toute la matière, pas seulement le chapitre visé', () => {
    // ch1 (visé par le quiz) ne porte qu'une seule carte : aucun distracteur
    // possible SANS sortir du chapitre. ch2, dans la MÊME matière, en porte
    // trois : le correctif doit les trouver là plutôt que de sauter tout de
    // suite vers une autre matière (ici absente).
    const targeted = card({ id: 't1', subjectId: 's1', chapterId: 'ch1' });
    const sameSubjectOtherChapter = [
      card({ id: 'o1', subjectId: 's1', chapterId: 'ch2' }),
      card({ id: 'o2', subjectId: 's1', chapterId: 'ch2' }),
      card({ id: 'o3', subjectId: 's1', chapterId: 'ch2' }),
    ];
    const result = buildQuiz(
      { kind: 'chapter', subjectId: 's1', chapterId: 'ch1' },
      emptyTables([targeted, ...sameSubjectOtherChapter]),
      { count: 1, difficulty: 'mixed', now: NOW, random: seeded(10) },
    );
    expect(result.blocked).toBeNull();
    const question = result.questions[0]!;
    const sameSubjectAnswers = new Set(sameSubjectOtherChapter.map((c) => c.answer));
    for (const option of question.options) {
      if (option === targeted.answer) continue;
      expect(sameSubjectAnswers.has(option)).toBe(true);
    }
  });

  it('ne complète jamais les choix avec une autre matière', () => {
    const targeted = card({ id: 't1', subjectId: 's1', chapterId: 'ch1' });
    // Une seule autre carte dans toute la matière s1 : insuffisant pour 3
    // distracteurs sans sortir de la matière.
    const sameSubjectOnly = card({ id: 'o1', subjectId: 's1', chapterId: 'ch2' });
    const otherSubjectCards = [
      card({ id: 'p1', subjectId: 's2' }),
      card({ id: 'p2', subjectId: 's2' }),
      card({ id: 'p3', subjectId: 's2' }),
    ];
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables([targeted, sameSubjectOnly, ...otherSubjectCards]),
      { count: 2, difficulty: 'mixed', now: NOW, random: seeded(11) },
    );
    expect(result.blocked).not.toBeNull();
    expect(result.questions).toEqual([]);
  });

  it('réduit le nombre de questions plutôt que d’imposer des réponses hors sujet quand aucune matière ne suffit', () => {
    // Deux cartes seulement dans toute la base, réparties sur deux matières
    // différentes : aucun distracteur pertinent ni de dernier recours
    // suffisant (il faut 3 distracteurs, il n'y a qu'1 autre carte au
    // total) — le quiz doit proposer moins de questions, jamais une
    // réponse manifestement hors sujet inventée ou dupliquée.
    const cards = [
      card({ id: 't1', subjectId: 's1', chapterId: 'ch1' }),
      card({ id: 'p1', subjectId: 's2' }),
    ];
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(cards),
      { count: 5, difficulty: 'mixed', now: NOW, random: seeded(12) },
    );
    expect(result.questions).toEqual([]);
    expect(result.blocked).toMatch(/distinctes/);
  });

  /**
   * Cas réel signalé : « Quelles dents supérieures sont innervées par les
   * nerfs alvéolaires supérieurs et postérieurs ? » avec, parmi les options,
   * « Les molaires et les prémolaires supérieures » à côté de « La deuxième
   * prémolaire et les deux premières molaires supérieures » — deux réponses
   * qui se chevauchent au point que la première pourrait être défendue comme
   * une version moins précise de la bonne réponse. Les distracteurs sont de
   * VRAIES réponses d'autres cartes (jamais fabriquées) : rien n'empêchait
   * jusqu'ici deux cartes réelles de décrire la même notion sous deux
   * formulations qui se recoupent.
   */
  it('n’utilise jamais, comme distracteur, une réponse qui se recoupe trop avec la bonne réponse', () => {
    const targeted = card({
      id: 't1',
      subjectId: 's1',
      chapterId: 'ch1',
      answer: 'La deuxième prémolaire et les deux premières molaires supérieures.',
    });
    const ambiguous = card({
      id: 'amb1',
      subjectId: 's1',
      chapterId: 'ch1',
      answer: 'Les molaires et les prémolaires supérieures.',
    });
    const distinct = [
      card({ id: 'd1', subjectId: 's1', chapterId: 'ch1', answer: 'Le nerf mandibulaire.' }),
      card({ id: 'd2', subjectId: 's1', chapterId: 'ch1', answer: 'La branche ophtalmique.' }),
      card({ id: 'd3', subjectId: 's1', chapterId: 'ch1', answer: 'Le ganglion trigéminal.' }),
    ];
    const result = buildQuiz(
      { kind: 'cards', cardIds: [targeted.id] },
      emptyTables([targeted, ambiguous, ...distinct]),
      { count: 1, difficulty: 'mixed', format: 'qcm', now: NOW, random: seeded(21) },
    );
    expect(result.blocked).toBeNull();
    const question = result.questions[0]!;
    expect(question.options).not.toContain(ambiguous.answer);
    expect(question.options).toContain(targeted.answer);
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

describe('buildQuiz — format Vrai/Faux', () => {
  it('produit des affirmations Vrai/Faux à deux options, cohérentes avec les données réelles', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(),
      { count: 6, difficulty: 'mixed', format: 'vf', now: NOW, random: seeded(20) },
    );
    expect(result.blocked).toBeNull();
    expect(result.questions).toHaveLength(6);
    for (const question of result.questions) {
      expect(question.format).toBe('vf');
      expect(question.options).toEqual(['Vrai', 'Faux']);
      const realAnswer = richCards.find((c) => c.id === question.cardId)!.answer;
      const otherAnswers = richCards.filter((c) => c.id !== question.cardId).map((c) => c.answer);
      if (question.correctIndex === 0) {
        // Affirmation vraie : la réponse proposée est bien celle de la carte.
        expect(question.question).toContain(realAnswer);
      } else {
        // Affirmation fausse : la réponse proposée n'est JAMAIS celle de la
        // carte, mais toujours une réponse réelle d'une autre carte.
        expect(question.question).not.toContain(realAnswer);
        expect(otherAnswers.some((answer) => question.question.includes(answer))).toBe(true);
      }
    }
  });

  it('ne propose aucun indice en Vrai/Faux — l’affirmation contient déjà la réponse proposée', () => {
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(),
      { count: 3, difficulty: 'mixed', format: 'vf', now: NOW, random: seeded(21) },
    );
    for (const question of result.questions) expect(question.hint).toBe('');
  });

  it('ne se bloque jamais faute de distracteur, même avec une seule carte sur tout le périmètre', () => {
    // Une seule carte dans tout le périmètre : impossible en QCM (voir le
    // test équivalent ci-dessus), mais toujours constructible en Vrai/Faux —
    // l'affirmation reste vraie plutôt que d'inventer un distracteur.
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables([card({ id: 'lonely', subjectId: 's1' })]),
      { count: 3, difficulty: 'mixed', format: 'vf', now: NOW },
    );
    expect(result.blocked).toBeNull();
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.correctIndex).toBe(0);
  });

  it('format mixte : propose un rappel libre quand le QCM est impossible', () => {
    // Deux cartes seulement, dans deux matières différentes : le QCM ne peut
    // jamais aboutir ici (il faut 3 distracteurs, il n'y en a qu'1 au
    // total), donc les deux cartes ne peuvent produire qu'un Vrai/Faux —
    // quel que soit le tirage du format par carte.
    const cards = [
      card({ id: 't1', subjectId: 's1', chapterId: 'ch1' }),
      card({ id: 'p1', subjectId: 's2' }),
    ];
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(cards),
      { count: 2, difficulty: 'mixed', format: 'mixed', now: NOW, random: seeded(22) },
    );
    expect(result.blocked).toBeNull();
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.format).toBe('recall');
  });

  it('un format QCM explicite reste bloqué comme avant — pas de repli automatique vers Vrai/Faux', () => {
    const cards = [
      card({ id: 't1', subjectId: 's1', chapterId: 'ch1' }),
      card({ id: 'p1', subjectId: 's2' }),
    ];
    const result = buildQuiz(
      { kind: 'subject', subjectId: 's1' },
      emptyTables(cards),
      { count: 2, difficulty: 'mixed', format: 'qcm', now: NOW, random: seeded(23) },
    );
    expect(result.questions).toEqual([]);
    expect(result.blocked).toMatch(/distinctes/);
  });
});

describe('summarizeQuiz — résultat, sans donnée fabriquée', () => {
  const built = buildQuiz(
    { kind: 'subject', subjectId: 's1' },
    emptyTables(),
    { count: 4, difficulty: 'mixed', format: 'mixed', now: NOW, random: seeded(9) },
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
