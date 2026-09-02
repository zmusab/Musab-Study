import { masteryPct } from '@/core/mastery';
import { chapterProgress, weakPoints } from '@/core/progress';
import type { Chapter, Difficulty, Flashcard, ID, ReviewLog, Subject } from '@/types';

/**
 * QUIZ — évaluation de connaissances, distincte des flashcards.
 *
 * Flashcards = rappel actif + répétition espacée : chaque réponse avance ou
 * recule l'échéance SM-2 de LA carte concernée.
 * Quiz = évaluation : il LIT les flashcards (question, réponse, difficulté,
 * chapitre) pour construire de vrais QCM, mais n'écrit jamais dans leur état
 * de planification. Une bonne ou une mauvaise réponse au quiz ne modifie ni
 * `due`, ni `ease`, ni `interval` — voir `data/repositories/quiz.ts`.
 *
 * Aucune question n'est générée par un modèle de langage ici : les quatre
 * options d'un QCM sont des couples question/réponse RÉELS, pris tels quels
 * dans les flashcards existantes. La bonne réponse est le texte exact de la
 * carte ; les trois autres sont les réponses réelles d'autres cartes,
 * choisies STRICTEMENT dans cet ordre : (1) le même chapitre, (2) la même
 * matière (cherchée dans TOUTE la matière, pas seulement dans le périmètre
 * restreint du quiz — un quiz « par chapitre » ne doit pas sauter vers une
 * autre matière alors que la matière courante a encore des cartes
 * pertinentes ailleurs), (3) une autre matière, en dernier recours
 * uniquement. Une carte sans 3 distracteurs distincts, même après ce
 * dernier recours, n'est simplement pas utilisée — jamais de réponse
 * manifestement hors sujet pour compléter un QCM.
 */

export type QuizScope =
  | { kind: 'subject'; subjectId: ID }
  | { kind: 'subjects'; subjectIds: ID[] }
  | { kind: 'chapter'; subjectId: ID; chapterId: ID | null }
  /** Chapitres identifiés comme des points faibles réels (voir `weakPoints`). */
  | { kind: 'weak' }
  /** Cartes que la répétition espacée programme aujourd'hui ou avant. */
  | { kind: 'due' }
  /** Matière d'une évaluation à venir — les chapitres faibles y passent en premier. */
  | { kind: 'exam'; subjectId: ID };

export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';

const DIFFICULTY_VALUE: Record<Exclude<QuizDifficulty, 'mixed'>, Difficulty> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

export interface QuizTables {
  subjects: readonly Subject[];
  chapters: readonly Chapter[];
  cards: readonly Flashcard[];
  logs: readonly ReviewLog[];
}

export interface QuizQuestionInstance {
  id: ID;
  /** Carte réelle derrière la question — c'est elle qui reçoit le journal de réponse. */
  cardId: ID;
  subjectId: ID;
  subjectName: string;
  chapterId: ID | null;
  chapterName: string | null;
  question: string;
  /** Quatre propositions, dans un ordre mélangé. */
  options: string[];
  correctIndex: number;
  difficulty: Difficulty;
  /** Indice dérivé du texte réel de la réponse — jamais un contenu inventé. */
  hint: string;
  /**
   * Contexte affiché après la réponse : l'état de maîtrise RÉEL de cette
   * carte au moment du quiz. Ce n'est pas une explication pédagogique
   * fabriquée, seulement un fait mesuré et déjà vrai avant le quiz.
   */
  masteryContext: string;
}

export interface QuizBuildResult {
  questions: QuizQuestionInstance[];
  requestedCount: number;
  /** Raison quand aucune question n'a pu être construite. */
  blocked: string | null;
}

export interface QuizBuildOptions {
  count: number;
  difficulty: QuizDifficulty;
  now?: Date;
  random?: () => number;
}

/** Fisher-Yates avec générateur injectable — déterministe en test. */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const normalize = (text: string): string => text.trim().toLowerCase();

/**
 * Le vivier de cartes correspondant à un scope, AVANT filtre de difficulté.
 *
 * Chaque branche ne fait que lire des données réellement enregistrées :
 * aucune carte, aucun chapitre, aucune matière n'est fabriqué ici.
 */
export function scopeCards(scope: QuizScope, tables: QuizTables, now: Date = new Date()): Flashcard[] {
  const nowIso = now.toISOString();
  switch (scope.kind) {
    case 'subject':
      return tables.cards.filter((card) => card.subjectId === scope.subjectId);
    case 'subjects': {
      const wanted = new Set(scope.subjectIds);
      return tables.cards.filter((card) => wanted.has(card.subjectId));
    }
    case 'chapter':
      return tables.cards.filter(
        (card) => card.subjectId === scope.subjectId && card.chapterId === scope.chapterId,
      );
    case 'due':
      return tables.cards.filter((card) => card.due <= nowIso);
    case 'exam':
      return tables.cards.filter((card) => card.subjectId === scope.subjectId);
    case 'weak': {
      const weak = weakPoints(tables.subjects, tables.chapters, tables.cards, tables.logs, 20);
      const wantedCardIds = new Set(weak.flatMap((point) => point.cardIds));
      return tables.cards.filter((card) => wantedCardIds.has(card.id));
    }
    default:
      return [];
  }
}

