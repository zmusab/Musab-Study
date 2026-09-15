import type { ContextLookup } from '@/services/rag/retrieval';
import type { Citation, DocumentChunk } from '@/types';

/**
 * Construit une citation directement depuis un chunk + son contexte — même
 * forme que `buildContext` produit pour le chemin IA, mais sans passer par
 * un modèle : l'extrait est le texte réel du fragment, jamais reformulé.
 */
export function citationFromChunk(chunk: DocumentChunk, lookup: ContextLookup, excerpt: string): Citation {
  const document = lookup.documents.get(chunk.documentId);
  const chapter = lookup.chapters.get(chunk.chapterId);
  const subject = lookup.subjects.get(chunk.subjectId);

  return {
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentName: document?.name ?? 'Document',
    chapterId: chunk.chapterId,
    chapterName: chapter?.name ?? 'Chapitre',
    subjectName: subject?.name ?? 'Matière',
    excerpt: excerpt.slice(0, 320),
    page: chunk.pageStart,
  };
}
