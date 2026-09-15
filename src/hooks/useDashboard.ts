import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { listAllDueCards } from '@/data/repositories/cards';
import { listRecentlyOpenedDocuments, type DocumentSummary } from '@/data/repositories/documents';
import { DEFAULT_PROFILE } from '@/data/repositories/profile';
import { addDays, dayKey } from '@/lib/date';
import { normalizeAvailability, availabilityFor, busyRanges, freeMinutesRemaining } from '@/core/calendar/availability';
import { expandRecurring } from '@/core/calendar/recurrence';
import { averageMastery } from '@/core/mastery';
import {
  averageElapsedMs,
  computeDailySummary,
  computeGreeting,
  computeWeakConcepts,
  estimateSessionMinutes,
  triageDueCards,
  type DailySummary,
  type DueTriage,
  type WeakConcept,
} from '@/core/dashboard';
import type { CalendarEvent } from '@/types';

export interface UpcomingExam {
  event: CalendarEvent;
  /** Maîtrise moyenne réelle des cartes de la matière concernée — null si la matière n'a aucune carte. */
  masteryPct: number | null;
}

export interface DashboardData {
  studyWindows: { day: string; minutes: number }[] | null;
  hasAnySubject: boolean;
  greeting: string;
  dueTriage: DueTriage;
  sessionMinutes: number;
  weakConcepts: WeakConcept[];
  recentDocuments: DocumentSummary[];
  upcomingEvents: CalendarEvent[];
  nextExam: UpcomingExam | null;
  dailySummary: DailySummary;
  dailyCardGoal: number;
}

const RECENT_DOCUMENTS_SCAN = 50;

/**
 * Assemble les données de l'accueil — une seule requête réactive, purement
 * dérivée des tables réelles. Aucune valeur ici n'est calculée « pour faire
 * joli » : chaque champ retrace directement à une table Dexie.
 */
export function useDashboard(): DashboardData | undefined {
  return useLiveQuery(async () => {
    const now = new Date();
    const today = dayKey(now);

    const [
      subjects,
      dueCards,
      allCards,
      logs,
      recentDocuments,
      calendarRows,
      profile,
    ] = await Promise.all([
      db.subjects.toArray(),
      listAllDueCards(now),
      db.flashcards.toArray(),
      db.reviewLogs.toArray(),
      listRecentlyOpenedDocuments(RECENT_DOCUMENTS_SCAN),
      db.calendarEvents.toArray(),
      db.profile.get('me'),
    ]);

    const dueTriage = triageDueCards(dueCards);
    const cardLogs = logs.filter((log) => log.itemKind === 'card');
    const sessionMinutes = estimateSessionMinutes(dueTriage.total, averageElapsedMs(cardLogs));
    const weakConcepts = computeWeakConcepts(allCards, logs, now);

    const todayLogs = logs.filter((log) => log.day === today);
    const documentsOpenedToday = recentDocuments.filter(
      (doc) => doc.lastOpenedAt !== null && dayKey(new Date(doc.lastOpenedAt)) === today,
    ).length;
    const dailySummary = computeDailySummary(todayLogs, documentsOpenedToday);

    const greeting = computeGreeting({
      totalDue: dueTriage.total,
      atRisk: dueTriage.atRisk,
      weakCount: weakConcepts.length,
    });

    const upcomingEvents = expandRecurring(calendarRows, today, dayKey(addDays(now, 400))).sort((a, b) => a.day.localeCompare(b.day));
    const availability = profile?.availability ? normalizeAvailability(profile.availability) : null;
    const studyWindows = availability ? Array.from({ length: 7 }, (_, offset) => {
      const day = dayKey(addDays(now, offset));
      return { day, minutes: freeMinutesRemaining(availabilityFor(availability, day), busyRanges(upcomingEvents, day), offset === 0 ? now.getHours() * 60 + now.getMinutes() : 0) };
    }) : null;
    const firstExam = upcomingEvents.find((event) => event.kind === 'exam' && !event.done) ?? null;
    let nextExam: UpcomingExam | null = null;
    if (firstExam) {
      const subjectCards = firstExam.subjectId
        ? allCards.filter((card) => card.subjectId === firstExam.subjectId)
        : [];
      nextExam = {
        event: firstExam,
        masteryPct: subjectCards.some((card) => logs.some((log) => log.itemKind === 'card' && log.itemId === card.id)) ? averageMastery(subjectCards) : null,
      };
    }

    return {
      studyWindows,
      hasAnySubject: subjects.length > 0,
      greeting,
      dueTriage,
      sessionMinutes,
      weakConcepts,
      recentDocuments: recentDocuments.slice(0, 3),
      upcomingEvents: upcomingEvents.slice(0, 3),
      nextExam,
      dailySummary,
      dailyCardGoal: (profile ?? DEFAULT_PROFILE).dailyCardGoal,
    };
  }, []);
}
