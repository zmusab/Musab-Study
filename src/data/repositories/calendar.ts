import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { dayKey, nowISO } from '@/lib/date';
import { occurrenceDays, parseOccurrenceId } from '@/core/calendar/recurrence';
import type {
  CalendarEvent,
  CalendarEventKind,
  DayKey,
  ID,
  Importance,
  Recurrence,
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
  /** Cours universitaires uniquement. */
  room?: string | null;
  teacher?: string | null;
  recurrence?: Recurrence | null;
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
    room: draft.room?.trim() || null,
    teacher: draft.teacher?.trim() || null,
    recurrence: draft.recurrence ?? null,
    seriesId: null,
    occurrenceDay: null,
    cancelled: false,
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
    room: draft.room?.trim() || null,
    teacher: draft.teacher?.trim() || null,
    recurrence: draft.recurrence ?? null,
    seriesId: null,
    occurrenceDay: null,
    cancelled: false,
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

// ──────────────────────────── Séries récurrentes ────────────────────────────

/**
 * Portée d'une modification ou d'une suppression sur un cours récurrent.
 *
 * `'following'` scinde la série en deux : l'ancienne s'arrête la veille, une
 * nouvelle reprend à partir du jour visé. Les occurrences PASSÉES restent donc
 * telles qu'elles ont eu lieu — on ne réécrit pas l'histoire d'un semestre
 * parce qu'un horaire change en cours de route.
 */
export type SeriesScope = 'occurrence' | 'following' | 'series';

/** Champs qu'une modification d'un événement récurrent peut toucher. */
export type RecurringPatch = Partial<
  Pick<
    CalendarEvent,
    | 'title'
    | 'subjectId'
    | 'chapterId'
    | 'startTime'
    | 'endTime'
    | 'room'
    | 'teacher'
    | 'notes'
    | 'day'
  >
> & { recurrence?: Recurrence | null };

/** Retrouve la ligne SÉRIE dont dépend un événement, s'il y en a une. */
async function seriesMasterOf(event: CalendarEvent): Promise<CalendarEvent | null> {
  const id = event.seriesId ?? (event.recurrence ? event.id : null);
  if (id === null) return null;
  return (await db.calendarEvents.get(id)) ?? null;
}

const previousDay = (day: DayKey): DayKey => {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return dayKey(date);
};

/**
 * Modifie un événement récurrent selon la portée demandée.
 *
 * - `occurrence` : écrit (ou met à jour) une EXCEPTION pour ce jour-là. La
 *   série n'est pas touchée.
 * - `following`  : borne la série à la veille et en crée une nouvelle à partir
 *   de ce jour, avec les nouvelles valeurs.
 * - `series`     : modifie la définition elle-même. Les exceptions déjà posées
 *   sur des occurrences précises sont conservées : ce sont des choix
 *   explicites, ce n'est pas au code de les effacer.
 *
 * Un événement ponctuel (sans série) est simplement mis à jour.
 */
export async function updateRecurringEvent(
  event: CalendarEvent,
  patch: RecurringPatch,
  scope: SeriesScope = 'occurrence',
): Promise<void> {
  const master = await seriesMasterOf(event);
  if (master === null) {
    await db.calendarEvents.update(event.id, patch);
    return;
  }

  const day = event.occurrenceDay ?? parseOccurrenceId(event.id)?.day ?? event.day;

  if (scope === 'series') {
    await db.calendarEvents.update(master.id, patch);
    return;
  }

  if (scope === 'occurrence') {
    const existing = await db.calendarEvents
      .filter((row) => row.seriesId === master.id && (row.occurrenceDay ?? row.day) === day)
      .first();
    if (existing) {
      await db.calendarEvents.update(existing.id, { ...patch, cancelled: false });
      return;
    }
    await db.calendarEvents.add({
      ...master,
      ...patch,
      id: uid('evt'),
      day: patch.day ?? day,
      recurrence: null,
      seriesId: master.id,
      occurrenceDay: day,
      cancelled: false,
      createdAt: nowISO(),
    });
    return;
  }

  // `following` — scinder la série.
  const recurrence = master.recurrence!;
  if (day <= recurrence.startDay) {
    // Il n'y a rien avant : modifier la série entière revient au même, et
    // évite de laisser derrière soi une série vide.
    await db.calendarEvents.update(master.id, patch);
    return;
  }

  await db.transaction('rw', db.calendarEvents, async () => {
    await db.calendarEvents.update(master.id, {
      recurrence: { ...recurrence, endDay: previousDay(day) },
    });
    // Les exceptions posées sur la partie détachée appartenaient à l'ancienne
    // définition : elles ne veulent plus rien dire pour la nouvelle.
    const orphans = await db.calendarEvents
      .filter((row) => row.seriesId === master.id && (row.occurrenceDay ?? row.day) >= day)
      .toArray();
    await db.calendarEvents.bulkDelete(orphans.map((row) => row.id));

    await db.calendarEvents.add({
      ...master,
      ...patch,
      id: uid('evt'),
      day,
      recurrence: {
        ...(patch.recurrence ?? recurrence),
        startDay: day,
        endDay: (patch.recurrence ?? recurrence).endDay,
      },
      seriesId: null,
      occurrenceDay: null,
      cancelled: false,
      createdAt: nowISO(),
    });
  });
}

/**
 * Supprime un événement récurrent selon la même portée.
 *
 * Aucune de ces opérations ne touche une séance d'étude terminée ni
 * `reviewLogs` : supprimer une série ne réécrit jamais le travail déjà fait.
 */
export async function deleteRecurringEvent(
  event: CalendarEvent,
  scope: SeriesScope = 'occurrence',
): Promise<void> {
  const master = await seriesMasterOf(event);
  if (master === null) {
    await db.calendarEvents.delete(event.id);
    return;
  }

  const day = event.occurrenceDay ?? parseOccurrenceId(event.id)?.day ?? event.day;

  if (scope === 'series') {
    await db.transaction('rw', db.calendarEvents, async () => {
      const exceptions = await db.calendarEvents.filter((row) => row.seriesId === master.id).toArray();
      await db.calendarEvents.bulkDelete([master.id, ...exceptions.map((row) => row.id)]);
    });
    return;
  }

  if (scope === 'occurrence') {
    const existing = await db.calendarEvents
      .filter((row) => row.seriesId === master.id && (row.occurrenceDay ?? row.day) === day)
      .first();
    if (existing) {
      await db.calendarEvents.update(existing.id, { cancelled: true });
      return;
    }
    // Une occurrence supprimée est une exception « annulée » : la série reste
    // intacte, seul ce jour-là disparaît.
    await db.calendarEvents.add({
      ...master,
      id: uid('evt'),
      day,
      recurrence: null,
      seriesId: master.id,
      occurrenceDay: day,
      cancelled: true,
      createdAt: nowISO(),
    });
    return;
  }

  // `following` — la série s'arrête la veille ; le passé est conservé.
  const recurrence = master.recurrence!;
  await db.transaction('rw', db.calendarEvents, async () => {
    if (day <= recurrence.startDay) {
      const exceptions = await db.calendarEvents.filter((row) => row.seriesId === master.id).toArray();
      await db.calendarEvents.bulkDelete([master.id, ...exceptions.map((row) => row.id)]);
      return;
    }
    await db.calendarEvents.update(master.id, {
      recurrence: { ...recurrence, endDay: previousDay(day) },
    });
    const orphans = await db.calendarEvents
      .filter((row) => row.seriesId === master.id && (row.occurrenceDay ?? row.day) >= day)
      .toArray();
    await db.calendarEvents.bulkDelete(orphans.map((row) => row.id));
  });
}

/** Nombre d'occurrences d'une série sur une fenêtre — sert aux confirmations. */
export function countOccurrences(master: CalendarEvent, from: DayKey, to: DayKey): number {
  return master.recurrence ? occurrenceDays(master.recurrence, from, to).length : 0;
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
