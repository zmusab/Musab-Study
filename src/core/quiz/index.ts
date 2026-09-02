import { masteryPct } from '@/core/mastery';
import { chapterProgress, weakPoints } from '@/core/progress';
import { upcomingEvaluations } from '@/core/progress/exam';
import {
  chapterSignalsFromAnalyses,
  rankForExamLikely,
  type ExamLikelihoodInfo,
} from '@/core/quiz/examLikely';
import type { CalendarEvent, Chapter, ChapterAnalysis, Difficulty, Flashcard, ID, ReviewLog, Subject } from '@/types';

export type { ExamLikelihood, ExamLikelihoodInfo } from '@/core/quiz/examLikely';

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
 * Aucune question n'est générée par un modèle de langage ici. Deux formats,
 * tous deux construits à partir des mêmes couples question/réponse RÉELS des
 * flashcards existantes :
 *
 * - QCM : la bonne réponse est le texte exact de la carte ; les trois autres
 *   sont les réponses réelles d'autres cartes, choisies STRICTEMENT dans cet
 *   ordre : (1) le même chapitre, (2) la même matière (cherchée dans TOUTE la
 *   matière, pas seulement dans le périmètre restreint du quiz — un quiz
 *   « par chapitre » ne doit pas sauter vers une autre matière alors que la
 *   matière courante a encore des cartes pertinentes ailleurs), (3) une autre
 *   matière, en dernier recours uniquement. Une carte sans 3 distracteurs
 *   distincts, même après ce dernier recours, n'est simplement pas utilisée
 *   — jamais de réponse manifestement hors sujet pour compléter un QCM.
 * - Vrai/Faux : l'affirmation associe la question réelle de la carte à une
 *   réponse réelle — la sienne (affirmation vraie) ou, avec la même
 *   priorité chapitre → matière → dernier recours qu'un distracteur de QCM,
 *   la réponse réelle d'une autre carte (affirmation fausse). Quand aucune
 *   autre réponse distincte n'existe nulle part, l'affirmation reste vraie
 *   plutôt que de fabriquer une fausse affirmation hors sujet — ce format ne
 *   se bloque donc jamais faute de distracteur.
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
  | { kind: 'exam'; subjectId: ID }
  /**
   * « Examen probable » — ESTIMATION, jamais une prédiction (voir
   * `core/quiz/examLikely.ts`). `chapterIds` vide = toute la matière.
   * `evaluationEventId` : l'examen réellement enregistré au calendrier à
   * utiliser pour contextualiser l'estimation, ou `null` si aucun n'est
   * disponible ou choisi.
   */
  | { kind: 'exam-likely'; subjectId: ID; chapterIds: ID[]; evaluationEventId: ID | null }
  /** Cartes précises, désignées par id — sert par exemple à « Refaire les questions importantes ». */
  | { kind: 'cards'; cardIds: ID[] };

export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';

/**
 * `'qcm'` : choix multiple à 4 propositions. `'vf'` : affirmation à évaluer,
 * vraie ou fausse. `'mixed'` : chaque question tire son propre format —
 * un QCM impossible à compléter (pas assez de distracteurs) retombe alors
 * sur un vrai/faux plutôt que d'être perdu, puisque ce dernier se construit
 * toujours avec les mêmes données réelles.
 */
export type QuizFormat = 'qcm' | 'vf' | 'mixed';
type ResolvedQuizFormat = Exclude<QuizFormat, 'mixed'>;

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
  /** Optionnelles : seul le scope `'exam-likely'` les utilise, tous les appelants existants restent valides sans elles. */
  events?: readonly CalendarEvent[];
  /** Analyses IA déjà enregistrées par chapitre (voir `services/courses/notions.ts`) — jamais recalculées ici. */
  chapterAnalyses?: readonly ChapterAnalysis[];
}

