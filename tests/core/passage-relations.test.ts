import { describe, expect, it } from 'vitest';
import { answerPassageQuestion } from '@/services/local/passageRelations';
import type { ContextLookup, ScoredChunk } from '@/services/rag/retrieval';

const lookup: ContextLookup = { subjects: new Map(), chapters: new Map(), documents: new Map() };
function source(text: string): ScoredChunk[] {
  return [{ score: 1, matchedTerms: [], chunk: { id: 'c', documentId: 'd', subjectId: 's', chapterId: 'ch', index: 0, text, charStart: 0, charEnd: text.length, pageStart: 1, pageEnd: 1, termFreq: {}, tokenCount: 10, embedding: null } }];
}
// Synthetic names test language handling without adding unverified anatomical knowledge.
describe('relations de passage', () => {
  const query = 'Quels nerfs passent par le canal Alpha ?';
  it('retrouve une relation dans le sens inverse et conserve sa source', () => {
    const answer = answerPassageQuestion(query, source('Le nerf Beta traverse le canal Alpha.'), lookup);
    expect(answer?.text).toContain('Le nerf Beta');
    expect(answer?.citations[0]?.excerpt).toBe('Le nerf Beta traverse le canal Alpha.');
  });
  it.each([
    'Le nerf Beta ne traverse pas le canal Alpha.',
    'Le nerf Beta passe parfois par le canal Alpha.',
    'Le nerf Beta se trouve près du canal Alpha.',
    'Le nerf Beta traverse la paroi du canal Alpha.',
    'Le nerf Beta traverse le canal Gamma et non le canal Alpha.',
    'La veine Beta traverse le canal Alpha.',
  ])('ne transforme pas une phrase incompatible en passage : %s', sentence => {
    expect(answerPassageQuestion(query, source(sentence), lookup)).toBeNull();
  });
  it('demande le lieu lorsque la question est ambiguë', () => {
    expect(answerPassageQuestion('Quels nerfs passent par cet endroit ?', [], lookup)?.citations).toEqual([]);
  });
  it('laisse les autres questions au moteur existant', () => {
    expect(answerPassageQuestion('Explique le nerf Beta', source('Le nerf Beta traverse le canal Alpha.'), lookup)).toBeNull();
  });
});
