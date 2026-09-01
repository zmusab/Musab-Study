import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import type { CalendarEvent, CalendarEventKind, DayKey, ID } from '@/types';

/**
 * Accès à la table `calendarEvents`, déjà présente dans le schéma v1.
 *
 * La page Calendrier complète (vues jour/semaine/mois, export .ics) reste à
 * construire ; ce dépôt fournit les opérations dont « Progression » a besoin
 * pour que les évaluations soient RÉELLEMENT saisissables. Il n'y a donc pas
 * de système de données parallèle : la future page Calendrier lira et écrira
 * exactement les mêmes lignes.
 *
 * Les genres d'évaluation et leurs libellés vivent dans
 * `core/progress/exam.ts`, avec le calcul qui s'en sert.
 */

export interface EvaluationDraft {
  title: string;
  kind: CalendarEventKind;
  day: DayKey;
  subjectId: ID | null;
  notes?: string;
}

export async function createEvaluation(draft: EvaluationDraft): Promise<CalendarEvent> {
  const event: CalendarEvent = {
    id: uid('evt'),
    title: draft.title.trim(),
    kind: draft.kind,
    day: draft.day,
    startTime: null,
    endTime: null,
    subjectId: draft.subjectId,
    notes: draft.notes?.trim() ?? '',
    done: false,
    createdAt: nowISO(),
  };
  await db.calendarEvents.add(event);
  return event;
}

export async function deleteEvaluation(id: ID): Promise<void> {
  await db.calendarEvents.delete(id);
}
