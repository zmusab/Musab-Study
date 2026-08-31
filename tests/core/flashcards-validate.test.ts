import { describe, it, expect } from 'vitest';
import { validateCardDrafts } from '@/services/flashcards/validate';
import type { RetrievedContext } from '@/services/rag/retrieval';

const CONTEXT: RetrievedContext = {
  text: '[S1] …\n\n---\n\n[S2] …',
  sources: [
    {
      ref: 'S1',
      chunkId: 'chk-1',
      documentId: 'doc-1',
      documentName: 'Masséter.pdf',
      chapterId: 'ch-1',
      chapterName: 'Muscles',
      subjectName: 'Anatomie',
      excerpt: 'Le masséter est innervé par le nerf massétérique.',
    },
  ],
};

describe('validateCardDrafts', () => {
  it('accepte une carte correctement sourcée et retire la référence de la réponse', () => {
    const drafts = validateCardDrafts(
      [{ question: 'Innervation du masséter ?', answer: 'Le nerf massétérique [S1].', refs: ['S1'] }],
      CONTEXT,
      2,
      2,
      10,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.answer).toBe('Le nerf massétérique.');
    expect(drafts[0]!.citations).toHaveLength(1);
    expect(drafts[0]!.sourceChunkIds).toEqual(['chk-1']);
  });

  it('rejette une carte dont aucune référence n’est valide', () => {
    // Le cas critique : une carte plausible mais invérifiable ne doit jamais
    // être proposée à l'utilisateur.
    const drafts = validateCardDrafts(
      [{ question: 'Une question ?', answer: 'Une réponse assurée mais fausse [S9].', refs: ['S9'] }],
      CONTEXT,
      2,
      2,
      10,
    );
    expect(drafts).toHaveLength(0);
  });

  it('rejette une carte sans question ou sans réponse', () => {
    const drafts = validateCardDrafts(
      [
        { answer: 'Réponse seule [S1].', refs: ['S1'] },
        { question: 'Question seule ?', refs: ['S1'] },
        { question: '', answer: '', refs: ['S1'] },
      ],
      CONTEXT,
      2,
      2,
      10,
    );
    expect(drafts).toHaveLength(0);
  });

  it('retombe sur l’extraction depuis le texte de la réponse si refs est absent', () => {
    const drafts = validateCardDrafts(
      [{ question: 'Q ?', answer: 'Réponse [S1].' }],
      CONTEXT,
      2,
      2,
      10,
    );
    expect(drafts).toHaveLength(1);
  });

  it('respecte la limite demandée', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      question: `Q${i} ?`,
      answer: `Réponse ${i} [S1].`,
      refs: ['S1'],
    }));
    expect(validateCardDrafts(raw, CONTEXT, 2, 2, 5)).toHaveLength(5);
  });

  it('applique l’importance et la difficulté demandées à toutes les cartes', () => {
    const drafts = validateCardDrafts(
      [{ question: 'Q ?', answer: 'R [S1].', refs: ['S1'] }],
      CONTEXT,
      3,
      1,
      10,
    );
    expect(drafts[0]!.importance).toBe(3);
    expect(drafts[0]!.difficulty).toBe(1);
  });
});
