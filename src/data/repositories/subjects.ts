import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import { countDueCards } from './cards';
import type { Chapter, ID, Subject } from '@/types';

/**
 * Pastilles de matière — six teintes de la MÊME famille chaude que le reste de
 * l'application.
 *
 * L'ancienne première valeur était `#4F5BD5`, un indigo saturé. Comme c'est la
 * couleur proposée par défaut, la toute première matière créée portait
 * systématiquement une pastille bleu vif : la seule tache froide de l'écran.
 * La première valeur est désormais l'or de l'application ; les cinq autres
 * sont assez distinctes pour se reconnaître d'un coup d'œil, et assez
 * désaturées pour ne pas se disputer l'accent.
 *
 * Les matières déjà créées gardent la couleur enregistrée en base — ces
 * valeurs ne servent qu'aux nouvelles.
 */
export const SUBJECT_COLORS = [
  '#B8912B',
  '#4A7C52',
  '#3F7A72',
  '#8B566B',
  '#A8583A',
  '#5E6C8A',
] as const;

export async function listSubjects(): Promise<Subject[]> {
  return db.subjects.orderBy('position').toArray();
}

export async function getSubject(id: ID): Promise<Subject | undefined> {
  return db.subjects.get(id);
}

export async function createSubject(name: string, color: string): Promise<Subject> {
  const subject: Subject = {
    id: uid('sub'),
    name: name.trim(),
    color,
    createdAt: nowISO(),
    position: await db.subjects.count(),
  };
  await db.subjects.add(subject);
  return subject;
}

export async function updateSubject(id: ID, patch: Partial<Subject>): Promise<void> {
  await db.subjects.update(id, patch);
}

/**
 * Supprime une matière et TOUT ce qui en dépend, en une seule transaction.
 * Sans cela, des chapitres, chunks et cartes orphelins resteraient en base et
 * fausseraient durablement les statistiques.
 */
export async function deleteSubject(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.subjects,
      db.chapters,
      db.documents,
      db.chunks,
      db.flashcards,
      db.quizQuestions,
      db.reviewLogs,
      db.notes,
      db.chatMessages,
      db.calendarEvents,
    ],
    async () => {
      await Promise.all([
        db.subjects.delete(id),
        db.chapters.where('subjectId').equals(id).delete(),
        db.documents.where('subjectId').equals(id).delete(),
        db.chunks.where('subjectId').equals(id).delete(),
        db.flashcards.where('subjectId').equals(id).delete(),
        db.quizQuestions.where('subjectId').equals(id).delete(),
        db.reviewLogs.where('subjectId').equals(id).delete(),
        db.notes.where('subjectId').equals(id).delete(),
        db.chatMessages.where('subjectId').equals(id).delete(),
      ]);
      // Les événements du calendrier survivent mais perdent leur lien.
      await db.calendarEvents.where('subjectId').equals(id).modify({ subjectId: null });
    },
  );
}

export async function listChapters(subjectId: ID): Promise<Chapter[]> {
  const chapters = await db.chapters.where('subjectId').equals(subjectId).toArray();
  return chapters.sort((a, b) => a.position - b.position);
}

export async function listAllChapters(): Promise<Chapter[]> {
  return db.chapters.toArray();
}

export async function createChapter(subjectId: ID, name: string): Promise<Chapter> {
  const chapter: Chapter = {
    id: uid('chp'),
    subjectId,
    name: name.trim(),
    createdAt: nowISO(),
    position: await db.chapters.where('subjectId').equals(subjectId).count(),
  };
  await db.chapters.add(chapter);
  return chapter;
}

export async function updateChapter(id: ID, patch: Partial<Chapter>): Promise<void> {
  await db.chapters.update(id, patch);
}

export async function deleteChapter(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.chapters, db.documents, db.chunks, db.flashcards, db.quizQuestions, db.notes],
    async () => {
      await Promise.all([
        db.chapters.delete(id),
        db.documents.where('chapterId').equals(id).delete(),
        db.chunks.where('chapterId').equals(id).delete(),
      ]);
      // Cartes, questions et notes sont conservées : elles gardent une valeur
      // de révision même sans leur chapitre source.
      await Promise.all([
        db.flashcards.where('chapterId').equals(id).modify({ chapterId: null }),
        db.quizQuestions.where('chapterId').equals(id).modify({ chapterId: null }),
        db.notes.where('chapterId').equals(id).modify({ chapterId: null }),
      ]);
    },
  );
}

export interface SubjectStats {
  chapters: number;
  documents: number;
  cards: number;
  dueCards: number;
  quizQuestions: number;
}

/**
 * Compteurs d'une matière obtenus uniquement par index — aucun document n'est
 * chargé en mémoire. C'est ce qui permet au Dashboard de rester instantané même
 * avec des centaines de mégaoctets de cours.
 */
export async function getSubjectStats(subjectId: ID, now: Date = new Date()): Promise<SubjectStats> {
  const [chapters, documents, cards, dueCards, quizQuestions] = await Promise.all([
    db.chapters.where('subjectId').equals(subjectId).count(),
    db.documents.where('subjectId').equals(subjectId).count(),
    db.flashcards.where('subjectId').equals(subjectId).count(),
    // Une seule définition de « carte due » pour toute l'application : voir
    // `countDueCards`, qui écarte les cartes suspendues et enterrées.
    countDueCards(subjectId, now),
    db.quizQuestions.where('subjectId').equals(subjectId).count(),
  ]);
  return { chapters, documents, cards, dueCards, quizQuestions };
}
