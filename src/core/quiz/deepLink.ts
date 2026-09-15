import type { QuizDifficulty, QuizFormat, QuizScope } from './index';
import type { ID } from '@/types';

/**
 * Lien direct vers le Quiz existant — utilisé par l'Assistant IA pour
 * « Proposer des QCM », « Proposer des Vrai/Faux » et « utiliser le mode
 * Examen probable existant » (voir le cahier des charges : « Réutiliser le
 * Quiz existant. Ne pas créer un deuxième système de quiz »).
 *
 * Pur : ne fait que traduire des paramètres d'URL en `QuizScope` déjà
 * compris par `buildQuiz` — aucune génération, aucune nouvelle logique de
 * quiz. `QuizPage` lit ces paramètres au montage, démarre le quiz avec
 * EXACTEMENT le même `buildQuiz` que le formulaire manuel, puis les efface.
 */

export interface QuizDeepLinkParams {
  scope?: string | null;
  subject?: string | null;
  chapter?: string | null;
  cards?: string | null;
  evaluation?: string | null;
  format?: string | null;
  count?: string | null;
  difficulty?: string | null;
}

export interface QuizDeepLink {
  scope: QuizScope;
  format: QuizFormat;
  count: number;
  difficulty: QuizDifficulty;
}

const FORMATS: readonly QuizFormat[] = ['qcm', 'vf', 'recall', 'mixed'];
const DIFFICULTIES: readonly QuizDifficulty[] = ['easy', 'medium', 'hard', 'mixed'];
const MIN_COUNT = 3;
const MAX_COUNT = 30;
const DEFAULT_COUNT = 10;

function parseCount(raw: string | null | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, n));
}

/** `null` quand les paramètres ne décrivent pas un quiz valide — l'appelant garde alors l'écran de configuration manuel. */
export function parseQuizDeepLink(params: QuizDeepLinkParams): QuizDeepLink | null {
  const format = FORMATS.includes(params.format as QuizFormat) ? (params.format as QuizFormat) : 'mixed';
  const difficulty = DIFFICULTIES.includes(params.difficulty as QuizDifficulty)
    ? (params.difficulty as QuizDifficulty)
    : 'mixed';
  const count = parseCount(params.count);

  const subjectId = params.subject as ID | undefined;
  const chapterId = (params.chapter || null) as ID | null;

  let scope: QuizScope | null = null;
  switch (params.scope) {
    case 'subject':
      if (subjectId) scope = { kind: 'subject', subjectId };
      break;
    case 'chapter':
      if (subjectId) scope = { kind: 'chapter', subjectId, chapterId };
      break;
    case 'weak':
      scope = { kind: 'weak' };
      break;
    case 'due':
      scope = { kind: 'due' };
      break;
    case 'exam':
      if (subjectId) scope = { kind: 'exam', subjectId };
      break;
    case 'exam-likely':
      if (subjectId) {
        scope = {
          kind: 'exam-likely',
          subjectId,
          chapterIds: chapterId ? [chapterId] : [],
          evaluationEventId: (params.evaluation || null) as ID | null,
        };
      }
      break;
    case 'cards': {
      const cardIds = (params.cards ?? '').split(',').map((id) => id.trim()).filter(Boolean) as ID[];
      if (cardIds.length > 0) scope = { kind: 'cards', cardIds };
      break;
    }
    default:
      scope = null;
  }

  return scope ? { scope, format, count, difficulty } : null;
}
