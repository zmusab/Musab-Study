import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { itemHistory } from '@/core/mastery';
import type { Flashcard, ID } from '@/types';

export function useFlashcards(subjectId: ID | undefined): Flashcard[] | undefined {
  return useLiveQuery(async () => {
    if (!subjectId) return [];
    return db.flashcards.where('subjectId').equals(subjectId).toArray();
  }, [subjectId]);
}

/** Historique de révision d'une carte, recalculé dès que le journal change. */
export function useCardHistory(cardId: ID | undefined) {
  return useLiveQuery(async () => {
    if (!cardId) return itemHistory([], '');
    const logs = await db.reviewLogs.where('itemId').equals(cardId).toArray();
    return itemHistory(logs, cardId);
  }, [cardId]);
}
