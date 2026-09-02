import { describe, it, expect } from 'vitest';
import { buildNotebookLmExportText, notebookLmExportFilename } from '@/services/notebooklm/export';
import type { Chapter, StudyDocument, Note, Subject } from '@/types';

/**
 * Aucune API NotebookLM n'existe ici — juste l'assemblage, tel quel, du
 * contenu RÉELLEMENT enregistré. Rien de résumé, reformulé ou inventé.
 */

const subject: Subject = { id: 's1', name: 'Anatomie', color: '#888', createdAt: '2026-01-01T00:00:00.000Z', position: 0 };
const chapters: Chapter[] = [{ id: 'c1', subjectId: 's1', name: 'Nerfs crâniens', createdAt: '2026-01-01T00:00:00.000Z', position: 0 }];

function document(overrides: Partial<StudyDocument> & { id: string; chapterId: string }): StudyDocument {
  return {
    subjectId: 's1',
    name: 'Doc',
    text: 'Texte du document.',
    pageOffsets: [],
    source: 'paste',
    pageCount: null,
    charCount: 0,
    thumbnail: null,
    lastReadPage: 0,
    lastOpenedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as StudyDocument;
}

function note(overrides: Partial<Note> & { id: string; chapterId: string | null }): Note {
  return {
    subjectId: 's1',
    documentId: null,
    page: null,
    title: 'Note',
    text: 'Texte de la note.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Note;
}

describe('buildNotebookLmExportText — assemble le contenu réel, sans rien inventer', () => {
  it('inclut le texte réel des documents et des notes', () => {
    const text = buildNotebookLmExportText({
      subject,
      chapters,
      documents: [document({ id: 'd1', chapterId: 'c1', name: 'Cours 1', text: 'Le trijumeau est le nerf V.' })],
      notes: [note({ id: 'n1', chapterId: 'c1', title: 'Ma note', text: 'Trois branches : V1, V2, V3.' })],
    });

    expect(text).toContain('Anatomie');
    expect(text).toContain('Nerfs crâniens');
    expect(text).toContain('Cours 1');
    expect(text).toContain('Le trijumeau est le nerf V.');
    expect(text).toContain('Ma note');
    expect(text).toContain('Trois branches : V1, V2, V3.');
  });

  it('regroupe une note sans chapitre sous « Sans chapitre », sans la perdre', () => {
    // Contrairement aux documents (toujours rattachés à un chapitre), une
    // note peut ne pas en avoir — le seul cas réel de contenu "sans chapitre".
    const text = buildNotebookLmExportText({
      subject,
      chapters,
      documents: [],
      notes: [note({ id: 'n1', chapterId: null, title: 'Note générale', text: 'Contenu général.' })],
    });
    expect(text).toContain('Sans chapitre');
    expect(text).toContain('Contenu général.');
  });

  it('sans aucun document ni note, le texte reste honnête (juste l’en-tête), jamais un contenu fabriqué', () => {
    const text = buildNotebookLmExportText({ subject, chapters, documents: [], notes: [] });
    expect(text).toContain('Anatomie');
    expect(text).not.toContain('Sans chapitre');
    expect(text).not.toContain('Nerfs crâniens');
  });
});

describe('notebookLmExportFilename — un nom de fichier sûr', () => {
  it('normalise les espaces et accents en un nom de fichier valide', () => {
    expect(notebookLmExportFilename('Anatomie')).toBe('Anatomie-notebooklm.txt');
    expect(notebookLmExportFilename('Physio Rénale !')).toBe('Physio_Rénale-notebooklm.txt');
  });

  it('un nom vide retombe sur un nom générique plutôt que de produire un fichier invalide', () => {
    expect(notebookLmExportFilename('   ')).toBe('matiere-notebooklm.txt');
  });
});