/**
 * Ordre de tirage des cartes candidates : pour « points faibles » et
 * « avant un examen », les chapitres les plus fragiles (mesurés, jamais
 * supposés) passent en tête, en alternant entre eux pour que le quiz ne
 * s'enferme pas dans un seul chapitre.
 */
function priorityOrder(
  scope: QuizScope,
  pool: readonly Flashcard[],
  tables: QuizTables,
  random: () => number,
): Flashcard[] {
  if (scope.kind !== 'exam' && scope.kind !== 'weak') return shuffle(pool, random);

  const subjectId = scope.kind === 'exam' ? scope.subjectId : null;
  const bySubject = subjectId
    ? [subjectId]
    : [...new Set(pool.map((card) => card.subjectId))];

  const chapterOrder: (ID | null)[] = [];
  for (const sid of bySubject) {
    for (const row of chapterProgress(sid, tables.chapters, tables.cards, tables.logs)) {
      chapterOrder.push(row.chapterId);
    }
  }

  const byChapter = new Map<ID | null, Flashcard[]>();
  for (const card of pool) {
    const list = byChapter.get(card.chapterId);
    if (list) list.push(card);
    else byChapter.set(card.chapterId, [card]);
  }
  for (const [key, list] of byChapter) byChapter.set(key, shuffle(list, random));

  // Round-robin sur les chapitres, du plus faible au plus solide.
  const ordered: Flashcard[] = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const chapterId of chapterOrder) {
      const list = byChapter.get(chapterId);
      if (!list || list.length === 0) continue;
      ordered.push(list.shift()!);
      remaining = true;
    }
  }
  // Chapitres absents de `chapterProgress` (scope multi-matières incomplet) :
  // ajoutés à la fin plutôt que perdus.
  for (const list of byChapter.values()) ordered.push(...list);
  return ordered;
}

/**
 * Trois distracteurs réels, cherchés du plus proche au plus large — jamais
 * dans le `pool` restreint par le scope du quiz (qui peut être limité à un
 * seul chapitre), toujours dans `allCards` (toutes les flashcards réelles de
 * l'application), pour ne pas manquer un distracteur pertinent qui existe
 * ailleurs dans la même matière.
 */
function pickDistractors(
  card: Flashcard,
  allCards: readonly Flashcard[],
  random: () => number,
): string[] | null {
  const correct = normalize(card.answer);
  const seen = new Set([correct]);
  const distractors: string[] = [];

  const addFrom = (candidates: readonly Flashcard[]) => {
    for (const other of shuffle(candidates, random)) {
      if (distractors.length >= 3) break;
      const text = other.answer.trim();
      const key = normalize(text);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      distractors.push(text);
    }
  };

  // 1. Même chapitre (donc forcément même matière) — le contexte le plus pertinent.
  if (card.chapterId !== null) {
    addFrom(
      allCards.filter(
        (other) => other.id !== card.id && other.subjectId === card.subjectId && other.chapterId === card.chapterId,
      ),
    );
  }
  // 2. Même matière, tous chapitres confondus — cherché dans l'ensemble des
  //    flashcards de la matière, pas seulement le périmètre du quiz.
  if (distractors.length < 3) {
    addFrom(allCards.filter((other) => other.id !== card.id && other.subjectId === card.subjectId));
  }
  // 3. Dernier recours seulement : une autre matière, quand la matière
  //    courante n'a réellement pas assez de réponses distinctes.
  if (distractors.length < 3) {
    addFrom(allCards.filter((other) => other.id !== card.id));
  }

  return distractors.length === 3 ? distractors : null;
}

function buildHint(answer: string): string {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  return `Commence par « ${first} » · ${words.length} mot${words.length > 1 ? 's' : ''}`;
}

function buildMasteryContext(card: Flashcard): string {
  if (card.reps === 0) return 'Cette carte n’a encore jamais été révisée dans tes flashcards.';
  const pct = masteryPct(card);
  return `Maîtrise actuelle de cette carte dans tes flashcards : ${pct} % (${card.reps} révision${card.reps > 1 ? 's' : ''}).`;
}

/**
 * Construit un quiz. Ne bloque que quand la donnée manque réellement — un
 * scope trop restreint pour former des QCM le dit, plutôt que d'inventer des
 * options.
 */
