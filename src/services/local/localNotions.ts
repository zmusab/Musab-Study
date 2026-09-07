import { extractFacts, type RawFact } from './relationExtraction';
import { comparisonKey } from '@/core/text';
import { splitIntoSentences } from './textStructure';
import { citationFromChunk } from './citation';
import type { ContextLookup } from '@/services/rag/retrieval';
import { uid } from '@/lib/id';
import type { DocumentChunk, ID, Importance, PodcastConcept } from '@/types';

/**
 * Notions de chapitre SANS IA — moteur à règles, à partir des mêmes relations
 * détectées par `relationExtraction.ts`.
 *
 * `LocalNotion` est un type PROPRE, indépendant de `PodcastConcept` (imposé
 * après revue) : le moteur local ne doit pas se coupler à une forme pensée
 * pour un pipeline IA différent simplement parce que `ChapterAnalysis`
 * l'utilise aujourd'hui. `toPodcastConcept`/`localNotionsToPodcastConcepts`
 * ne convertissent vers cette forme persistante qu'au moment d'écrire dans
 * `ChapterAnalysis` — aucun changement de schéma Dexie.
 */

export interface LocalNotion {
  label: string;
  /** Définition détectée (fait de type 'definition'), sinon `null`. */
  definition: string | null;
  importance: Importance;
  isPitfall: boolean;
  sourceChunkId: ID;
  /** Sous-extrait exact du chunk source. */
  sourceExcerpt: string;
}

// Pas de `\b` en tête de « à ne pas confondre » : « à » entouré d'espaces n'a
// jamais de frontière `\b` adjacente en JavaScript (voir relationExtraction.ts) —
// « ne pas confondre » seul suffit de toute façon à couvrir ce cas.
const PITFALL_MARKERS = /\b(?:attention|ne pas confondre|piège|erreur fréquente)\b/i;

/** Normalisation partagée — voir `core/text`, une seule définition pour tout le projet. */
const normalizeLabel = comparisonKey;

export interface GenerateLocalNotionsInput {
  chunks: DocumentChunk[];
  count: number;
}

/**
 * Regroupe les faits détectés par sujet (même terme normalisé) : chaque
 * groupe devient une notion. L'importance suit la fréquence d'apparition du
 * terme et la présence d'une définition explicite — jamais devinée, jamais
 * demandée à un modèle.
 */
export function generateLocalNotions(input: GenerateLocalNotionsInput): LocalNotion[] {
  const facts: RawFact[] = [];
  for (const chunk of input.chunks) {
    facts.push(...extractFacts(chunk).filter((fact) => fact.confidence !== 'low'));
  }

  const bySubject = new Map<string, RawFact[]>();
  for (const fact of facts) {
    const key = normalizeLabel(fact.subject);
    if (key.length === 0) continue;
    const group = bySubject.get(key);
    if (group) group.push(fact);
    else bySubject.set(key, [fact]);
  }

  // Un avertissement ("Attention à ne pas confondre X et Y.") vit souvent
  // dans sa PROPRE phrase, sans motif de relation reconnu — il ne produit
  // donc jamais de RawFact lui-même. On le rattache à une notion existante
  // en le cherchant dans TOUTES les phrases du chapitre, pas seulement dans
  // l'excerpt de chaque fait.
  const pitfallSentences = input.chunks.flatMap((chunk) =>
    splitIntoSentences(chunk.text).filter((sentence) => PITFALL_MARKERS.test(sentence)),
  );

  const notions: LocalNotion[] = [];
  for (const group of bySubject.values()) {
    const definitionFact = group.find((fact) => fact.predicate === 'definition') ?? null;
    const anchor = definitionFact ?? group[0]!;
    const occurrences = group.length;
    const importance: Importance = definitionFact || occurrences >= 3 ? 3 : occurrences === 2 ? 2 : 1;
    const subjectKey = normalizeLabel(anchor.subject);

    notions.push({
      label: anchor.subject,
      definition: definitionFact ? definitionFact.object : null,
      importance,
      isPitfall:
        group.some((fact) => PITFALL_MARKERS.test(fact.sourceExcerpt)) ||
        pitfallSentences.some((sentence) => normalizeLabel(sentence).includes(subjectKey)),
      sourceChunkId: anchor.sourceChunkId,
      sourceExcerpt: anchor.sourceExcerpt,
    });
  }

  return notions.sort((a, b) => b.importance - a.importance).slice(0, input.count);
}

/** Adaptateur — appelé UNIQUEMENT au moment de persister dans `ChapterAnalysis`. */
export function toPodcastConcept(notion: LocalNotion, chunk: DocumentChunk, lookup: ContextLookup): PodcastConcept {
  return {
    id: uid('cpt'),
    label: notion.label,
    importance: notion.importance,
    isPitfall: notion.isPitfall,
    citations: [citationFromChunk(chunk, lookup, notion.sourceExcerpt)],
  };
}

/** Convertit un lot de notions locales — retrouve chaque chunk source par id. */
export function localNotionsToPodcastConcepts(
  notions: readonly LocalNotion[],
  chunks: readonly DocumentChunk[],
  lookup: ContextLookup,
): PodcastConcept[] {
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return notions
    .map((notion) => {
      const chunk = chunksById.get(notion.sourceChunkId);
      return chunk ? toPodcastConcept(notion, chunk, lookup) : null;
    })
    .filter((concept): concept is PodcastConcept => concept !== null);
}
