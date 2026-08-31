import { aiOrchestrator } from '@/services/ai/orchestrator';
import { verifyCourseAnswer, verifyInternetAnswer, type VerifiedAnswer } from '@/services/ai/tutor';
import { bm25Retriever, buildContext, type ContextLookup } from '@/services/rag/retrieval';
import { anatomyCourseSystemPrompt, anatomyInternetSystemPrompt } from './prompts';
import type { AnatomyStructure, DocumentChunk } from '@/types';

/**
 * Génère la fiche d'une structure anatomique — mode cours d'abord, jamais de
 * mélange avec internet dans la même réponse (§11 du cahier des charges).
 * Réutilise TEL QUEL le mécanisme de vérification de `services/ai/tutor.ts` :
 * une fiche « cours » sans citation vérifiable devient automatiquement
 * `provenance: 'insufficient'`, exactement comme pour le chat.
 */

const RETRIEVAL_LIMIT = 8;

export interface ExplainStructureInput {
  structure: AnatomyStructure;
  chunks: DocumentChunk[];
  lookup: ContextLookup;
  program: string;
  origin: 'course' | 'internet';
  signal?: AbortSignal;
}

export async function explainStructure(input: ExplainStructureInput): Promise<VerifiedAnswer> {
  const query = [input.structure.name, input.structure.latinName].filter(Boolean).join(' ');
  const scored = bm25Retriever.retrieve(query, input.chunks, RETRIEVAL_LIMIT);
  const context = buildContext(scored, input.lookup);

  if (input.origin === 'course') {
    const raw = await aiOrchestrator.ask({
      system: anatomyCourseSystemPrompt(input.structure, context, input.program),
      prompt: `Rédige la fiche de « ${input.structure.name} ».`,
      signal: input.signal,
      task: 'anatomy-explain',
    });
    return verifyCourseAnswer(raw, context);
  }

  const raw = await aiOrchestrator.ask({
    system: anatomyInternetSystemPrompt(input.structure, input.program),
    prompt: `Rédige une fiche brève sur « ${input.structure.name} ».`,
    webSearch: true,
    signal: input.signal,
    task: 'anatomy-explain',
  });
  // Contexte vide en mode internet pur : aucune référence [Sn] ne peut être
  // validée, donc aucune citation de cours ne peut s'y mélanger même si le
  // modèle en invente une — verifyInternetAnswer les retire du texte affiché.
  return verifyInternetAnswer(raw, { text: '', sources: [] });
}
