import { describe, it, expect } from 'vitest';
import { findLocalAnswer } from '@/services/local/localAnswer';
import type { ScoredChunk, ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk } from '@/types';

/**
 * `findLocalAnswer` — répondre à une question libre sans IA, en réutilisant
 * `relationExtraction.ts` (même moteur que les flashcards/notions locales)
 * et la récupération BM25 déjà calculée par ChatPage. C'est le correctif du
 * signalement utilisateur : « Je ne comprends pas les nerfs trijumeau » +
 * Automatique ne doit JAMAIS déclencher un appel réseau si le cours répond
 * déjà à la question.
 */

function makeChunk(text: string, id = 'chk-1'): DocumentChunk {
  return {
    id,
    documentId: 'doc-1',
    chapterId: 'ch-1',
    subjectId: 'sub-1',
    index: 0,
    text,
    charStart: 0,
    charEnd: text.length,
    pageStart: 42,
    pageEnd: 42,
    termFreq: {},
    tokenCount: text.split(/\s+/).length,
    embedding: null,
  };
}

function scored(chunk: DocumentChunk): ScoredChunk {
  return { chunk, score: 1, matchedTerms: [] };
}

const LOOKUP: ContextLookup = {
  subjects: new Map([['sub-1', { id: 'sub-1', name: 'Anatomie', color: '#000', createdAt: '', position: 0 }]]),
  chapters: new Map([['ch-1', { id: 'ch-1', subjectId: 'sub-1', name: 'Nerfs crâniens', createdAt: '', position: 0 }]]),
  documents: new Map([['doc-1', { id: 'doc-1', name: 'Cours.pdf' }]]),
};

describe('findLocalAnswer', () => {
  it("répond localement à la question exacte du signalement utilisateur", () => {
    const chunk = makeChunk('Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.');
    const answer = findLocalAnswer('Je ne comprends pas les nerfs trijumeau', [scored(chunk)], LOOKUP);
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('trois branches');
    expect(answer!.citations).toHaveLength(1);
    expect(chunk.text.includes(answer!.citations[0]!.excerpt)).toBe(true);
    expect(answer!.citations[0]!.page).toBe(42);
  });

  it('renvoie null quand aucun sujet détecté ne recoupe la question — jamais une invention', () => {
    const chunk = makeChunk('La glande parotide produit une grande partie de la salive.');
    expect(findLocalAnswer('Explique-moi la circulation sanguine', [scored(chunk)], LOOKUP)).toBeNull();
  });

  it('renvoie null sur une question vide', () => {
    const chunk = makeChunk('Le nerf trijumeau possède trois branches.');
    expect(findLocalAnswer('', [scored(chunk)], LOOKUP)).toBeNull();
  });

  it('renvoie null si aucun chunk ne contient de fait exploitable', () => {
    const chunk = makeChunk('Un patient se présente pour une consultation de routine.');
    expect(findLocalAnswer('Parle-moi du patient', [scored(chunk)], LOOKUP)).toBeNull();
  });

  it("n'inclut jamais un fait issu d'une négation ambiguë ou d'une exception", () => {
    const chunk = makeChunk(
      'Tous les nerfs crâniens sont pairs, sauf le nerf trochléaire dans certaines classifications.',
    );
    expect(findLocalAnswer('Les nerfs crâniens sont-ils pairs ?', [scored(chunk)], LOOKUP)).toBeNull();
  });

  it('assemble plusieurs faits pertinents sur le même sujet, chacun un extrait exact', () => {
    const chunk = makeChunk(
      'Le nerf trijumeau est le plus volumineux des nerfs crâniens. ' +
        'Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.',
    );
    const answer = findLocalAnswer('nerf trijumeau', [scored(chunk)], LOOKUP);
    expect(answer).not.toBeNull();
    const parts = answer!.text.split('\n\n');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const part of parts) expect(chunk.text.includes(part)).toBe(true);
  });

  it('ne répète pas deux fois le même extrait entre plusieurs fragments qui se recouvrent', () => {
    const text = 'Le nerf facial commande les muscles de la mimique faciale.';
    const chunkA = makeChunk(text, 'chk-a');
    const chunkB = makeChunk(text, 'chk-b');
    const answer = findLocalAnswer('nerf facial', [scored(chunkA), scored(chunkB)], LOOKUP);
    expect(answer).not.toBeNull();
    expect(answer!.text.split('\n\n')).toHaveLength(1);
  });
});
