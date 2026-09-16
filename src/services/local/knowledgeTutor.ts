import { significantWords } from '@/core/text';
import { citationFromChunk } from './citation';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { Citation, DocumentChunk, KnowledgeConcept, KnowledgeEvidence, KnowledgeFact } from '@/types';

export interface KnowledgeTutorAnswer {
  text: string;
  citations: Citation[];
}

const LABELS: Record<string, string> = {
  definition: 'Ce que c’est',
  classification: 'Les types',
  composition: 'Les éléments à connaître',
  possession: 'Ce que cela comporte',
  function: 'Rôle',
  location: 'Situation / trajet',
};

function matchConcept(question: string, concepts: readonly KnowledgeConcept[]): KnowledgeConcept | null {
  const questionWords = significantWords(question);
  let best: { concept: KnowledgeConcept; score: number } | null = null;
  for (const concept of concepts) {
    if (concept.status !== 'verified') continue;
    const words = significantWords(concept.label);
    if (words.size === 0) continue;
    const shared = [...words].filter((word) => questionWords.has(word));
    // Au moins un mot suffisamment distinctif protège d'une réponse sur « un
    // nerf quelconque » ; les mots d'une lettre et les chiffres romains ne
    // sont jamais un concept autonome.
    const specific = shared.some((word) => word.length >= 4);
    const score = shared.length / words.size;
    if (specific && score >= 0.34 && (!best || score > best.score)) best = { concept, score };
  }
  return best?.concept ?? null;
}

/**
 * Réponse locale à partir des faits vérifiés, avec une preuve par assertion.
 * Les titres sont une mise en forme ; chaque ligne de contenu vient d'un fait
 * et chaque fait affiché possède au moins une preuve active dans le cours.
 */
export function answerFromKnowledge(
  question: string,
  facts: readonly KnowledgeFact[],
  concepts: readonly KnowledgeConcept[],
  evidence: readonly KnowledgeEvidence[],
  chunks: readonly DocumentChunk[],
  lookup: ContextLookup,
): KnowledgeTutorAnswer | null {
  const concept = matchConcept(question, concepts);
  if (!concept) return null;
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const evidenceByFact = new Map<string, KnowledgeEvidence[]>();
  for (const item of evidence) {
    if (!item.active) continue;
    const list = evidenceByFact.get(item.factId);
    if (list) list.push(item);
    else evidenceByFact.set(item.factId, [item]);
  }
  const supported = facts
    .filter((fact) => fact.conceptId === concept.id && fact.status === 'verified')
    .filter((fact) => (evidenceByFact.get(fact.id) ?? []).some((item) => chunkById.has(item.sourceChunkId)));
  if (supported.length === 0) return null;

  const priority = ['definition', 'classification', 'composition', 'possession', 'function', 'location'];
  supported.sort((a, b) => priority.indexOf(a.predicate) - priority.indexOf(b.predicate));
  const citations: Citation[] = [];
  const seenCitations = new Set<string>();
  const blocks = supported.slice(0, 6).map((fact) => {
    const source = (evidenceByFact.get(fact.id) ?? []).find((item) => chunkById.has(item.sourceChunkId));
    if (source) {
      const citation = citationFromChunk(chunkById.get(source.sourceChunkId)!, lookup, source.excerpt);
      if (!seenCitations.has(citation.chunkId)) {
        citations.push(citation);
        seenCitations.add(citation.chunkId);
      }
    }
    const content = fact.items?.length ? fact.items.map((item) => `- ${item}`).join('\n') : fact.objectText;
    return `### ${LABELS[fact.predicate] ?? 'À retenir'}\n${fact.items?.length ? content : `- ${content}`}`;
  });
  const introductory = question.toLocaleLowerCase('fr-FR').includes('compr')
    ? `On va le lire comme une fiche : d’abord ce qu’est **${concept.label}**, puis ses éléments importants.`
    : `Voici ce que tes cours établissent sur **${concept.label}**.`;
  return { text: [introductory, ...blocks].join('\n\n'), citations };
}
