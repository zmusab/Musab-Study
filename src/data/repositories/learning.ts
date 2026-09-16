import { deriveFactState } from '@/core/learning';
import { db } from '@/data/db';
import { uid } from '@/lib/id';
import type { FactAttempt, ID, LearnerFactState, LearningAttemptKind, LearningVerdict } from '@/types';

export interface RecordFactAttemptInput {
  factIds: readonly ID[];
  subjectId: ID;
  chapterId: ID | null;
  kind: LearningAttemptKind;
  verdict: LearningVerdict;
  at?: Date;
  elapsedMs: number;
  sourceItemId: ID | null;
}

/**
 * Enregistre une même réponse sur un ou plusieurs faits, puis reconstruit leur
 * état dans la même transaction. Les données restent donc cohérentes même si
 * l'application est fermée juste après une réponse.
 */
export async function recordFactAttempt(input: RecordFactAttemptInput): Promise<void> {
  const factIds = [...new Set(input.factIds)].filter(Boolean);
  if (factIds.length === 0) return;
  const now = input.at ?? new Date();
  await db.transaction('rw', [db.knowledgeFacts, db.factAttempts, db.learnerFactStates], async () => {
    const facts = (await db.knowledgeFacts.bulkGet(factIds)).filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));
    const attempts: FactAttempt[] = facts.map((fact) => ({
      id: uid('fat'),
      factId: fact.id,
      conceptId: fact.conceptId,
      subjectId: fact.subjectId,
      chapterId: fact.chapterId,
      kind: input.kind,
      verdict: input.verdict,
      at: now.toISOString(),
      elapsedMs: input.elapsedMs,
      sourceItemId: input.sourceItemId,
    }));
    if (attempts.length === 0) return;
    await db.factAttempts.bulkAdd(attempts);
    const states: LearnerFactState[] = [];
    for (const fact of facts) {
      const history = await db.factAttempts.where('factId').equals(fact.id).toArray();
      states.push(deriveFactState(fact.id, history, fact, now));
    }
    await db.learnerFactStates.bulkPut(states);
  });
}

export async function listFactStates(subjectId?: ID): Promise<LearnerFactState[]> {
  return subjectId
    ? db.learnerFactStates.where('subjectId').equals(subjectId).toArray()
    : db.learnerFactStates.toArray();
}

/** Recalcule une projection existante après import ou évolution de l'algorithme, sans supprimer d'historique. */
export async function rebuildFactStates(): Promise<number> {
  const facts = await db.knowledgeFacts.toArray();
  const now = new Date();
  const states: LearnerFactState[] = [];
  for (const fact of facts) {
    const attempts = await db.factAttempts.where('factId').equals(fact.id).toArray();
    if (attempts.length > 0) states.push(deriveFactState(fact.id, attempts, fact, now));
  }
  if (states.length > 0) await db.learnerFactStates.bulkPut(states);
  return states.length;
}
