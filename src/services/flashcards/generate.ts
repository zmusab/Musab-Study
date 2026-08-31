import { ask, extractJsonArray } from '@/services/ai/client';
import { buildContext, type ContextLookup, type ScoredChunk } from '@/services/rag/retrieval';
import { validateCardDrafts, type CardDraft, type RawCardDraft } from './validate';
import type { DocumentChunk, Difficulty, Importance } from '@/types';

/** Budget de contexte : une génération de cartes couvre tout un chapitre, pas une question ciblée. */
const CONTEXT_BUDGET = 24_000;

function chunksInReadingOrder(chunks: DocumentChunk[]): ScoredChunk[] {
  return [...chunks]
    .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.index - b.index)
    .map((chunk) => ({ chunk, score: 0, matchedTerms: [] }));
}

function systemPrompt(count: number, context: string): string {
  return `Tu prépares des flashcards de révision pour un étudiant en dentisterie (UMF Iași, section française), à partir de ses propres extraits de cours numérotés ci-dessous.

Génère exactement ${count} flashcards question/réponse, précises et concises. Privilégie les notions les plus importantes à retenir, pas les détails secondaires. Une carte = une notion, pas plusieurs.

RÈGLES ABSOLUES :
- Chaque réponse doit citer la référence de l'extrait qui la soutient, entre crochets : "S1", "S2".
- N'utilise QUE les extraits ci-dessous. N'invente aucune information absente du texte.
- Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ni après, sans balises de code. Format exact :
[{"question":"...","answer":"réponse concise avec sa référence [S1]","refs":["S1"]}]

EXTRAITS DE COURS :
${context}`;
}

export interface GenerateCardsInput {
  count: number;
  importance: Importance;
  difficulty: Difficulty;
  chunks: DocumentChunk[];
  lookup: ContextLookup;
  signal?: AbortSignal;
}

export class NoIndexedContentError extends Error {
  constructor() {
    super("Ce chapitre ne contient aucun document indexé. Importe d'abord un document.");
    this.name = 'NoIndexedContentError';
  }
}

/** Génère des propositions de cartes, déjà vérifiées et sourcées. */
export async function generateCardDrafts(input: GenerateCardsInput): Promise<CardDraft[]> {
  if (input.chunks.length === 0) throw new NoIndexedContentError();

  const context = buildContext(chunksInReadingOrder(input.chunks), input.lookup, CONTEXT_BUDGET);

  const raw = await ask({
    system: systemPrompt(input.count, context.text),
    prompt: `Génère les ${input.count} flashcards demandées, au format JSON.`,
    maxTokens: 3072,
    signal: input.signal,
    // Extraire des paires question/réponse d'un texte déjà fourni est une
    // tâche mécanique : un effort réduit répond plus vite sans perte de
    // fiabilité, puisque validateCardDrafts() rejette de toute façon toute
    // carte sans citation vérifiable.
    effort: 'medium',
  });

  const rawDrafts = extractJsonArray<RawCardDraft>(raw);
  return validateCardDrafts(rawDrafts, context, input.importance, input.difficulty, input.count);
}
