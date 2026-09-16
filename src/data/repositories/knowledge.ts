import { db } from '@/data/db';
import { comparisonKey } from '@/core/text';
import { nowISO } from '@/lib/date';
import { uid } from '@/lib/id';
import { extractFacts } from '@/services/local/relationExtraction';
import type {
  DocumentChunk,
  Flashcard,
  KnowledgeConcept,
  KnowledgeEvidence,
  KnowledgeFact,
  KnowledgeStatus,
} from '@/types';

/** Version de remplissage : incrémentée si les règles d'extraction changent. */
export const KNOWLEDGE_ENGINE_VERSION = 1;

function conceptKind(label: string): string | null {
  const value = comparisonKey(label);
  if (/\bnerf\b/.test(value)) return 'nerf';
  if (/\bmuscle\b/.test(value)) return 'muscle';
  if (/\b(?:artere|veine|vaisseau)\b/.test(value)) return 'vaisseau';
  if (/\b(?:dent|incisive|canine|molaire)\b/.test(value)) return 'dent';
  if (/\b(?:os|osseux)\b/.test(value)) return 'os';
  return null;
}

function statusFor(confidence: KnowledgeFact['confidence']): KnowledgeStatus {
  // Un fait issu d'une règle prudente reste un candidat tant qu'il est
  // ambigu ; seul un extrait court et clair devient immédiatement exploitable.
  return confidence === 'high' ? 'verified' : 'candidate';
}

interface Candidate {
  chunk: DocumentChunk;
  subject: string;
  predicate: string;
  objectText: string;
  items: string[] | null;
  confidence: KnowledgeFact['confidence'];
  excerpt: string;
}

function candidatesFromChunks(chunks: readonly DocumentChunk[]): Candidate[] {
  return chunks.flatMap((chunk) =>
    extractFacts(chunk)
      .filter((fact) => fact.confidence !== 'low')
      .map((fact) => ({
        chunk,
        subject: fact.subject.trim(),
        predicate: fact.predicate,
        objectText: fact.object.trim(),
        items: fact.items,
        confidence: fact.confidence,
        excerpt: fact.sourceExcerpt.trim(),
      }))
      .filter((fact) => fact.subject.length > 1 && fact.objectText.length > 1 && fact.excerpt.length > 1),
  );
}

/**
 * Construit ou réconcilie des faits locaux à partir de chunks réels.
 * Les anciennes preuves du document sont désactivées, jamais supprimées :
 * après un réindexage on sait précisément qu'une source doit être contrôlée.
 */
