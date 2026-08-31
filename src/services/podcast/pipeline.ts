import { ask, extractJsonArray, AiRequestError } from '@/services/ai/client';
import { buildContext, type ContextLookup, type ScoredChunk } from '@/services/rag/retrieval';
import { LENGTH_PRESETS } from './plan';
import { analysisSystemPrompt, dialogueSystemPrompt } from './prompts';
import { validateConcepts, validateSegments, hasSubstantiveContent, type RawConcept, type RawSegment } from './validate';
import { estimateTotalDuration } from './plan';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import type { DocumentChunk, ID, PodcastEpisode, PodcastLength } from '@/types';

/**
 * Pipeline de génération d'un épisode, tel que spécifié :
 *
 *   Cours → Analyse → Extraction des notions → Priorisation → Plan
 *         → Dialogue → Validation → (Audio et lecteur : voir services/tts)
 *
 * Chaque étape s'appuie sur la précédente. Le dialogue n'est jamais généré
 * directement depuis le texte brut : il part des notions déjà extraites et
 * déjà sourcées, ce qui borne ce que la deuxième étape peut raconter.
 */

/** Budget de contexte plus large que le chat : le podcast doit couvrir tout le chapitre, pas répondre à une question ciblée. */
const ANALYSIS_CONTEXT_BUDGET = 32_000;

export class InsufficientCourseContentError extends Error {
  constructor() {
    super(
      "Ce chapitre ne contient pas assez de contenu indexé pour construire un podcast. Importe d'abord un document.",
    );
    this.name = 'InsufficientCourseContentError';
  }
}

/** Transforme des fragments en pseudo-résultats de recherche, dans l'ordre naturel de lecture — il n'y a pas de question à noter ici. */
function chunksInReadingOrder(chunks: DocumentChunk[]): ScoredChunk[] {
  return [...chunks]
    .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.index - b.index)
    .map((chunk) => ({ chunk, score: 0, matchedTerms: [] }));
}

export interface GeneratePodcastInput {
  subjectId: ID;
  chapterId: ID | null;
  title: string;
  length: PodcastLength;
  enrichedWithInternet: boolean;
  chunks: DocumentChunk[];
  lookup: ContextLookup;
  program: string;
  /** Rappelé à chaque étape franchie, pour afficher une progression honnête. */
  onStage?: (stage: 'analyse' | 'plan' | 'dialogue' | 'validation') => void;
  signal?: AbortSignal;
}

export async function generatePodcastEpisode(input: GeneratePodcastInput): Promise<PodcastEpisode> {
  const preset = LENGTH_PRESETS[input.length];

  if (input.chunks.length === 0) throw new InsufficientCourseContentError();

  // ── 1. Analyse : sélection des notions, appuyées sur des extraits réels ──
  input.onStage?.('analyse');
  const analysisContext = buildContext(
    chunksInReadingOrder(input.chunks),
    input.lookup,
    ANALYSIS_CONTEXT_BUDGET,
  );

  const rawAnalysis = await ask({
    system: analysisSystemPrompt(preset, analysisContext),
    prompt: `Sélectionne les ${preset.conceptCount} notions les plus importantes de ce chapitre pour un podcast "${preset.label}".`,
    maxTokens: 2048,
    signal: input.signal,
  });
  const rawConcepts = extractJsonArray<RawConcept>(rawAnalysis);
  const concepts = validateConcepts(rawConcepts, analysisContext, preset.conceptCount);

  if (concepts.length === 0) throw new InsufficientCourseContentError();

  // ── 2. Plan : implicite ici — le budget de répliques et l'ordre des notions
  //    sont déjà fixés par `preset` et l'ordre de `concepts`. Le découper en
  //    emplacements rigides figerait la conversation ; le modèle compose
  //    librement le dialogue à l'intérieur de ce cadre.
  input.onStage?.('plan');

  // Le contexte transmis à l'étape 2 ne contient QUE les extraits qui
  // soutiennent une notion retenue : le dialogue ne peut donc citer que des
  // passages déjà validés comme pertinents à l'étape 1.
  const usedChunkIds = new Set(concepts.flatMap((concept) => concept.citations.map((c) => c.chunkId)));
  const dialogueContext = {
    text: analysisContext.text,
    sources: analysisContext.sources.filter((source) => usedChunkIds.has(source.chunkId)),
  };
  // Reconstruit le bloc de texte pour ne garder que les références utilisées,
  // afin que le prompt du dialogue reste concentré sur les notions choisies.
  const keptRefs = new Set(dialogueContext.sources.map((s) => s.ref));
  dialogueContext.text = analysisContext.text
    .split(/\n\n---\n\n/)
    .filter((block) => {
      const match = /^\[(S\d+)\]/.exec(block);
      return match ? keptRefs.has(match[1]!) : false;
    })
    .join('\n\n---\n\n');

  // ── 3. Dialogue ──
  input.onStage?.('dialogue');
  const rawDialogue = await ask({
    system: dialogueSystemPrompt(preset, concepts, dialogueContext, input.enrichedWithInternet),
    prompt: `Écris le dialogue complet, en respectant le format JSON demandé.`,
    maxTokens: 8192,
    webSearch: input.enrichedWithInternet,
    signal: input.signal,
  });
  const rawSegments = extractJsonArray<RawSegment>(rawDialogue);

  // ── 4. Validation ──
  input.onStage?.('validation');
  const segments = validateSegments(rawSegments, dialogueContext, input.enrichedWithInternet);

  if (!hasSubstantiveContent(segments)) {
    throw new AiRequestError(
      "Le dialogue généré ne contenait aucune affirmation vérifiable par rapport à tes cours. Réessaie, ou importe davantage de contenu dans ce chapitre.",
    );
  }

  const episode: PodcastEpisode = {
    id: uid('pod'),
    subjectId: input.subjectId,
    chapterId: input.chapterId,
    title: input.title,
    length: input.length,
    enrichedWithInternet: input.enrichedWithInternet,
    concepts,
    segments,
    estimatedDurationSec: estimateTotalDuration(segments),
    createdAt: nowISO(),
  };

  return episode;
}