export interface QuizQuestionInstance {
  id: ID;
  /** Carte réelle derrière la question — c'est elle qui reçoit le journal de réponse. */
  cardId: ID;
  subjectId: ID;
  subjectName: string;
  chapterId: ID | null;
  chapterName: string | null;
  format: ResolvedQuizFormat;
  /** QCM : la question de la carte. Vrai/Faux : l'affirmation complète à évaluer. */
  question: string;
  /** QCM : quatre propositions mélangées. Vrai/Faux : toujours `['Vrai', 'Faux']`. */
  options: string[];
  correctIndex: number;
  difficulty: Difficulty;
  /**
   * Indice dérivé du texte réel de la réponse — jamais un contenu inventé.
   * Vide en Vrai/Faux : l'affirmation contient déjà la réponse proposée, un
   * indice supplémentaire la révélerait directement.
   */
  hint: string;
  /**
   * Contexte affiché après la réponse : l'état de maîtrise RÉEL de cette
   * carte au moment du quiz. Ce n'est pas une explication pédagogique
   * fabriquée, seulement un fait mesuré et déjà vrai avant le quiz.
   */
  masteryContext: string;
  /**
   * Estimation « Examen probable » — `null` pour tout autre scope. Une
   * ESTIMATION de probabilité de contenu, jamais une prédiction : voir
   * `core/quiz/examLikely.ts`.
   */
  examLikelihood: ExamLikelihoodInfo | null;
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
  /** Défaut `'qcm'` — inchangé pour les appelants existants. */
  format?: QuizFormat;
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
    case 'exam-likely': {
      const subjectCards = tables.cards.filter((card) => card.subjectId === scope.subjectId);
      if (scope.chapterIds.length === 0) return subjectCards;
      const wantedChapters = new Set(scope.chapterIds);
      return subjectCards.filter((card) => card.chapterId !== null && wantedChapters.has(card.chapterId));
    }
    case 'cards': {
      const wanted = new Set(scope.cardIds);
      return tables.cards.filter((card) => wanted.has(card.id));
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
 * Jusqu'à `needed` réponses réelles d'AUTRES cartes, distinctes entre elles
 * et de celle de `card`, cherchées du contexte le plus proche au plus large
 * — jamais dans le `pool` restreint par le scope du quiz (qui peut être
 * limité à un seul chapitre), toujours dans `allCards` (toutes les
 * flashcards réelles de l'application), pour ne pas manquer une réponse
 * pertinente qui existe ailleurs dans la même matière. Peut renvoyer moins
 * de `needed` éléments — jamais plus, jamais une réponse fabriquée.
 */
function pickRelevantAnswers(
  card: Flashcard,
  allCards: readonly Flashcard[],
  needed: number,
  random: () => number,
): string[] {
  const correct = normalize(card.answer);
  const seen = new Set([correct]);
  const picked: string[] = [];

  const addFrom = (candidates: readonly Flashcard[]) => {
    for (const other of shuffle(candidates, random)) {
      if (picked.length >= needed) break;
      const text = other.answer.trim();
      const key = normalize(text);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      picked.push(text);
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
  if (picked.length < needed) {
    addFrom(allCards.filter((other) => other.id !== card.id && other.subjectId === card.subjectId));
  }
  // 3. Dernier recours seulement : une autre matière, quand la matière
  //    courante n'a réellement pas assez de réponses distinctes.
  if (picked.length < needed) {
    addFrom(allCards.filter((other) => other.id !== card.id));
  }

  return picked;
}

/** Trois distracteurs de QCM — `null` si les données réelles n'en fournissent pas assez. */
function pickDistractors(card: Flashcard, allCards: readonly Flashcard[], random: () => number): string[] | null {
  const picked = pickRelevantAnswers(card, allCards, 3, random);
  return picked.length === 3 ? picked : null;
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

/** Le contenu propre au format d'une question — le reste (matière, chapitre, maîtrise…) est commun. */
interface QuestionContent {
  format: ResolvedQuizFormat;
  question: string;
  options: string[];
  correctIndex: number;
  hint: string;
}

/** QCM : `null` si les données réelles ne fournissent pas 3 distracteurs distincts. */
function buildQcmContent(card: Flashcard, allCards: readonly Flashcard[], random: () => number): QuestionContent | null {
  const distractors = pickDistractors(card, allCards, random);
  if (!distractors) return null;
  const optionTexts = shuffle([card.answer.trim(), ...distractors], random);
  return {
    format: 'qcm',
    question: card.question,
    options: optionTexts,
    correctIndex: optionTexts.indexOf(card.answer.trim()),
    hint: buildHint(card.answer),
  };
}

/**
 * Vrai/Faux : toujours constructible avec les données réelles. Un tirage
 * décide si l'affirmation proposée doit être vraie ou fausse ; si aucune
 * autre réponse distincte n'existe nulle part pour bâtir une affirmation
 * fausse honnête, l'affirmation reste vraie plutôt que d'en fabriquer une.
 */
function buildVfContent(card: Flashcard, allCards: readonly Flashcard[], random: () => number): QuestionContent {
  const wantsFalse = random() < 0.5;
  const falseAnswer = wantsFalse ? pickRelevantAnswers(card, allCards, 1, random)[0] : undefined;
  const isTrue = falseAnswer === undefined;
  const statementAnswer = isTrue ? card.answer.trim() : falseAnswer;
  return {
    format: 'vf',
    question: `Vrai ou faux : la réponse à « ${card.question} » est « ${statementAnswer} ».`,
    options: ['Vrai', 'Faux'],
    correctIndex: isTrue ? 0 : 1,
    hint: '',
  };
}

function resolveFormat(format: QuizFormat, random: () => number): ResolvedQuizFormat {
  return format === 'mixed' ? (random() < 0.5 ? 'qcm' : 'vf') : format;
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
          : scope.kind === 'exam-likely'
            ? 'Aucune flashcard sur ce chapitre : impossible d’estimer les questions probables sans contenu à évaluer.'
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

  const requestedFormat = options.format ?? 'qcm';

  // « Examen probable » a son propre classement (probabilité de contenu +
  // lacune réelle de l'étudiant, voir core/quiz/examLikely.ts) — calculé à
  // part plutôt que d'alourdir `priorityOrder`, qui reste inchangé pour tous
  // les autres scopes.
  let ordered: Flashcard[];
  let examInfoByCardId: Map<ID, { score: number; info: ExamLikelihoodInfo }> | null = null;
  if (scope.kind === 'exam-likely') {
    const chapterSignals = chapterSignalsFromAnalyses(tables.chapterAnalyses ?? []);
    const evaluation = scope.evaluationEventId
      ? (upcomingEvaluations(tables.events ?? [], tables.subjects, now).find(
          (candidate) => candidate.event.id === scope.evaluationEventId,
        ) ?? null)
      : null;
    const ranking = rankForExamLikely(
      effectivePool,
      chapterSignals,
      (chapterId) => (chapterId ? (chapterName.get(chapterId) ?? null) : null),
      tables.logs,
      evaluation,
    );
    ordered = ranking.ordered;
    examInfoByCardId = ranking.infoByCardId;
  } else {
    ordered = priorityOrder(scope, effectivePool, tables, random);
  }

  const questions: QuizQuestionInstance[] = [];
  let counter = 0;
  for (const card of ordered) {
    if (questions.length >= options.count) break;
    const chosenFormat = resolveFormat(requestedFormat, random);
    let content = chosenFormat === 'qcm' ? buildQcmContent(card, allCards, random) : buildVfContent(card, allCards, random);
    // En format mixte, un QCM impossible à compléter ne fait pas perdre la
    // carte : le vrai/faux se construit toujours avec les mêmes données.
    if (!content && requestedFormat === 'mixed') content = buildVfContent(card, allCards, random);
    if (!content) continue;

    counter += 1;
    questions.push({
      id: `quiz_${card.id}_${counter}`,
      cardId: card.id,
      subjectId: card.subjectId,
      subjectName: subjectName.get(card.subjectId) ?? 'Matière',
      chapterId: card.chapterId,
      chapterName: card.chapterId ? (chapterName.get(card.chapterId) ?? null) : null,
      difficulty: card.difficulty,
      masteryContext: buildMasteryContext(card),
      examLikelihood: examInfoByCardId?.get(card.id)?.info ?? null,
      ...content,
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
