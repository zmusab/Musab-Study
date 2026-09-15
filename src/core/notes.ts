import type { ID, Note } from '@/types';

/**
 * NOTES — recherche, filtres, tri : de la logique pure, sans I/O.
 *
 * Les mêmes fonctions servent la page Notes (liste complète) et, plus tard,
 * tout autre écran qui voudrait retrouver des notes (matière, chapitre) sans
 * dupliquer la règle de tri ou de correspondance.
 */

export interface NoteFilter {
  /** Recherche texte libre — titre ET contenu, insensible à la casse. */
  search: string;
  subjectId: ID | null;
  chapterId: ID | null;
}

export const EMPTY_NOTE_FILTER: NoteFilter = { search: '', subjectId: null, chapterId: null };

/** Filtre par matière, chapitre, et texte libre (titre ou contenu). */
export function filterNotes(notes: readonly Note[], filter: NoteFilter): Note[] {
  const term = filter.search.trim().toLowerCase();
  return notes.filter((note) => {
    if (filter.subjectId && note.subjectId !== filter.subjectId) return false;
    if (filter.chapterId && note.chapterId !== filter.chapterId) return false;
    if (term.length === 0) return true;
    return note.title.toLowerCase().includes(term) || note.text.toLowerCase().includes(term);
  });
}

/** Les plus récemment modifiées en premier — seul ordre proposé, volontairement. */
export function sortNotesByRecent(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Aperçu tronqué du contenu, pour une carte de liste — jamais le texte entier. */
export function noteExcerpt(text: string, maxLength = 160): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}
