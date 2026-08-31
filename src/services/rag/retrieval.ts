import type { Chapter, DocumentChunk, StudyDocument, Subject } from '@/types';
import { tokenize } from './tokenize';

/**
 * Récupération lexicale BM25 sur les fragments de cours.
 *
 * Pourquoi BM25 et pas des embeddings : Anthropic ne propose pas d'API
 * d'embeddings. Un vrai moteur sémantique exigerait soit une seconde clé chez
 * un autre fournisseur, soit un modèle de ~30 Mo à télécharger dans le
 * navigateur. BM25 fonctionne immédiatement, hors ligne, sans clé, et se
 * comporte très bien sur de la terminologie médicale — un domaine où le mot
 * exact (« massétérique », « V3 ») compte davantage que le sens approché.
 *
 * L'interface `Retriever` ci-dessous existe pour qu'un moteur à embeddings
 * puisse s'y substituer plus tard sans toucher au reste de l'application.
 */

/** Pondère la saturation de fréquence : au-delà, répéter un mot n'aide plus. */
const K1 = 1.5;
/** Pondère la normalisation par la longueur du fragment. */
const B = 0.75;

export interface ScoredChunk {
  chunk: DocumentChunk;
  score: number;
  /** Termes de la question effectivement présents dans ce fragment. */
  matchedTerms: string[];
}

export interface Retriever {
  retrieve(query: string, chunks: DocumentChunk[], limit: number): ScoredChunk[];
}

function inverseDocumentFrequency(term: string, chunks: DocumentChunk[]): number {
  const containing = chunks.reduce(
    (count, chunk) => count + (chunk.termFreq[term] ? 1 : 0),
    0,
  );
  if (containing === 0) return 0;
  // Forme lissée : toujours positive, même pour un terme présent partout.
  return Math.log(1 + (chunks.length - containing + 0.5) / (containing + 0.5));
}

export const bm25Retriever: Retriever = {
  retrieve(query, chunks, limit) {
    if (chunks.length === 0) return [];

    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];

    const averageLength =
      chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / chunks.length || 1;

    const idf = new Map(terms.map((term) => [term, inverseDocumentFrequency(term, chunks)]));

    const scored: ScoredChunk[] = [];
    for (const chunk of chunks) {
      let score = 0;
      const matchedTerms: string[] = [];

      for (const term of terms) {
        const frequency = chunk.termFreq[term];
        if (!frequency) continue;
        matchedTerms.push(term);
        const normalized =
          frequency * (K1 + 1) /
          (frequency + K1 * (1 - B + B * (chunk.tokenCount / averageLength)));
        score += (idf.get(term) ?? 0) * normalized;
      }

      if (score > 0) scored.push({ chunk, score, matchedTerms });
    }

    return scored
      .sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
      .slice(0, limit);
  },
};

/** Contexte assemblé, prêt à être transmis au modèle. */
export interface RetrievedContext {
  /** Bloc de texte étiqueté, envoyé dans le prompt. */
  text: string;
  /** Fragments réellement transmis — la seule source citable. */
  sources: {
    ref: string;
    chunkId: string;
    documentId: string;
    documentName: string;
    chapterId: string;
    chapterName: string;
    subjectName: string;
    excerpt: string;
    page: number | null;
  }[];
}

export interface ContextLookup {
  subjects: Map<string, Subject>;
  chapters: Map<string, Chapter>;
  documents: Map<string, Pick<StudyDocument, 'id' | 'name'>>;
}

/** Budget de caractères de contexte, largement sous la limite du modèle. */
export const CONTEXT_CHAR_BUDGET = 24_000;

/**
 * Assemble le contexte à envoyer au modèle.
 *
 * Chaque fragment reçoit une référence courte et stable (`S1`, `S2`, …) que le
 * modèle doit citer. Comme la liste des sources est construite ICI, à partir
 * des fragments réellement inclus, une citation ne peut désigner qu'un passage
 * qui a bien été transmis : c'est ce qui rend la vérification possible, plutôt
 * que de faire confiance au modèle.
 */
export function buildContext(
  scored: ScoredChunk[],
  lookup: ContextLookup,
  budget = CONTEXT_CHAR_BUDGET,
): RetrievedContext {
  const sources: RetrievedContext['sources'] = [];
  const blocks: string[] = [];
  let remaining = budget;

  for (const [index, { chunk }] of scored.entries()) {
    if (remaining <= 0) break;

    const document = lookup.documents.get(chunk.documentId);
    const chapter = lookup.chapters.get(chunk.chapterId);
    const subject = lookup.subjects.get(chunk.subjectId);

    const text = chunk.text.slice(0, remaining);
    const ref = `S${index + 1}`;

    const documentName = document?.name ?? 'Document';
    const chapterName = chapter?.name ?? 'Chapitre';
    const subjectName = subject?.name ?? 'Matière';

    const pageLabel = chunk.pageStart === null ? '' : ` (page ${chunk.pageStart})`;
    blocks.push(
      `[${ref}] ${subjectName} › ${chapterName} › ${documentName}${pageLabel}\n${text}`,
    );
    sources.push({
      ref,
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName,
      chapterId: chunk.chapterId,
      chapterName,
      subjectName,
      excerpt: text.slice(0, 320),
      page: chunk.pageStart,
    });

    remaining -= text.length;
  }

  return { text: blocks.join('\n\n---\n\n'), sources };
}
