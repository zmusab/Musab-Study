import { describe, it, expect } from 'vitest';
import { generateLocalCardDrafts } from '@/services/local/localFlashcards';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { Chapter, DocumentChunk, StudyDocument, Subject } from '@/types';

/**
 * `localFlashcards.ts` — génération de cartes sans IA. Vérifie que la
 * forme produite (`CardDraft`) est identique à celle du chemin IA
 * (`services/flashcards/generate.ts`), que les cartes à trous apparaissent
 * quand un compte est détecté, que la déduplication fonctionne, et
 * surtout qu'AUCUNE carte n'est jamais produite depuis une phrase à
 * négation/exception ambiguë (contrainte obligatoire).
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
    pageStart: 12,
    pageEnd: 12,
    termFreq: {},
    tokenCount: text.split(/\s+/).length,
    embedding: null,
  };
}

const LOOKUP: ContextLookup = {
  subjects: new Map<string, Subject>([
    ['sub-1', { id: 'sub-1', name: 'Anatomie', color: '#000', createdAt: '', position: 0 }],
  ]),
  chapters: new Map<string, Chapter>([
    ['ch-1', { id: 'ch-1', subjectId: 'sub-1', name: 'Nerfs crâniens', createdAt: '', position: 0 }],
  ]),
  documents: new Map<string, Pick<StudyDocument, 'id' | 'name'>>([['doc-1', { id: 'doc-1', name: 'Cours.pdf' }]]),
};

const BASE_OPTS = { importance: 2 as const, difficulty: 2 as const, existingQuestions: [] as string[] };

describe('generateLocalCardDrafts', () => {
  it('génère une carte question/réponse avec citation vérifiable, sans appel réseau', () => {
    const chunk = makeChunk('Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.');
    const drafts = generateLocalCardDrafts({ chunks: [chunk], lookup: LOOKUP, count: 10, ...BASE_OPTS });

    expect(drafts.length).toBeGreaterThan(0);
    const main = drafts.find((d) => d.answer.toLowerCase().includes('ophtalmique'));
    expect(main).toBeDefined();
    expect(main!.citations).toHaveLength(1);
    expect(main!.citations[0]!.excerpt.length).toBeGreaterThan(0);
    expect(chunk.text.includes(main!.citations[0]!.excerpt)).toBe(true);
    expect(main!.citations[0]!.page).toBe(12);
    expect(main!.citations[0]!.chapterName).toBe('Nerfs crâniens');
  });

  it('génère une carte à trous quand un compte explicite est détecté', () => {
    const chunk = makeChunk('Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.');
    const drafts = generateLocalCardDrafts({ chunks: [chunk], lookup: LOOKUP, count: 10, ...BASE_OPTS });
    const cloze = drafts.find((d) => d.question.includes('___'));
    expect(cloze).toBeDefined();
    expect(cloze!.answer).toBe('trois');
  });

  it('génère une carte de définition', () => {
    const chunk = makeChunk("L'émail dentaire est le tissu le plus minéralisé de l'organisme.");
    const drafts = generateLocalCardDrafts({ chunks: [chunk], lookup: LOOKUP, count: 10, ...BASE_OPTS });
    const definition = drafts.find((d) => d.question.startsWith("Qu'est-ce que"));
    expect(definition).toBeDefined();
    expect(definition!.answer).toContain('minéralisé');
  });

  it("ne génère jamais de carte depuis une phrase à exception ou négation ambiguë", () => {
    const chunk = makeChunk(
      'Tous les nerfs crâniens sont pairs, sauf le nerf trochléaire dans certaines classifications. ' +
        "Le nerf facial n'innerve pas directement les muscles masticateurs, ce rôle étant réservé au nerf trijumeau.",
    );
    const drafts = generateLocalCardDrafts({ chunks: [chunk], lookup: LOOKUP, count: 10, ...BASE_OPTS });
    expect(drafts).toHaveLength(0);
  });

  it('ne reformule jamais une négation propre en carte positive trompeuse', () => {
    const chunk = makeChunk('Le nerf trochléaire ne possède pas de branche sensitive.');
    const drafts = generateLocalCardDrafts({ chunks: [chunk], lookup: LOOKUP, count: 10, ...BASE_OPTS });
    for (const draft of drafts) {
      expect(draft.answer.toLowerCase()).not.toMatch(/^branche sensitive$/);
      if (draft.question.includes('possède')) expect(draft.answer.toLowerCase()).toContain('ne possède pas');
    }
  });

  it('ne propose jamais une question déjà présente dans la bibliothèque', () => {
    const chunk = makeChunk("L'émail dentaire est le tissu le plus minéralisé de l'organisme.");
    const drafts = generateLocalCardDrafts({
      chunks: [chunk],
      lookup: LOOKUP,
      count: 10,
      importance: 2,
      difficulty: 2,
      existingQuestions: ["Qu'est-ce que l'émail dentaire ?"],
    });
    expect(drafts.some((d) => d.question === "Qu'est-ce que l'émail dentaire ?")).toBe(false);
  });

  it('respecte la limite demandée', () => {
    const chunk = makeChunk(
      "L'émail est un tissu. La dentine est un tissu. La pulpe est un tissu. Le cément est un tissu.",
    );
    const drafts = generateLocalCardDrafts({ chunks: [chunk], lookup: LOOKUP, count: 2, ...BASE_OPTS });
    expect(drafts.length).toBeLessThanOrEqual(2);
  });

  it("renvoie un tableau vide sur un texte sans motif exploitable, jamais une carte inventée", () => {
    const chunk = makeChunk('Un patient se présente pour une consultation de routine.');
    const drafts = generateLocalCardDrafts({ chunks: [chunk], lookup: LOOKUP, count: 10, ...BASE_OPTS });
    expect(drafts).toHaveLength(0);
  });
});
