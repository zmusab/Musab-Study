import { uid } from '@/lib/id';
import { extractReferences } from '@/services/ai/tutor';
import { estimateSegmentDuration } from './plan';
import type { RetrievedContext } from '@/services/rag/retrieval';
import type { Citation, Importance, PodcastConcept, PodcastSegment, PodcastSegmentType } from '@/types';

/**
 * Vérification des sorties de l'IA pour le podcast — même principe que pour
 * l'assistant IA (services/ai/tutor.ts), étendu à deux étapes.
 *
 * La garantie n'est jamais « le modèle a promis de ne pas inventer ». Elle est
 * structurelle : une affirmation factuelle sur le cours n'est acceptée que si
 * elle cite un extrait réellement transmis. Ce que le modèle ne peut pas
 * prouver, il ne l'obtient pas — la réplique reste affichée (la conversation
 * ne doit pas se briser), mais sans étiquette « issu de ton cours ».
 */

// ─────────────────────── Étape 1 : notions extraites ───────────────────────

/** Forme brute attendue du modèle pour une notion — non typée avant validation. */
export interface RawConcept {
  label?: unknown;
  importance?: unknown;
  pitfall?: unknown;
  refs?: unknown;
}

function clampImportance(value: unknown): Importance {
  const n = Number(value);
  return n === 1 || n === 3 ? n : 2;
}

/**
 * Valide les notions proposées par l'étape d'analyse.
 * Une notion sans la moindre citation vérifiable est écartée : on ne construit
 * pas un podcast sur une affirmation qu'on ne peut pas rattacher au cours.
 */
export function validateConcepts(
  raw: RawConcept[],
  context: RetrievedContext,
  limit: number,
): PodcastConcept[] {
  const byRef = new Map(context.sources.map((source) => [source.ref, source]));
  const concepts: PodcastConcept[] = [];

  for (const item of raw) {
    if (typeof item.label !== 'string' || item.label.trim().length === 0) continue;
    const refs = Array.isArray(item.refs) ? item.refs.filter((r): r is string => typeof r === 'string') : [];
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

    concepts.push({
      id: uid('cpt'),
      label: item.label.trim(),
      importance: clampImportance(item.importance),
      isPitfall: item.pitfall === true,
      citations,
    });

    if (concepts.length >= limit) break;
  }

  return concepts;
}

// ─────────────────────────── Étape 2 : dialogue ───────────────────────────

const VALID_TYPES = new Set<PodcastSegmentType>([
  'intro', 'concept', 'explanation', 'example', 'pitfall', 'connection', 'recap', 'quiz',
]);
/**
 * Types de répliques qui portent une affirmation factuelle sur le cours et
 * doivent donc être sourcés. Les autres (introduction, exemple clinique
 * fictif, transition, question de mini-interrogation) sont légitimement sans
 * citation — le demander casserait le naturel de la conversation.
 */
const REQUIRES_SOURCE = new Set<PodcastSegmentType>(['concept', 'explanation', 'pitfall', 'connection']);

/** Forme brute d'une réplique produite par le modèle. */
export interface RawSegment {
  speaker?: unknown;
  type?: unknown;
  source?: unknown;
  text?: unknown;
}

/**
 * Valide et enrichit les répliques du dialogue.
 *
 * `enrichedWithInternet` détermine si une réplique déclarée `source:"internet"`
 * est acceptée comme telle. Si le mode internet n'a pas été activé pour cette
 * génération mais que le modèle en produit quand même, la réplique est
 * rétrogradée — on ne fait jamais confiance à la seule déclaration du modèle
 * pour une garantie de provenance.
 */
export function validateSegments(
  raw: RawSegment[],
  context: RetrievedContext,
  enrichedWithInternet: boolean,
): PodcastSegment[] {
  const byRef = new Map(context.sources.map((source) => [source.ref, source]));
  const segments: PodcastSegment[] = [];

  for (const item of raw) {
    if (typeof item.text !== 'string' || item.text.trim().length === 0) continue;
    const speaker = item.speaker === 'A' || item.speaker === 'B' ? item.speaker : null;
    if (!speaker) continue;
    const type: PodcastSegmentType = VALID_TYPES.has(item.type as PodcastSegmentType)
      ? (item.type as PodcastSegmentType)
      : 'explanation';

    const declaredSource = item.source === 'internet' ? 'internet' : item.source === 'cours' ? 'cours' : 'none';
    const cited = extractReferences(item.text);
    const validRefs = cited.filter((ref) => byRef.has(ref));
    const invalidRefs = cited.filter((ref) => !byRef.has(ref));
    // Les références inventées sont retirées du texte affiché : elles ne
    // doivent jamais laisser croire à une source qui n'existe pas.
    const text = invalidRefs.reduce((current, ref) => current.replaceAll(`[${ref}]`, ''), item.text).trim();

    let provenance: PodcastSegment['provenance'] = null;
    let citations: Citation[] = [];

    if (declaredSource === 'internet') {
      provenance = enrichedWithInternet ? 'internet' : 'insufficient';
    } else if (validRefs.length > 0) {
      provenance = 'course';
      citations = validRefs.map((ref) => {
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
    } else if (REQUIRES_SOURCE.has(type)) {
      // Affirmation factuelle sans aucune source valide : on la garde à
      // l'écran pour ne pas casser l'échange, mais sans lui attribuer une
      // provenance qu'on ne peut pas prouver.
      provenance = 'insufficient';
    }

    segments.push({
      id: uid('seg'),
      speaker,
      type,
      text,
      provenance,
      citations,
      estimatedDurationSec: estimateSegmentDuration(text),
    });
  }

  return segments;
}

/** Vrai si le dialogue contient au moins une réplique de contenu réel (hors intro/recap/quiz). */
export function hasSubstantiveContent(segments: PodcastSegment[]): boolean {
  return segments.some((segment) => REQUIRES_SOURCE.has(segment.type) && segment.provenance === 'course');
}