export function buildQuiz(
  scope: QuizScope,
  tables: QuizTables,
  options: QuizBuildOptions,
): QuizBuildResult {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const empty = (blocked: string): QuizBuildResult => ({ questions: [], requestedCount: options.count, blocked });

  const pool = scopeCards(scope, tables, now);
  if (pool.length === 0) {
    return empty(
      scope.kind === 'weak'
        ? 'Pas encore de point faible mesuré : réponds à quelques flashcards, puis reviens ici.'
        : scope.kind === 'due'
          ? 'Aucune carte due pour l’instant : rien à évaluer aujourd’hui.'
          : 'Aucune flashcard sur ce périmètre : crée-en avant de lancer un quiz.',
    );
  }

  const filtered =
    options.difficulty === 'mixed'
      ? pool
      : pool.filter((card) => card.difficulty === DIFFICULTY_VALUE[options.difficulty as 'easy' | 'medium' | 'hard']);
  // Difficulté trop rare sur ce périmètre : on élargit plutôt que de bloquer
  // un quiz qui aurait pu exister.
  const effectivePool = filtered.length > 0 ? filtered : pool;

  const subjectName = new Map(tables.subjects.map((s) => [s.id, s.name]));
  const chapterName = new Map(tables.chapters.map((c) => [c.id, c.name]));
  const allCards = tables.cards;

  const ordered = priorityOrder(scope, effectivePool, tables, random);
  const questions: QuizQuestionInstance[] = [];
  let counter = 0;
  for (const card of ordered) {
    if (questions.length >= options.count) break;
    const distractors = pickDistractors(card, allCards, random);
    if (!distractors) continue;

    const optionTexts = shuffle([card.answer.trim(), ...distractors], random);
    counter += 1;
    questions.push({
      id: `quiz_${card.id}_${counter}`,
      cardId: card.id,
      subjectId: card.subjectId,
      subjectName: subjectName.get(card.subjectId) ?? 'Matière',
      chapterId: card.chapterId,
      chapterName: card.chapterId ? (chapterName.get(card.chapterId) ?? null) : null,
      question: card.question,
      options: optionTexts,
      correctIndex: optionTexts.indexOf(card.answer.trim()),
      difficulty: card.difficulty,
      hint: buildHint(card.answer),
      masteryContext: buildMasteryContext(card),
    });
  }

  if (questions.length === 0) {
    return empty(
      'Pas assez de cartes aux réponses distinctes pour proposer des choix multiples. Ajoute d’autres flashcards à cette matière.',
    );
  }

  return { questions, requestedCount: options.count, blocked: null };
}

// ────────────────────────────── Résultat d'un quiz ──────────────────────────────

export interface QuizAnswerRecord {
  question: QuizQuestionInstance;
  selectedIndex: number | null;
  correct: boolean;
  elapsedMs: number;
}

export interface QuizChapterBreakdown {
  subjectId: ID;
  subjectName: string;
  chapterId: ID | null;
  chapterName: string | null;
  total: number;
  correct: number;
  successRate: number;
}

export interface QuizResult {
  answers: QuizAnswerRecord[];
  total: number;
  correct: number;
  scorePct: number;
  elapsedMs: number;
  subjectIds: ID[];
  /** Chapitres sous 60 % de réussite sur ce quiz — un signal réel, pas une moyenne globale. */
  weakChapters: QuizChapterBreakdown[];
  missed: QuizAnswerRecord[];
}

const QUIZ_WEAK_CEILING = 0.6;

/** Résume une série de réponses — aucun calcul ici ne dépend de la base. */
export function summarizeQuiz(answers: readonly QuizAnswerRecord[]): QuizResult {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const elapsedMs = answers.reduce((sum, a) => sum + a.elapsedMs, 0);
  const subjectIds = [...new Set(answers.map((a) => a.question.subjectId))];

  const groups = new Map<string, QuizAnswerRecord[]>();
  for (const answer of answers) {
    const key = `${answer.question.subjectId}:${answer.question.chapterId ?? 'orphan'}`;
    const list = groups.get(key);
    if (list) list.push(answer);
    else groups.set(key, [answer]);
  }

  const weakChapters: QuizChapterBreakdown[] = [];
  for (const group of groups.values()) {
    const first = group[0]!.question;
    const groupCorrect = group.filter((a) => a.correct).length;
    const rate = groupCorrect / group.length;
    if (rate >= QUIZ_WEAK_CEILING) continue;
    weakChapters.push({
      subjectId: first.subjectId,
      subjectName: first.subjectName,
      chapterId: first.chapterId,
      chapterName: first.chapterName,
      total: group.length,
      correct: groupCorrect,
      successRate: rate,
    });
  }
  weakChapters.sort((a, b) => a.successRate - b.successRate);

  return {
    answers: [...answers],
    total,
    correct,
    scorePct: total > 0 ? Math.round((correct / total) * 100) : 0,
    elapsedMs,
    subjectIds,
    weakChapters,
    missed: answers.filter((a) => !a.correct),
  };
}
