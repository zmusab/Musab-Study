import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { Chapter, DocumentChunk, StudyDocument, Subject } from '@/types';

/**
 * `analyzeChapter` (services/courses/notions.ts) réutilise EXACTEMENT le
 * mécanisme de vérification du pipeline podcast (`validateConcepts`) : ces
 * tests vérifient l'orchestration (tâche déclarée, contexte transmis,
 * refus honnête sans notion validée) sans appel réseau réel.
 */
const askMock = vi.fn();
vi.mock('@/services/ai/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/orchestrator')>('@/services/ai/orchestrator');
  return {
    ...actual,
    aiOrchestrator: { ...actual.aiOrchestrator, ask: (...args: unknown[]) => askMock(...args) },
  };
});

const { analyzeChapter, InsufficientChapterContentError } = await import('@/services/courses/notions');

function makeChunk(index: number, text: string): DocumentChunk {
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
    termFreq: {},
    tokenCount: text.split(' ').length,
    embedding: null,
  };
}

const CHUNKS: DocumentChunk[] = [
  makeChunk(0, "L'émail dentaire est le tissu le plus minéralisé de l'organisme."),
];

const LOOKUP: ContextLookup = {
  subjects: new Map<string, Subject>([
    ['sub-1', { id: 'sub-1', name: 'Histologie', color: '#000', createdAt: '', position: 0 }],
  ]),
  chapters: new Map<string, Chapter>([
    ['ch-1', { id: 'ch-1', subjectId: 'sub-1', name: 'Tissus durs', createdAt: '', position: 0 }],
  ]),
  documents: new Map<string, Pick<StudyDocument, 'id' | 'name'>>([
    ['doc-1', { id: 'doc-1', name: 'Émail.pdf' }],
  ]),
};

beforeEach(() => {
  askMock.mockReset();
});

describe('analyzeChapter', () => {
  it('refuse sans le moindre fragment indexé', async () => {
    await expect(analyzeChapter({ chunks: [], lookup: LOOKUP })).rejects.toBeInstanceOf(
      InsufficientChapterContentError,
    );
    expect(askMock).not.toHaveBeenCalled();
  });

  it('déclare la tâche course-notions à l’orchestrateur', async () => {
    askMock.mockResolvedValueOnce(
      JSON.stringify([{ label: 'Composition de l’émail', importance: 3, pitfall: false, refs: ['S1'] }]),
    );
    await analyzeChapter({ chunks: CHUNKS, lookup: LOOKUP });
    expect(askMock.mock.calls[0]![0].task).toBe('course-notions');
  });

  it('valide les notions via le même mécanisme que le podcast — une notion sans citation valide est écartée', async () => {
    askMock.mockResolvedValueOnce(
      JSON.stringify([
        { label: 'Notion sourcée', importance: 3, pitfall: false, refs: ['S1'] },
        { label: 'Notion inventée', importance: 2, pitfall: false, refs: ['S9'] },
      ]),
    );
    const notions = await analyzeChapter({ chunks: CHUNKS, lookup: LOOKUP });
    expect(notions).toHaveLength(1);
    expect(notions[0]!.label).toBe('Notion sourcée');
    expect(notions[0]!.citations[0]!.page).toBe(1);
  });

  it('échoue clairement si aucune notion n’a pu être validée — jamais de liste fictive', async () => {
    askMock.mockResolvedValueOnce(JSON.stringify([{ label: 'Notion invérifiable', refs: ['S9'] }]));
    await expect(analyzeChapter({ chunks: CHUNKS, lookup: LOOKUP })).rejects.toBeInstanceOf(
      InsufficientChapterContentError,
    );
  });

  it('respecte la limite demandée', async () => {
    askMock.mockResolvedValueOnce(
      JSON.stringify(
        Array.from({ length: 5 }, (_, i) => ({ label: `Notion ${i}`, importance: 2, pitfall: false, refs: ['S1'] })),
      ),
    );
    const notions = await analyzeChapter({ chunks: CHUNKS, lookup: LOOKUP, count: 2 });
    expect(notions).toHaveLength(2);
  });
});
