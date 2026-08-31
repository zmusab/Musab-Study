import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tokenize, termFrequencies } from '@/services/rag/tokenize';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { AnatomyStructure, Chapter, DocumentChunk, StudyDocument, Subject } from '@/types';

/**
 * `explainStructure` et `generateAnatomyCardDrafts` (services/anatomy/) ne
 * réutilisent PAS un mécanisme dédié — ils appellent directement
 * `verifyCourseAnswer`/`verifyInternetAnswer` (services/ai/tutor.ts) et
 * `validateCardDrafts` (services/flashcards/validate.ts), inchangés. Ces
 * tests vérifient que cette réutilisation fonctionne réellement pour une
 * structure anatomique : citation invalide → insuffisant, jamais de fiche
 * ou de carte inventée.
 */
const askMock = vi.fn();
vi.mock('@/services/ai/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/orchestrator')>('@/services/ai/orchestrator');
  return {
    ...actual,
    aiOrchestrator: { ...actual.aiOrchestrator, ask: (...args: unknown[]) => askMock(...args) },
  };
});

const { explainStructure } = await import('@/services/anatomy/explain');
const { generateAnatomyCardDrafts, NoStructureContentError } = await import('@/services/anatomy/flashcards');
const { INSUFFICIENT_MARKER } = await import('@/services/ai/tutor');

function makeChunk(index: number, text: string): DocumentChunk {
  const tokens = tokenize(text);
  return {
    id: `chk-${index}`,
    documentId: 'doc-1',
    chapterId: 'ch-1',
    subjectId: 'sub-1',
    index,
    text,
    charStart: 0,
    charEnd: text.length,
    pageStart: index + 1,
    pageEnd: index + 1,
    termFreq: termFrequencies(tokens),
    tokenCount: tokens.length,
    embedding: null,
  };
}

const STRUCTURE: AnatomyStructure = {
  id: 'masseter_superficiel_droit',
  name: 'Masséter (faisceau superficiel) droit',
  latinName: 'Musculus masseter pars superficialis dexter',
  category: 'muscles',
  subjectId: null,
  model3dRef: 'masseter_superficiel_droit',
  region: 'tete-et-cou',
  subregion: 'machoire',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const CHUNKS: DocumentChunk[] = [
  makeChunk(0, 'Le masséter élève la mandibule et participe à la mastication.'),
];

const LOOKUP: ContextLookup = {
  subjects: new Map<string, Subject>([
    ['sub-1', { id: 'sub-1', name: 'Anatomie céphalique', color: '#000', createdAt: '', position: 0 }],
  ]),
  chapters: new Map<string, Chapter>([
    ['ch-1', { id: 'ch-1', subjectId: 'sub-1', name: 'Muscles masticateurs', createdAt: '', position: 0 }],
  ]),
  documents: new Map<string, Pick<StudyDocument, 'id' | 'name'>>([
    ['doc-1', { id: 'doc-1', name: 'Anatomie — Tête et cou.pdf' }],
  ]),
};

beforeEach(() => {
  askMock.mockReset();
});

describe('explainStructure', () => {
  it('déclare la tâche anatomy-explain à l’orchestrateur', async () => {
    askMock.mockResolvedValueOnce('## Fonction\nÉlève la mandibule [S1].');
    await explainStructure({ structure: STRUCTURE, chunks: CHUNKS, lookup: LOOKUP, program: 'dentisterie', origin: 'course' });
    expect(askMock.mock.calls[0]![0].task).toBe('anatomy-explain');
  });

  it('retient une fiche cours correctement citée', async () => {
    askMock.mockResolvedValueOnce('## Fonction\nÉlève la mandibule [S1].');
    const result = await explainStructure({
      structure: STRUCTURE,
      chunks: CHUNKS,
      lookup: LOOKUP,
      program: 'dentisterie',
      origin: 'course',
    });
    expect(result.provenance).toBe('course');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]!.documentName).toBe('Anatomie — Tête et cou.pdf');
  });

  it('rétrograde en insuffisant quand le modèle se déclare lui-même insuffisant — jamais de fiche inventée', async () => {
    askMock.mockResolvedValueOnce(INSUFFICIENT_MARKER);
    const result = await explainStructure({
      structure: STRUCTURE,
      chunks: CHUNKS,
      lookup: LOOKUP,
      program: 'dentisterie',
      origin: 'course',
    });
    expect(result.provenance).toBe('insufficient');
  });

  it('en mode internet, ignore toute citation [Sn] hallucinée — jamais mélangée au cours', async () => {
    askMock.mockResolvedValueOnce('Le masséter est un muscle masticateur [S1].');
    const result = await explainStructure({
      structure: STRUCTURE,
      chunks: CHUNKS,
      lookup: LOOKUP,
      program: 'dentisterie',
      origin: 'internet',
    });
    expect(result.provenance).toBe('internet');
    expect(result.citations).toHaveLength(0);
    expect(result.text).not.toContain('[S1]');
  });
});

describe('generateAnatomyCardDrafts', () => {
  it('refuse sans le moindre chunk pertinent pour la structure', async () => {
    await expect(
      generateAnatomyCardDrafts({
        structure: STRUCTURE,
        chunks: [],
        lookup: LOOKUP,
        importance: 2,
        difficulty: 2,
      }),
    ).rejects.toBeInstanceOf(NoStructureContentError);
    expect(askMock).not.toHaveBeenCalled();
  });

  it('valide les cartes via le même mécanisme que la génération de flashcards standard', async () => {
    askMock.mockResolvedValueOnce(
      JSON.stringify([{ question: 'Quelle est la fonction du masséter ?', answer: 'Il élève la mandibule [S1].', refs: ['S1'] }]),
    );
    const drafts = await generateAnatomyCardDrafts({
      structure: STRUCTURE,
      chunks: CHUNKS,
      lookup: LOOKUP,
      importance: 2,
      difficulty: 2,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.citations).toHaveLength(1);
  });

  it('échoue clairement si aucune carte proposée n’a de citation valide', async () => {
    askMock.mockResolvedValueOnce(JSON.stringify([{ question: 'Q', answer: 'A [S9]', refs: ['S9'] }]));
    await expect(
      generateAnatomyCardDrafts({ structure: STRUCTURE, chunks: CHUNKS, lookup: LOOKUP, importance: 2, difficulty: 2 }),
    ).rejects.toBeInstanceOf(NoStructureContentError);
  });
});
