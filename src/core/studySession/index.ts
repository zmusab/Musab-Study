import { rankExamPriority } from '@/core/examPriority';
import { isReviewable } from '@/core/srs';
import type { CalendarEvent, Flashcard, KnowledgeEvidence, KnowledgeFact, LearnerFactState } from '@/types';

export type SessionDuration = 10 | 20 | 30 | 45 | 60;
export type StudySessionBlockKind = 'flashcards' | 'quiz' | 'recall';

export interface StudySessionBlock {
  kind: StudySessionBlockKind;
  minutes: number;
  cardIds: string[];
  factIds: string[];
  reason: string;
}

export interface DailyStudySession {
  duration: SessionDuration;
  recommendedMinutes: number;
  dueCards: number;
  weakFacts: number;
  priorityFacts: number;
  blocks: StudySessionBlock[];
}

export interface BuildDailySessionInput {
  duration: SessionDuration;
  cards: readonly Flashcard[];
  facts: readonly KnowledgeFact[];
  evidence: readonly KnowledgeEvidence[];
  states: readonly LearnerFactState[];
  events: readonly CalendarEvent[];
  now?: Date;
}

/**
 * Construit une séquence, pas une concaténation de listes : les cartes dues
 * passent d'abord, puis les faits faibles/importants sont alternés entre quiz
 * et rappel. La session peut être interrompue ; chaque réponse continue
 * d'être enregistrée par les écrans existants.
 */
export function buildDailyStudySession(input: BuildDailySessionInput): DailyStudySession {
  const now = input.now ?? new Date();
  const due = input.cards.filter((card) => isReviewable(card, now) && card.due <= now.toISOString());
  const priority = rankExamPriority(input.facts, input.states, input.evidence, input.events, now);
  const stateByFact = new Map(input.states.map((state) => [state.factId, state]));
  const weakFactIds = priority
    .filter((row) => stateByFact.get(row.factId)?.status === 'fragile')
    .map((row) => row.factId);
  const highPriorityFactIds = priority
    .filter((row) => row.level === 'very-high' || row.level === 'high')
    .map((row) => row.factId);

  const budgetCards = Math.max(3, Math.floor(input.duration / 2));
  const dueCardIds = due
    .sort((a, b) => a.due.localeCompare(b.due) || a.reps - b.reps)
    .slice(0, budgetCards)
    .map((card) => card.id);
  let remaining = Math.max(0, input.duration - Math.max(3, Math.ceil(dueCardIds.length * 0.6)));
  const blocks: StudySessionBlock[] = [];
  if (dueCardIds.length > 0) {
    const minutes = Math.min(input.duration, Math.max(3, Math.ceil(dueCardIds.length * 0.6)));
    blocks.push({ kind: 'flashcards', minutes, cardIds: dueCardIds, factIds: [], reason: 'cartes dues par ta répétition espacée' });
    remaining -= minutes;
  }
  const weak = weakFactIds.slice(0, Math.max(2, Math.floor(remaining / 3)));
  if (weak.length > 0 && remaining >= 4) {
    const minutes = Math.min(remaining, Math.max(4, weak.length * 2));
    blocks.push({ kind: 'recall', minutes, cardIds: [], factIds: weak, reason: 'faits fragiles après tes réponses précédentes' });
    remaining -= minutes;
  }
  const quizFacts = highPriorityFactIds.filter((id) => !weak.includes(id)).slice(0, Math.max(2, Math.floor(remaining / 2)));
  if (quizFacts.length > 0 && remaining >= 3) {
    blocks.push({ kind: 'quiz', minutes: remaining, cardIds: [], factIds: quizFacts, reason: 'faits importants pour le contenu et ton urgence actuelle' });
    remaining = 0;
  }
  if (blocks.length === 0 && highPriorityFactIds.length > 0) {
    blocks.push({ kind: 'quiz', minutes: input.duration, cardIds: [], factIds: highPriorityFactIds.slice(0, Math.max(2, Math.floor(input.duration / 2))), reason: 'faits vérifiés à découvrir dans tes cours' });
  }
  return {
    duration: input.duration,
    recommendedMinutes: input.duration,
    dueCards: due.length,
    weakFacts: weakFactIds.length,
    priorityFacts: highPriorityFactIds.length,
    blocks,
  };
}

export function sessionPriorityReasons(session: DailyStudySession): string[] {
  const reasons: string[] = [];
  if (session.dueCards > 0) reasons.push(`${session.dueCards} carte${session.dueCards > 1 ? 's' : ''} due${session.dueCards > 1 ? 's' : ''}`);
  if (session.weakFacts > 0) reasons.push(`${session.weakFacts} fait${session.weakFacts > 1 ? 's' : ''} fragile${session.weakFacts > 1 ? 's' : ''}`);
  if (session.priorityFacts > 0) reasons.push(`${session.priorityFacts} fait${session.priorityFacts > 1 ? 's' : ''} prioritaire${session.priorityFacts > 1 ? 's' : ''}`);
  return reasons;
}
