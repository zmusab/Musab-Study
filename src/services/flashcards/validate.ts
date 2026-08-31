import { extractReferences } from '@/services/ai/tutor';
import type { RetrievedContext } from '@/services/rag/retrieval';
import type { Citation, Difficulty, Importance } from '@/types';

/**
 * Vérification des flashcards proposées par l'IA — même principe que pour
 * l'assistant et le podcast : une carte n'est acceptée que si sa réponse
 * s'appuie sur au moins un extrait réellement transmis. Une carte plausible
 * mais invérifiable est écartée avant même d'être proposée à l'utilisateur,
 * plutôt que de le laisser accepter par erreur une réponse inventée.
 */

export interface RawCardDraft {
  question?: unknown;
  answer?: unknown;
  refs?: unknown;
}

export interface CardDraft {
  question: string;
  answer: string;
  citations: Citation[];
  sourceChunkIds: string[];
  importance: Importance;
  difficulty: Difficulty;
}

export function validateCardDrafts(
  raw: RawCardDraft[],
  context: RetrievedContext,
  importance: Importance,
  difficulty: Difficulty,
  limit: number,
): CardDraft[] {
  const byRef = new Map(context.sources.map((source) => [source.ref, source]));
  const drafts: CardDraft[] = [];

  for (const item of raw) {
    if (typeof item.question !== 'string' || item.question.trim().length === 0) continue;
    if (typeof item.answer !== 'string' || item.answer.trim().length === 0) continue;

    const refs = Array.isArray(item.refs)
      ? item.refs.filter((r): r is string => typeof r === 'string')
      : extractReferences(item.answer);
    const validRefs = refs.filter((ref) => byRef.has(ref));
    if (validRefs.length === 0) continue;

    const citations: Citation[] = validRefs.map((ref) => {
      const source = byRef.get(ref)!;
      return {
        chunkId: source.chunkId,
        documentId: source.documentId,
        documentName: source.documentName,
        chapterId: source.chapterId,
        chapterName: source.chapterName,
        subjectName: source.subjectName,
        excerpt: source.excerpt,
        page: source.page,
      };
    });

    // La référence n'a d'utilité que pour la vérification : elle n'a pas sa
    // place dans une carte de révision, qui doit se lire comme une réponse
    // autonome.
    const cleanAnswer = validRefs
      .reduce((text, ref) => text.replaceAll(`[${ref}]`, ''), item.answer)
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();

    drafts.push({
      question: item.question.trim(),
      answer: cleanAnswer,
      citations,
      sourceChunkIds: citations.map((c) => c.chunkId),
      importance,
      difficulty,
    });

    if (drafts.length >= limit) break;
  }

  return drafts;
}
