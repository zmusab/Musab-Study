import { uid } from '@/lib/id';
import type { RetrievedContext } from '@/services/rag/retrieval';
import type { Citation, Importance, Notion } from '@/types';

/**
 * Vérification des notions produites par l'IA — même principe que pour
 * l'assistant (services/ai/tutor.ts).
 *
 * La garantie n'est jamais « le modèle a promis de ne pas inventer ». Elle est
 * structurelle : une notion n'est retenue que si elle cite un extrait
 * RÉELLEMENT transmis au modèle. Ce qu'il ne peut pas prouver, il ne l'obtient
 * pas.
 *
 * Les notions alimentent l'onglet « Notions » d'une matière et le quiz
 * « Examen probable ».
 */

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
 * Une notion sans la moindre citation vérifiable est écartée : on ne fait pas
 * réviser un étudiant sur une affirmation qu'on ne peut pas rattacher à son
 * cours.
 */
export function validateConcepts(
  raw: RawConcept[],
  context: RetrievedContext,
  limit: number,
): Notion[] {
  const byRef = new Map(context.sources.map((source) => [source.ref, source]));
  const concepts: Notion[] = [];

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
