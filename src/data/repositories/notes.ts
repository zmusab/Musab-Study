import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import type { ID, Note } from '@/types';

export interface NewNote {
  subjectId: ID;
  chapterId: ID | null;
  /** Document et page d'où la note est prise — null pour une note générale. */
  documentId?: ID | null;
  page?: number | null;
  title: string;
  text: string;
}

export async function createNote(input: NewNote): Promise<Note> {
  const now = nowISO();
  const note: Note = {
    id: uid('note'),
    subjectId: input.subjectId,
    chapterId: input.chapterId,
    documentId: input.documentId ?? null,
    page: input.page ?? null,
    title: input.title.trim() || 'Note sans titre',
    text: input.text.trim(),
    createdAt: now,
    updatedAt: now,
  };
  await db.notes.add(note);
  return note;
}

export async function updateNote(id: ID, patch: Partial<Pick<Note, 'title' | 'text'>>): Promise<void> {
  await db.notes.update(id, { ...patch, updatedAt: nowISO() });
}

export async function deleteNote(id: ID): Promise<void> {
  await db.notes.delete(id);
}

export async function getNote(id: ID): Promise<Note | undefined> {
  return db.notes.get(id);
}

/** Notes prises depuis un document précis, triées par page puis par date. */
export async function listNotesForDocument(documentId: ID): Promise<Note[]> {
  const notes = await db.notes.where('documentId').equals(documentId).toArray();
  return notes.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.createdAt.localeCompare(b.createdAt));
}

export async function countNotesForDocument(documentId: ID): Promise<number> {
  return db.notes.where('documentId').equals(documentId).count();
}

/** Toutes les notes d'une matière, les plus récentes en premier. */
export async function listNotesForSubject(subjectId: ID): Promise<Note[]> {
  const notes = await db.notes.where('subjectId').equals(subjectId).toArray();
  return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
