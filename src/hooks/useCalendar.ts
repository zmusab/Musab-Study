import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import type { CalendarEvent, Chapter, Flashcard, ReviewLog, Subject } from '@/types';

/**
 * Charge en UNE requête réactive les tables dont le calendrier a besoin.
 *
 * Aucun calcul ici : la grille, l'agrégation des cartes dues et le plan de
 * révision sont des fonctions pures de `core/calendar`, mémorisées par la
 * page. Changer de mois ou de vue ne relit donc jamais la base.
 */
export interface CalendarSource {
  events: CalendarEvent[];
  subjects: Subject[];
  chapters: Chapter[];
  cards: Flashcard[];
  logs: ReviewLog[];
  loadedAt: number;
}

export function useCalendar(): CalendarSource | undefined {
  return useLiveQuery(async () => {
    const [events, subjects, chapters, cards, logs] = await Promise.all([
      db.calendarEvents.toArray(),
      db.subjects.orderBy('position').toArray(),
      db.chapters.toArray(),
      db.flashcards.toArray(),
      db.reviewLogs.toArray(),
    ]);
    return { events, subjects, chapters, cards, logs, loadedAt: Date.now() };
  }, []);
}
