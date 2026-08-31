import { describe, it, expect } from 'vitest';
import { bm25Retriever, buildContext, type ContextLookup } from '@/services/rag/retrieval';
import { chunkDocument } from '@/services/rag/chunking';
import type { Chapter, DocumentChunk, StudyDocument, Subject } from '@/types';

function makeChunks(documentId: string, text: string): DocumentChunk[] {
  return chunkDocument(text).map((chunk, index) => ({
    id: `${documentId}-c${index}`,
    documentId,
    chapterId: 'ch1',
    subjectId: 's1',
    index: chunk.index,
    text: chunk.text,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    termFreq: chunk.termFreq,
    tokenCount: chunk.tokenCount,
    embedding: null,
  }));
}

const MASSETER = makeChunks(
  'doc-masseter',
  "Le muscle masséter est un muscle masticateur puissant. Il s'insère sur l'arcade zygomatique et sur l'angle de la mandibule. Son innervation est assurée par le nerf massétérique, une branche du nerf mandibulaire V3, lui-même issu du nerf trijumeau.",
);

const HISTOLOGIE = makeChunks(
  'doc-histo',
  "L'émail dentaire est le tissu le plus minéralisé de l'organisme. Il est composé à 96 % d'hydroxyapatite. La dentine se situe sous l'émail et contient des tubuli dentinaires.",
);

const ALL = [...MASSETER, ...HISTOLOGIE];

describe('bm25Retriever', () => {
  it('ne renvoie rien sans fragment', () => {
    expect(bm25Retriever.retrieve('masséter', [], 5)).toEqual([]);
  });

  it('ne renvoie rien pour une question sans terme significatif', () => {
    expect(bm25Retriever.retrieve('de la le', ALL, 5)).toEqual([]);
  });

  it('classe en tête le fragment qui traite réellement du sujet', () => {
    const results = bm25Retriever.retrieve("Quelle est l'innervation du masséter ?", ALL, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.chunk.documentId).toBe('doc-masseter');
  });

  it('ignore les accents de la question', () => {
    const withAccent = bm25Retriever.retrieve('innervation du masséter', ALL, 3);
    const without = bm25Retriever.retrieve('innervation du masseter', ALL, 3);
    expect(without[0]?.chunk.id).toBe(withAccent[0]?.chunk.id);
  });

  it('retrouve un fragment par un terme court de nomenclature', () => {
    // Régression du prototype : « V3 » était filtré et devenait introuvable.
    const results = bm25Retriever.retrieve('V3', ALL, 5);
    expect(results[0]!.chunk.documentId).toBe('doc-masseter');
    expect(results[0]!.matchedTerms).toContain('v3');
  });

  it('ne renvoie aucun fragment pour un sujet absent des cours', () => {
    // Ce cas est le pivot de la garantie anti-hallucination : sans fragment,
    // le modèle ne reçoit aucun contexte et ne peut rien citer.
    expect(bm25Retriever.retrieve('cardiologie interventionnelle stent', ALL, 5)).toHaveLength(0);
  });

  it('respecte la limite demandée', () => {
    expect(bm25Retriever.retrieve('muscle dentaire émail mandibule', ALL, 1)).toHaveLength(1);
  });

  it('trie par score décroissant', () => {
    const results = bm25Retriever.retrieve('masséter mandibule émail', ALL, 10);
    const scores = results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('privilégie un terme rare sur un terme fréquent', () => {
    const rare = bm25Retriever.retrieve('massétérique', ALL, 1)[0]!;
    expect(rare.chunk.documentId).toBe('doc-masseter');
  });
});

describe('buildContext', () => {
  const lookup: ContextLookup = {
    subjects: new Map<string, Subject>([
      ['s1', { id: 's1', name: 'Anatomie', color: '#000', createdAt: '', position: 0 }],
    ]),
    chapters: new Map<string, Chapter>([
      ['ch1', { id: 'ch1', subjectId: 's1', name: 'Muscles', createdAt: '', position: 0 }],
    ]),
    documents: new Map<string, Pick<StudyDocument, 'id' | 'name'>>([
      ['doc-masseter', { id: 'doc-masseter', name: 'Masséter.pdf' }],
      ['doc-histo', { id: 'doc-histo', name: 'Histologie.pdf' }],
    ]),
  };

  it('produit un contexte vide quand rien n’est trouvé', () => {
    const context = buildContext([], lookup);
    expect(context.text).toBe('');
    expect(context.sources).toEqual([]);
  });

  it('étiquette chaque fragment d’une référence citable', () => {
    const scored = bm25Retriever.retrieve('innervation masséter', ALL, 3);
    const context = buildContext(scored, lookup);
    expect(context.sources[0]!.ref).toBe('S1');
    expect(context.text).toContain('[S1]');
    expect(context.text).toContain('Anatomie › Muscles › Masséter.pdf');
  });

  it('ne référence QUE des fragments réellement transmis', () => {
    // Le cœur de la garantie : autant de sources que de fragments inclus,
    // jamais plus. Une citation ne peut donc pas désigner un passage absent.
    const scored = bm25Retriever.retrieve('masséter mandibule émail dentine', ALL, 10);
    const context = buildContext(scored, lookup);
    for (const source of context.sources) {
      expect(context.text).toContain(`[${source.ref}]`);
      expect(scored.some((s) => s.chunk.id === source.chunkId)).toBe(true);
    }
  });

  it('respecte le budget de caractères', () => {
    const scored = bm25Retriever.retrieve('masséter mandibule émail dentine', ALL, 10);
    const context = buildContext(scored, lookup, 120);
    const total = context.sources.reduce((sum, s) => sum + s.excerpt.length, 0);
    expect(total).toBeLessThanOrEqual(120);
  });

  it('reste robuste si un document a été supprimé entre-temps', () => {
    const scored = bm25Retriever.retrieve('masséter', ALL, 2);
    const context = buildContext(scored, {
      subjects: new Map(),
      chapters: new Map(),
      documents: new Map(),
    });
    expect(context.sources[0]!.documentName).toBe('Document');
    expect(context.text).toContain('[S1]');
  });
});
