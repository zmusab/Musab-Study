import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import type { ID, Note } from '@/types';

/** Notes prises depuis un document précis, triées par page — pour le panneau du lecteur PDF. */
export function useDocumentNotes(documentId: ID | undefined): Note[] | undefined {
  return useLiveQuery(async () => {
    if (!documentId) return [];
    const notes = await db.notes.where('documentId').equals(documentId).toArray();
    return notes.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.createdAt.localeCompare(b.createdAt));
  }, [documentId]);
}

/** Toutes les notes d'une matière, les plus récentes en premier — pour l'onglet Notes de la page de matière. */
export function useSubjectNotes(subjectId: ID | undefined): Note[] | undefined {
  return useLiveQuery(async () => {
    if (!subjectId) return [];
    const notes = await db.notes.where('subjectId').equals(subjectId).toArray();
    return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [subjectId]);
}

/** Toutes les notes de l'application — pour la page Notes elle-même, qui filtre/trie côté client. */
export function useAllNotes(): Note[] | undefined {
  return useLiveQuery(() => db.notes.toArray(), []);
}
