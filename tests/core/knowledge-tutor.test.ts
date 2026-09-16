import { expect, it } from 'vitest';
import { answerFromKnowledge } from '@/services/local/knowledgeTutor';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk, KnowledgeConcept, KnowledgeFact } from '@/types';

const concept: KnowledgeConcept = { id: 'v1', subjectId: 'anat', chapterId: 'n1', label: 'Nerf ophtalmique de Willis', normalizedLabel: 'nerf ophtalmique de willis', kind: 'nerf', aliases: [], origin: 'course-local', status: 'verified', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
const fact: KnowledgeFact = { id: 'f1', subjectId: 'anat', chapterId: 'n1', conceptId: 'v1', predicate: 'composition', objectText: 'frontal, lacrymal et nasociliaire', objectConceptId: null, items: ['nerf frontal', 'nerf lacrymal', 'nerf nasociliaire'], confidence: 'high', importance: 2, origin: 'course-local', status: 'verified', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
const chunk: DocumentChunk = { id: 'c1', documentId: 'd1', chapterId: 'n1', subjectId: 'anat', index: 0, text: 'Le nerf ophtalmique de Willis donne trois branches : nerf frontal, nerf lacrymal et nerf nasociliaire.', charStart: 0, charEnd: 110, pageStart: 4, pageEnd: 4, termFreq: {}, tokenCount: 15, embedding: null };
const lookup: ContextLookup = { subjects: new Map([['anat', { id: 'anat', name: 'Anatomie', color: '#000', position: 0, createdAt: '2026-09-01T00:00:00.000Z' }]]), chapters: new Map([['n1', { id: 'n1', subjectId: 'anat', name: 'Nerfs', position: 0, createdAt: '2026-09-01T00:00:00.000Z' }]]), documents: new Map([['d1', { id: 'd1', name: 'Cours nerfs' }]]) };

it('explique depuis un fait vérifié sans citer le texte de provenance interne', () => {
  const answer = answerFromKnowledge('Je ne comprends pas le nerf ophtalmique de Willis', [fact], [concept], [{ id: 'e1', factId: 'f1', documentId: 'd1', sourceChunkId: 'c1', excerpt: chunk.text, page: 4, active: true, createdAt: '2026-09-01T00:00:00.000Z' }], [chunk], lookup);
  expect(answer?.text).toContain('nerf frontal');
  expect(answer?.text).not.toContain('Réponse locale');
  expect(answer?.citations).toHaveLength(1);
});

it('s’abstient si aucun concept précis du cours ne correspond', () => {
  const answer = answerFromKnowledge('Explique la pulpe dentaire', [fact], [concept], [], [chunk], lookup);
  expect(answer).toBeNull();
});
