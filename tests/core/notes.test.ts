import { describe, it, expect } from 'vitest';
import { filterNotes, noteExcerpt, sortNotesByRecent, EMPTY_NOTE_FILTER } from '@/core/notes';
import type { Note } from '@/types';

/**
 * Le principe testé ici : filtrer et trier des notes RÉELLEMENT enregistrées,
 * sans jamais fabriquer ou perdre une note qui devrait apparaître.
 */

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    subjectId: 's1',
    chapterId: null,
    documentId: null,
    page: null,
    title: `Note ${overrides.id}`,
    text: 'Contenu par défaut.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('filterNotes — matière, chapitre, recherche libre', () => {
  const notes: Note[] = [
    note({ id: 'n1', subjectId: 's1', chapterId: 'c1', title: 'Nerfs crâniens', text: 'Douze paires.' }),
    note({ id: 'n2', subjectId: 's1', chapterId: 'c2', title: 'Ostéologie', text: 'Os du crâne.' }),
    note({ id: 'n3', subjectId: 's2', chapterId: null, title: 'Physiologie rénale', text: 'Filtration glomérulaire.' }),
  ];

  it('sans filtre, renvoie toutes les notes', () => {
    expect(filterNotes(notes, EMPTY_NOTE_FILTER)).toHaveLength(3);
  });

  it('filtre par matière', () => {
    const result = filterNotes(notes, { ...EMPTY_NOTE_FILTER, subjectId: 's1' });
    expect(result.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
  });

  it('filtre par chapitre', () => {
    const result = filterNotes(notes, { ...EMPTY_NOTE_FILTER, chapterId: 'c1' });
    expect(result.map((n) => n.id)).toEqual(['n1']);
  });

  it('recherche dans le titre', () => {
    const result = filterNotes(notes, { ...EMPTY_NOTE_FILTER, search: 'osté' });
    expect(result.map((n) => n.id)).toEqual(['n2']);
  });

  it('recherche dans le contenu, pas seulement le titre', () => {
    const result = filterNotes(notes, { ...EMPTY_NOTE_FILTER, search: 'glomérulaire' });
    expect(result.map((n) => n.id)).toEqual(['n3']);
  });

  it('la recherche est insensible à la casse', () => {
    const result = filterNotes(notes, { ...EMPTY_NOTE_FILTER, search: 'NERFS' });
    expect(result.map((n) => n.id)).toEqual(['n1']);
  });

  it('combine matière, chapitre et recherche', () => {
    const result = filterNotes(notes, { search: 'os', subjectId: 's1', chapterId: 'c2' });
    expect(result.map((n) => n.id)).toEqual(['n2']);
  });

  it('aucune correspondance renvoie une liste vide, jamais une approximation', () => {
    expect(filterNotes(notes, { ...EMPTY_NOTE_FILTER, search: 'inexistant' })).toEqual([]);
  });
});

describe('sortNotesByRecent — la plus récemment modifiée en tête', () => {
  it('trie par updatedAt décroissant', () => {
    const notes: Note[] = [
      note({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      note({ id: 'recent', updatedAt: '2026-03-10T00:00:00.000Z' }),
      note({ id: 'middle', updatedAt: '2026-02-05T00:00:00.000Z' }),
    ];
    expect(sortNotesByRecent(notes).map((n) => n.id)).toEqual(['recent', 'middle', 'old']);
  });

  it('ne modifie pas le tableau reçu', () => {
    const notes: Note[] = [note({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }), note({ id: 'b', updatedAt: '2026-02-01T00:00:00.000Z' })];
    const original = [...notes];
    sortNotesByRecent(notes);
    expect(notes).toEqual(original);
  });
});

describe('noteExcerpt — un aperçu tronqué, jamais le texte entier', () => {
  it('renvoie le texte tel quel s’il est déjà court', () => {
    expect(noteExcerpt('Un texte court.')).toBe('Un texte court.');
  });

  it('tronque un texte long et l’indique par une ellipse', () => {
    const long = 'x'.repeat(300);
    const excerpt = noteExcerpt(long, 160);
    expect(excerpt.length).toBeLessThanOrEqual(161);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('normalise les espaces multiples et les retours à la ligne', () => {
    expect(noteExcerpt('Ligne 1\n\n\nLigne 2   avec   espaces')).toBe('Ligne 1 Ligne 2 avec espaces');
  });
});
