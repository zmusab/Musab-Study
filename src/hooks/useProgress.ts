import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { DEFAULT_PROFILE } from '@/data/repositories/profile';
import type { ProgressGoals, ProgressTables } from '@/core/progress/view';

/**
 * Charge, en UNE requête réactive, les seules tables dont « Progression » a
 * besoin. Aucun calcul ici : l'agrégation est faite par `progressView`, une
 * fonction pure que la page mémorise. Changer de matière ou de période ne
 * relit donc jamais la base.
 *
 * `loadedAt` fige l'instant de référence du calcul : sans lui, un `new Date()`
 * dans le rendu changerait à chaque image et invaliderait toutes les
 * mémorisations en aval.
 */
export interface ProgressSource {
  tables: ProgressTables;
  goals: ProgressGoals;
  loadedAt: number;
}

export function useProgress(): ProgressSource | undefined {
  return useLiveQuery(async () => {
    const [subjects, chapters, cards, logs, events, storedProfile] = await Promise.all([
      db.subjects.orderBy('position').toArray(),
      db.chapters.toArray(),
      db.flashcards.toArray(),
      db.reviewLogs.toArray(),
      // Le calendrier est lu en entier : la table ne contient que des
      // événements saisis à la main, elle reste petite, et « Progression » a
      // besoin des dates passées comme futures pour ne rien manquer.
      db.calendarEvents.toArray(),
      db.profile.get('me'),
    ]);
    const profile = { ...DEFAULT_PROFILE, ...storedProfile };
    return {
      tables: { subjects, chapters, cards, logs, events },
      goals: {
        weeklyStudyMinutes: profile.weeklyStudyMinutesGoal,
        weeklyReviews: profile.weeklyReviewGoal,
      },
      loadedAt: Date.now(),
    };
  }, []);
}