export async function syncKnowledgeForChunks(chunks: readonly DocumentChunk[]): Promise<{ concepts: number; facts: number; evidence: number }> {
  if (chunks.length === 0) return { concepts: 0, facts: 0, evidence: 0 };
  const candidates = candidatesFromChunks(chunks);
  const documentIds = [...new Set(chunks.map((chunk) => chunk.documentId))];
  if (candidates.length === 0) {
    await db.knowledgeEvidence.where('documentId').anyOf(documentIds).modify({ active: false });
    return { concepts: 0, facts: 0, evidence: 0 };
  }

  const subjectIds = [...new Set(candidates.map((candidate) => candidate.chunk.subjectId))];
  const [existingConcepts, existingFacts, existingEvidence] = await Promise.all([
    db.knowledgeConcepts.where('subjectId').anyOf(subjectIds).toArray(),
    db.knowledgeFacts.where('subjectId').anyOf(subjectIds).toArray(),
    db.knowledgeEvidence.where('documentId').anyOf(documentIds).toArray(),
  ]);
  const conceptsByKey = new Map(existingConcepts.map((concept) => [`${concept.subjectId}:${concept.normalizedLabel}`, concept]));
  const factByKey = new Map(existingFacts.map((fact) => [
    `${fact.subjectId}:${fact.chapterId ?? 'root'}:${fact.conceptId}:${fact.predicate}:${comparisonKey(fact.objectText)}`,
    fact,
  ]));
  const evidenceByKey = new Map(existingEvidence.map((evidence) => [
    `${evidence.factId}:${evidence.sourceChunkId}:${comparisonKey(evidence.excerpt)}`,
    evidence,
  ]));
  const concepts: KnowledgeConcept[] = [];
  const facts: KnowledgeFact[] = [];
  const evidence: KnowledgeEvidence[] = [];
  const reactivateEvidenceIds: string[] = [];
  const now = nowISO();

  for (const candidate of candidates) {
    const normalizedLabel = comparisonKey(candidate.subject);
    const conceptKey = `${candidate.chunk.subjectId}:${normalizedLabel}`;
    let concept = conceptsByKey.get(conceptKey);
    if (!concept) {
      concept = {
        id: uid('kno'),
        subjectId: candidate.chunk.subjectId,
        chapterId: candidate.chunk.chapterId,
        label: candidate.subject,
        normalizedLabel,
        kind: conceptKind(candidate.subject),
        aliases: [],
        origin: 'course-local',
        status: statusFor(candidate.confidence),
        createdAt: now,
        updatedAt: now,
      };
      conceptsByKey.set(conceptKey, concept);
      concepts.push(concept);
    }

    const factKey = `${candidate.chunk.subjectId}:${candidate.chunk.chapterId}:${concept.id}:${candidate.predicate}:${comparisonKey(candidate.objectText)}`;
    let fact = factByKey.get(factKey);
    if (!fact) {
      fact = {
        id: uid('knf'),
        subjectId: candidate.chunk.subjectId,
        chapterId: candidate.chunk.chapterId,
        conceptId: concept.id,
        predicate: candidate.predicate,
        objectText: candidate.objectText,
        objectConceptId: null,
        items: candidate.items,
        confidence: candidate.confidence,
        importance: candidate.predicate === 'composition' || candidate.predicate === 'classification' ? 2 : 1,
        origin: 'course-local',
        status: statusFor(candidate.confidence),
        createdAt: now,
        updatedAt: now,
      };
      factByKey.set(factKey, fact);
      facts.push(fact);
    }

    const evidenceKey = `${fact.id}:${candidate.chunk.id}:${comparisonKey(candidate.excerpt)}`;
    const previousEvidence = evidenceByKey.get(evidenceKey);
    if (!previousEvidence) {
      evidence.push({
        id: uid('kne'),
        factId: fact.id,
        documentId: candidate.chunk.documentId,
        sourceChunkId: candidate.chunk.id,
        excerpt: candidate.excerpt,
        page: candidate.chunk.pageStart,
        active: true,
        createdAt: now,
      });
    } else {
      reactivateEvidenceIds.push(previousEvidence.id);
    }
  }

  await db.transaction('rw', [db.knowledgeConcepts, db.knowledgeFacts, db.knowledgeEvidence], async () => {
    await db.knowledgeEvidence.where('documentId').anyOf(documentIds).modify({ active: false });
    if (concepts.length > 0) await db.knowledgeConcepts.bulkAdd(concepts);
    if (facts.length > 0) await db.knowledgeFacts.bulkAdd(facts);
    if (evidence.length > 0) await db.knowledgeEvidence.bulkAdd(evidence);
    if (reactivateEvidenceIds.length > 0) {
      await db.knowledgeEvidence.where('id').anyOf(reactivateEvidenceIds).modify({ active: true });
    }
  });

  return { concepts: concepts.length, facts: facts.length, evidence: evidence.length };
}

/** Remplissage unique de la bibliothèque existante, sans toucher aux cartes ni aux logs. */
export async function syncKnowledgeLibrary(): Promise<{ concepts: number; facts: number; evidence: number }> {
  return syncKnowledgeForChunks(await db.chunks.toArray());
}

/** Lecture stricte : le tuteur local ne doit utiliser que des faits vérifiés et sourcés. */
export async function listVerifiedKnowledge(subjectId: string, chapterId?: string | null): Promise<KnowledgeFact[]> {
  const facts = await db.knowledgeFacts.where('subjectId').equals(subjectId).toArray();
  const scoped = facts.filter((fact) => fact.status === 'verified' && (!chapterId || fact.chapterId === chapterId));
  const evidence = await db.knowledgeEvidence.where('factId').anyOf(scoped.map((fact) => fact.id)).toArray();
  const withActiveEvidence = new Set(evidence.filter((item) => item.active).map((item) => item.factId));
  return scoped.filter((fact) => withActiveEvidence.has(fact.id));
}

/** Relie une carte à un fait seulement lorsqu'une correspondance source est exacte. */
export async function linkFlashcardToKnowledge(card: Flashcard): Promise<Pick<Flashcard, 'knowledgeFactIds' | 'knowledgeConceptId'>> {
  const facts = await db.knowledgeFacts.where('subjectId').equals(card.subjectId).toArray();
  const answerKey = comparisonKey(card.answer);
  const candidates = facts.filter((fact) =>
    fact.status === 'verified'
    && comparisonKey(fact.objectText) === answerKey
    && (card.chapterId === null || fact.chapterId === card.chapterId),
  );
  if (candidates.length !== 1) return { knowledgeFactIds: [], knowledgeConceptId: null };
  return { knowledgeFactIds: [candidates[0]!.id], knowledgeConceptId: candidates[0]!.conceptId };
}
