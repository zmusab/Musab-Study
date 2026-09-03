import { aiOrchestrator } from '@/services/ai/orchestrator';
import { extractJsonArray } from '@/services/ai/parsing';
import { buildContext, type ContextLookup, type ScoredChunk } from '@/services/rag/retrieval';
import { validateConcepts, type RawConcept } from '@/services/podcast/validate';
import { generateLocalNotions, localNotionsToPodcastConcepts } from '@/services/local/localNotions';
import type { DocumentChunk, PodcastConcept } from '@/types';

/**
 * Détection des notions d'un chapitre — réutilise EXACTEMENT le mécanisme de
 * vérification du pipeline podcast (`PodcastConcept`, `validateConcepts`) :
 * une notion sourcée et vérifiée est la même chose, qu'elle serve à préparer
 * un podcast ou à peupler l'onglet « Notions » d'une matière. Seul le prompt
 * change, parce que le cadrage n'est pas le même (ici on identifie les
 * notions clés d'un cours, pas le contenu d'un podcast).
 *
 * SOURCE PAR DÉFAUT : le moteur local (`services/local/localNotions.ts`),
 * sans le moindre appel réseau — Musab Study doit rester utilisable sans API
 * IA externe. L'IA reste disponible via `source: 'ai'`, un choix explicite
 * (bouton « Régénérer avec l'IA »), avec un comportement strictement
 * inchangé par rapport à avant ce chantier.
 */

const NOTIONS_CONTEXT_BUDGET = 32_000;

export class InsufficientChapterContentError extends Error {
  constructor() {
    super("Ce chapitre ne contient pas assez de contenu indexé pour être analysé. Importe d'abord un document.");
    this.name = 'InsufficientChapterContentError';
  }
}

function chunksInReadingOrder(chunks: DocumentChunk[]): ScoredChunk[] {
  return [...chunks]
    .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.index - b.index)
    .map((chunk) => ({ chunk, score: 0, matchedTerms: [] }));
}

function notionsSystemPrompt(count: number, contextText: string): string {
  return `Tu identifies les notions clés d'un chapitre de cours pour un étudiant en dentisterie (UMF Iași, section française), à partir de ses propres extraits de cours numérotés ci-dessous.

Ta tâche : repérer jusqu'à ${count} notions importantes — définitions, structures anatomiques, mécanismes, classifications, valeurs à retenir — qu'un étudiant doit connaître pour maîtriser ce chapitre.

RÈGLES ABSOLUES :
- Chaque notion doit être appuyée par au moins une référence d'extrait, entre crochets : "S1", "S2".
- N'utilise QUE les extraits ci-dessous. N'invente aucune notion absente du texte.
- Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ni après, sans balises de code. Format exact :
[{"label":"nom concis de la notion","importance":1|2|3,"pitfall":true|false,"refs":["S1","S2"]}]
- "importance" : 3 si essentielle, 1 si secondaire, 2 sinon.
- "pitfall" : true si c'est une source fréquente de confusion ou d'erreur.

EXTRAITS DE COURS :
${contextText}`;
}

export interface AnalyzeChapterInput {
  chunks: DocumentChunk[];
  lookup: ContextLookup;
  /** Nombre maximal de notions retenues. */
  count?: number;
  signal?: AbortSignal;
  /**
   * 'local' (par défaut) : moteur à règles, aucun appel réseau. 'ai' :
   * régénération explicite via l'IA — comportement strictement identique à
   * avant ce chantier, jamais choisi automatiquement.
   */
  source?: 'local' | 'ai';
}

/** Analyse un chapitre et renvoie ses notions, sourcées et vérifiées — jamais de simulation en cas d'échec. */
export async function analyzeChapter(input: AnalyzeChapterInput): Promise<PodcastConcept[]> {
  if (input.chunks.length === 0) throw new InsufficientChapterContentError();

  const count = input.count ?? 15;

  if ((input.source ?? 'local') === 'local') {
    const notions = generateLocalNotions({ chunks: input.chunks, count });
    const concepts = localNotionsToPodcastConcepts(notions, input.chunks, input.lookup);
    if (concepts.length === 0) throw new InsufficientChapterContentError();
    return concepts;
  }

  const context = buildContext(chunksInReadingOrder(input.chunks), input.lookup, NOTIONS_CONTEXT_BUDGET);

  const raw = await aiOrchestrator.ask({
    system: notionsSystemPrompt(count, context.text),
    prompt: `Identifie jusqu'à ${count} notions clés de ce chapitre.`,
    maxTokens: 2048,
    signal: input.signal,
    task: 'course-notions',
  });

  const rawConcepts = extractJsonArray<RawConcept>(raw);
  const concepts = validateConcepts(rawConcepts, context, count);

  if (concepts.length === 0) throw new InsufficientChapterContentError();

  return concepts;
}
