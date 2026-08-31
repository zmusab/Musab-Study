import Dexie from 'dexie';
import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { dayKey } from '@/lib/date';
import { buildDueQueue, initialSchedulingState, scheduleNext } from '@/core/srs';
import type { Confidence, Flashcard, ID, Rating, ReviewLog } from '@/types';

export type NewFlashcard = Pick<Flashcard, 'subjectId' | 'chapterId' | 'question' | 'answer'> &
  Partial<Pick<Flashcard, 'importance' | 'difficulty' | 'origin' | 'sourceChunkIds'>>;

export function buildFlashcard(input: NewFlashcard, now: Date = new Date()): Flashcard {
  return {
    id: uid('crd'),
    subjectId: input.subjectId,
    chapterId: input.chapterId,
    question: input.question.trim(),
    answer: input.answer.trim(),
    importance: input.importance ?? 2,
    difficulty: input.difficulty ?? 2,
    origin: input.origin ?? 'manual',
    sourceChunkIds: input.sourceChunkIds ?? [],
    createdAt: now.toISOString(),
    ...initialSchedulingState(now),
  };
}

export async function createFlashcard(input: NewFlashcard): Promise<Flashcard> {
  const card = buildFlashcard(input);
  await db.flashcards.add(card);
  return card;
}

export async function createFlashcards(inputs: NewFlashcard[]): Promise<Flashcard[]> {
  const cards = inputs.map((input) => buildFlashcard(input));
  await db.flashcards.bulkAdd(cards);
  return cards;
}

export async function listCards(subjectId: ID): Promise<Flashcard[]> {
  return db.flashcards.where('subjectId').equals(subjectId).toArray();
}

export async function getCard(id: ID): Promise<Flashcard | undefined> {
  return db.flashcards.get(id);
}

export async function updateCard(id: ID, patch: Partial<Flashcard>): Promise<void> {
  await db.flashcards.update(id, patch);
}

export async function deleteCard(id: ID): Promise<void> {
  await db.transaction('rw', [db.flashcards, db.reviewLogs], async () => {
    await db.flashcards.delete(id);
    await db.reviewLogs.where('itemId').equals(id).delete();
  });
}

/**
 * Cartes dues d'une matière, via l'index composé — sans tout charger.
 *
 * Les deux `true` finaux rendent les bornes INCLUSIVES. Dexie exclut la borne
 * haute par défaut : sans cela, une carte dont l'échéance tombe exactement à
 * l'instant de la requête — c'est le cas de TOUTE carte fraîchement créée —
 * n'apparaîtrait jamais dans la file de révision.
 */
export async function listDueCards(subjectId: ID, now: Date = new Date()): Promise<Flashcard[]> {
  const cards = await db.flashcards
    .where('[subjectId+due]')
    .between([subjectId, Dexie.minKey], [subjectId, now.toISOString()], true, true)
    .toArray();
  return buildDueQueue(cards, now);
}

export async function countDueCards(subjectId: ID, now: Date = new Date()): Promise<number> {
  return db.flashcards
    .where('[subjectId+due]')
    .between([subjectId, Dexie.minKey], [subjectId, now.toISOString()], true, true)
    .count();
}

export async function countAllDueCards(now: Date = new Date()): Promise<number> {
  return db.flashcards.where('due').belowOrEqual(now.toISOString()).count();
}

/** Cartes dues de TOUTES les matières, pour une session de révision globale. */
export async function listAllDueCards(now: Date = new Date()): Promise<Flashcard[]> {
  const cards = await db.flashcards.where('due').belowOrEqual(now.toISOString()).toArray();
  return buildDueQueue(cards, now);
}

/**
 * Enregistre une réponse : met à jour la planification de la carte ET journalise
 * la révision, atomiquement. Une planification avancée sans trace dans le
 * journal fausserait définitivement les statistiques de progression.
 */
export async function reviewCard(
  cardId: ID,
  rating: Rating,
  confidence: Confidence,
  elapsedMs: number,
  now: Date = new Date(),
): Promise<Flashcard> {
  return db.transaction('rw', [db.flashcards, db.reviewLogs], async () => {
    const card = await db.flashcards.get(cardId);
    if (!card) throw new Error(`Carte introuvable : ${cardId}`);

    const scheduling = scheduleNext(card, rating, confidence, now);
    const updated: Flashcard = { ...card, ...scheduling };

    const log: ReviewLog = {
      id: uid('rev'),
      subjectId: card.subjectId,
      chapterId: card.chapterId,
      itemId: card.id,
      itemKind: 'card',
      at: now.toISOString(),
      day: dayKey(now),
      correct: rating >= 2,
      rating,
      confidence,
      elapsedMs,
    };

    await db.flashcards.put(updated);
    await db.reviewLogs.add(log);
    return updated;
  });
}

export async function logReview(log: Omit<ReviewLog, 'id'>): Promise<void> {
  await db.reviewLogs.add({ ...log, id: uid('rev') });
}

export async function listReviewLogs(subjectId?: ID): Promise<ReviewLog[]> {
  if (subjectId) return db.reviewLogs.where('subjectId').equals(subjectId).toArray();
  return db.reviewLogs.toArray();
}
