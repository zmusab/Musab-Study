import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { dayKey, nowISO } from '@/lib/date';
import type {
  CalendarEvent,
  CalendarEventKind,
  DayKey,
  ID,
  Importance,
  ReviewLog,
  StudySessionStatus,
} from '@/types';

/**
 * Accès à la table `calendarEvents` du schéma v1 — la seule et unique table
 * d'événements. La page Calendrier, la page Progression et la future
 * exportation .ics lisent et écrivent exactement les mêmes lignes : il n'y a
 * pas de second système parallèle.
 *
 * Les libellés et les genres qui comptent comme évaluation vivent dans
 * `core/progress/exam.ts`, avec le calcul qui s'en sert.
 */

export interface EventDraft {
  title: string;
  kind: CalendarEventKind;
  day: DayKey;
  subjectId: ID | null;
  chapterId?: ID | null;
  startTime?: string | null;
  endTime?: string | null;
  importance?: Importance;
  notes?: string;
  planForEventId?: ID | null;
}

export async function createEvent(draft: EventDraft): Promise<CalendarEvent> {
  const event: CalendarEvent = {
    id: uid('evt'),
    title: draft.title.trim(),
    kind: draft.kind,
    day: draft.day,
    startTime: draft.startTime ?? null,
    endTime: draft.endTime ?? null,
    subjectId: draft.subjectId,
    chapterId: draft.chapterId ?? null,
    importance: draft.importance ?? 2,
    status: 'planned',
    startedAt: null,
    completedAt: null,
    planForEventId: draft.planForEventId ?? null,
    notes: draft.notes?.trim() ?? '',
    done: false,
    createdAt: nowISO(),
  };
  await db.calendarEvents.add(event);
  return event;
}

/** Création en lot — utilisée par le plan de révision, en une transaction. */
export async function createEvents(drafts: readonly EventDraft[]): Promise<CalendarEvent[]> {
  const events = drafts.map((draft) => ({
    id: uid('evt'),
    title: draft.title.trim(),
    kind: draft.kind,
    day: draft.day,
    startTime: draft.startTime ?? null,
    endTime: draft.endTime ?? null,
    subjectId: draft.subjectId,
    chapterId: draft.chapterId ?? null,
    importance: draft.importance ?? 2,
    status: 'planned' as StudySessionStatus,
    startedAt: null,
    completedAt: null,
    planForEventId: draft.planForEventId ?? null,
    notes: draft.notes?.trim() ?? '',
    done: false,
    createdAt: nowISO(),
  }));
  await db.calendarEvents.bulkAdd(events);
  return events;
}

export async function updateEvent(id: ID, patch: Partial<Omit<CalendarEvent, 'id'>>): Promise<void> {
  await db.calendarEvents.update(id, patch);
}

export async function deleteEvent(id: ID): Promise<void> {
  await db.calendarEvents.delete(id);
}

/** Supprime toutes les séances rattachées à un examen — quand on refait un plan. */
export async function deletePlanFor(eventId: ID): Promise<number> {
  const planned = await db.calendarEvents.filter((event) => event.planForEventId === eventId).toArray();
  await db.calendarEvents.bulkDelete(planned.map((event) => event.id));
  return planned.length;
}

// ────────────────────────────── Cycle de vie d'une séance ──────────────────────────────

export async function startSession(id: ID, now: Date = new Date()): Promise<void> {
  await db.calendarEvents.update(id, { status: 'started', startedAt: now.toISOString(), done: false });
}

/**
 * Plafond de durée d'une séance chronométrée. Une séance laissée ouverte
 * jusqu'au lendemain n'est pas dix-huit heures de travail : le plafond ne
 * peut que RÉDUIRE ce qui est déclaré, jamais l'augmenter. Sous-estimer vaut
 * mieux que gonfler un total hebdomadaire avec un oubli.
 */
export const SESSION_MAX_MS = 4 * 60 * 60 * 1000;

export interface SessionCompletion {
  /** Durée réellement retenue, en millisecondes. */
  elapsedMs: number;
  /** Vrai quand le plafond a tronqué la mesure — l'interface le dit. */
  capped: boolean;
}

/**
 * Termine une séance et JOURNALISE le temps réellement écoulé entre
 * « Commencer » et « Terminer », mesuré par l'application.
 *
 * La ligne va dans `reviewLogs`, la table qui alimente déjà le temps d'étude,
 * la régularité et l'activité — donc aucune donnée parallèle. Son
 * `itemKind: 'session'` la distingue d'une réponse à une carte : les
 * statistiques qui comptent des RÉPONSES (taux de réussite, volume) l'excluent
 * explicitement, celles qui comptent du TEMPS l'incluent.
 *
 * Une séance jamais démarrée n'écrit rien : on ne peut pas mesurer une durée
 * qu'on n'a pas observée.
 */
export async function completeSession(id: ID, now: Date = new Date()): Promise<SessionCompletion | null> {
  return db.transaction('rw', [db.calendarEvents, db.reviewLogs], async () => {
    const event = await db.calendarEvents.get(id);
    if (!event) return null;

    await db.calendarEvents.update(id, {
      status: 'done',
      done: true,
      completedAt: now.toISOString(),
    });

    if (!event.startedAt) return null;
    const raw = now.getTime() - new Date(event.startedAt).getTime();
    if (raw <= 0) return null;
    const elapsedMs = Math.min(raw, SESSION_MAX_MS);

    const log: ReviewLog = {
      id: uid('rev'),
      subjectId: event.subjectId ?? '',
      chapterId: event.chapterId ?? null,
      itemId: event.id,
      itemKind: 'session',
      at: now.toISOString(),
      day: dayKey(now),
      // Une séance n'est ni juste ni fausse : `correct` n'a pas de sens ici et
      // n'est jamais lu pour ce genre (voir `answerStats`).
      correct: true,
      rating: null,
      confidence: null,
      elapsedMs,
    };
    await db.reviewLogs.add(log);
    return { elapsedMs, capped: raw > SESSION_MAX_MS };
  });
}

/** Annule le démarrage d'une séance — sans rien journaliser. */
export async function resetSession(id: ID): Promise<void> {
  await db.calendarEvents.update(id, {
    status: 'planned',
    startedAt: null,
    completedAt: null,
    done: false,
  });
}
