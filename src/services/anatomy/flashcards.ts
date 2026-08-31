import { aiOrchestrator } from '@/services/ai/orchestrator';
import { extractJsonArray } from '@/services/ai/parsing';
import { bm25Retriever, buildContext, type ContextLookup } from '@/services/rag/retrieval';
import { validateCardDrafts, type CardDraft, type RawCardDraft } from '@/services/flashcards/validate';
import type { AnatomyStructure, DocumentChunk, Difficulty, Importance } from '@/types';

/**
 * Propositions de flashcards pour UNE structure anatomique — réutilise
 * `validateCardDrafts` (services/flashcards/validate.ts) tel quel, comme
 * `services/courses/notions.ts` réutilise `validateConcepts` : une carte
 * sourcée et vérifiée est la même chose, qu'elle vienne d'un chapitre entier
 * ou d'une structure sélectionnée dans le visualiseur 3D.
 */

const RETRIEVAL_LIMIT = 6;

export class NoStructureContentError extends Error {
  constructor() {
    super("Aucun passage de tes cours ne mentionne cette structure. Importe d'abord un document qui en parle.");
    this.name = 'NoStructureContentError';
  }
}

function systemPrompt(structure: AnatomyStructure, count: number, context: string): string {
  return `Tu prépares des flashcards de révision pour un étudiant en dentisterie (UMF Iași, section française), sur la structure anatomique « ${structure.name} » (${structure.latinName || 'nom latin non précisé'}), à partir de ses propres extraits de cours numérotés ci-dessous.

Génère jusqu'à ${count} flashcards question/réponse sur cette structure précise (origine, insertion, innervation, fonction, vascularisation, ou tout autre point que les extraits couvrent). Une carte = une notion, pas plusieurs.

RÈGLES ABSOLUES :
- Chaque réponse doit citer la référence de l'extrait qui la soutient, entre crochets : "S1", "S2".
- N'utilise QUE les extraits ci-dessous. N'invente aucune information absente du texte.
- Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ni après, sans balises de code. Format exact :
[{"question":"...","answer":"réponse concise avec sa référence [S1]","refs":["S1"]}]

EXTRAITS DE COURS :
${context}`;
}

export interface GenerateAnatomyCardsInput {
  structure: AnatomyStructure;
  chunks: DocumentChunk[];
  lookup: ContextLookup;
  count?: number;
  importance: Importance;
  difficulty: Difficulty;
  signal?: AbortSignal;
}

export async function generateAnatomyCardDrafts(input: GenerateAnatomyCardsInput): Promise<CardDraft[]> {
  const query = [input.structure.name, input.structure.latinName].filter(Boolean).join(' ');
  const scored = bm25Retriever.retrieve(query, input.chunks, RETRIEVAL_LIMIT);
  if (scored.length === 0) throw new NoStructureContentError();

  const context = buildContext(scored, input.lookup);
  const count = input.count ?? 3;

  const raw = await aiOrchestrator.ask({
    system: systemPrompt(input.structure, count, context.text),
    prompt: `Génère jusqu'à ${count} flashcards sur « ${input.structure.name} », au format JSON.`,
    maxTokens: 2048,
    signal: input.signal,
    task: 'flashcards-generate',
  });

  const rawDrafts = extractJsonArray<RawCardDraft>(raw);
  const drafts = validateCardDrafts(rawDrafts, context, input.importance, input.difficulty, count);
  if (drafts.length === 0) throw new NoStructureContentError();
  return drafts;
}
