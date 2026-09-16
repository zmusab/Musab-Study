import { describe, expect, it } from 'vitest';
import { deriveFactState } from '@/core/learning';
import { rankExamPriority } from '@/core/examPriority';
import { buildDailyStudySession } from '@/core/studySession';
import type { FactAttempt, KnowledgeFact } from '@/types';

const fact: KnowledgeFact = {
  id: 'fact-v1-branches', subjectId: 'anatomie', chapterId: 'nerfs', conceptId: 'v1',
  predicate: 'composition', objectText: 'frontal, lacrymal et nasociliaire', objectConceptId: null,
  items: ['frontal', 'lacrymal', 'nasociliaire'], confidence: 'high', importance: 3,
  origin: 'course-local', status: 'verified', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
};

function attempt(verdict: FactAttempt['verdict'], at: string): FactAttempt {
  return { id: `a-${at}`, factId: fact.id, conceptId: fact.conceptId, subjectId: fact.subjectId, chapterId: fact.chapterId, kind: 'recall', verdict, at, elapsedMs: 2_000, sourceItemId: null };
}

describe('maîtrise factuelle', () => {
  it('traite une liste partielle comme apprentissage, et non comme correcte', () => {
    const state = deriveFactState(fact.id, [attempt('partial', '2026-09-10T10:00:00.000Z')], fact, new Date('2026-09-10T11:00:00.000Z'));
    expect(state.status).toBe('learning');
    expect(state.mastery).toBeLessThan(60);
    expect(state.partialAttempts).toBe(1);
  });

  it('une erreur récente rend un fait fragile malgré des réponses plus anciennes', () => {
    const state = deriveFactState(fact.id, [
      attempt('correct', '2026-09-01T10:00:00.000Z'),
      attempt('correct', '2026-09-03T10:00:00.000Z'),
      attempt('incorrect', '2026-09-10T10:00:00.000Z'),
    ], fact, new Date('2026-09-10T11:00:00.000Z'));
    expect(state.status).toBe('fragile');
    expect(state.incorrectAttempts).toBe(1);
  });
});

describe('priorité et séance du jour', () => {
  it('explique la priorité sans prétendre prédire un examen', () => {
    const states = [deriveFactState(fact.id, [attempt('incorrect', '2026-09-10T10:00:00.000Z')], fact, new Date('2026-09-10T11:00:00.000Z'))];
    const [priority] = rankExamPriority([fact], states, [{ id: 'e1', factId: fact.id, documentId: 'd1', sourceChunkId: 'c1', excerpt: 'V1 donne trois branches.', page: 2, active: true, createdAt: '2026-09-01T10:00:00.000Z' }], [{ id: 'exam', title: 'Anatomie', kind: 'exam', day: '2026-09-15', startTime: null, endTime: null, subjectId: 'anatomie', notes: '', done: false, createdAt: '2026-09-01T00:00:00.000Z' }], new Date('2026-09-10T11:00:00.000Z'));
    expect(priority?.level).toBe('very-high');
    expect(priority?.reasons.join(' ')).toContain('maîtrise fragile');
    expect(priority?.reasons.join(' ')).toContain('évaluation dans');
  });

  it('met les cartes dues avant les faits fragiles, puis les faits prioritaires', () => {
    const session = buildDailyStudySession({
      duration: 20,
      cards: [{ id: 'card1', subjectId: 'anatomie', chapterId: 'nerfs', question: 'Q', answer: 'R', importance: 2, difficulty: 2, ease: 2.5, interval: 0, reps: 0, lapses: 0, due: '2026-09-10T09:00:00.000Z', lastReview: null, origin: 'manual', sourceChunkIds: [], createdAt: '2026-09-01T00:00:00.000Z' }],
      facts: [fact],
      evidence: [{ id: 'e1', factId: fact.id, documentId: 'd1', sourceChunkId: 'c1', excerpt: 'V1 donne trois branches.', page: 2, active: true, createdAt: '2026-09-01T10:00:00.000Z' }],
      states: [deriveFactState(fact.id, [attempt('incorrect', '2026-09-10T10:00:00.000Z')], fact, new Date('2026-09-10T11:00:00.000Z'))],
      events: [],
      now: new Date('2026-09-10T11:00:00.000Z'),
    });
    expect(session.blocks[0]?.kind).toBe('flashcards');
    expect(session.blocks.some((block) => block.kind === 'recall')).toBe(true);
  });
});
