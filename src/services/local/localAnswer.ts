import { extractFacts, type FactPredicate, type RawFact } from './relationExtraction';
import { citationFromChunk } from './citation';
import type { ScoredChunk, ContextLookup } from '@/services/rag/retrieval';
import type { Citation } from '@/types';

/**
 * Réponse à une question libre SANS IA — réutilise `relationExtraction.ts`
 * (le même moteur que les flashcards/notions locales) plutôt que d'inventer
 * un second mécanisme, et la récupération BM25 déjà calculée par
 * `ChatPage.tsx` (aucune nouvelle recherche).
 *
 * La réponse n'est JAMAIS reformulée : elle est l'assemblage d'extraits
 * exacts du cours dont le SUJET recoupe fortement les mots de la question.
 * Si rien ne recoupe suffisamment, la fonction renvoie `null` — mieux ne
 * rien répondre que d'inventer, exactement la même règle d'abstention que
 * pour les flashcards/notions locales.
 */

export interface LocalAnswer {
  text: string;
  citations: Citation[];
}

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'est', 'que', 'qui', 'pas',
  'ne', 'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ce', 'ces', 'mon',
  'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'pour', 'avec', 'dans', 'sur', 'par',
  'comprends', 'comprend', 'comprendre',
]);

/** Retrait de pluriel très grossier ("nerfs" → "nerf") — même heuristique que `core/quiz`'s `overlapWords`, pas une vraie lemmatisation. */
const singularize = (word: string): string => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);

function significantWords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(' ')
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
      .map(singularize),
  );
}

/** Recouvrement orienté « la question couvre-t-elle bien le sujet du fait ? ». */
function overlapScore(questionWords: Set<string>, subjectWords: Set<string>): number {
  if (subjectWords.size === 0) return 0;
  const intersection = [...subjectWords].filter((word) => questionWords.has(word)).length;
  return intersection / subjectWords.size;
}

const MATCH_THRESHOLD = 0.6;
const MAX_FACTS_IN_ANSWER = 4;

const PREDICATE_PRIORITY: Record<FactPredicate, number> = {
  definition: 0,
  classification: 1,
  composition: 1,
  possession: 1,
  function: 2,
  location: 2,
};

/**
 * Tente de répondre localement à `question`, à partir des fragments déjà
 * retrouvés par BM25 (`scoredChunks`, réutilisé tel quel — aucune nouvelle
 * recherche). `null` si aucun fait détecté ne recoupe assez la question.
 */
export function findLocalAnswer(
  question: string,
  scoredChunks: readonly ScoredChunk[],
  lookup: ContextLookup,
): LocalAnswer | null {
  const questionWords = significantWords(question);
  if (questionWords.size === 0) return null;

  const matches: { fact: RawFact; chunkId: string; score: number; order: number }[] = [];
  let order = 0;
  for (const { chunk } of scoredChunks) {
    for (const fact of extractFacts(chunk)) {
      order += 1;
      if (fact.confidence === 'low') continue;
      const score = overlapScore(questionWords, significantWords(fact.subject));
      if (score >= MATCH_THRESHOLD) matches.push({ fact, chunkId: chunk.id, score, order });
    }
  }
  if (matches.length === 0) return null;

  matches.sort(
    (a, b) =>
      b.score - a.score || PREDICATE_PRIORITY[a.fact.predicate] - PREDICATE_PRIORITY[b.fact.predicate] || a.order - b.order,
  );

  const chunkById = new Map(scoredChunks.map(({ chunk }) => [chunk.id, chunk]));
  const seenExcerpts = new Set<string>();
  const excerpts: string[] = [];
  const citations: Citation[] = [];

  for (const { fact, chunkId } of matches) {
    const key = normalize(fact.sourceExcerpt);
    if (seenExcerpts.has(key)) continue;
    seenExcerpts.add(key);

    const chunk = chunkById.get(chunkId);
    if (!chunk) continue;

    excerpts.push(fact.sourceExcerpt);
    citations.push(citationFromChunk(chunk, lookup, fact.sourceExcerpt));
    if (excerpts.length >= MAX_FACTS_IN_ANSWER) break;
  }

  if (excerpts.length === 0) return null;

  return { text: excerpts.join('\n\n'), citations };
}
