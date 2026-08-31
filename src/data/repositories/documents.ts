import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import { chunkDocument } from '@/services/rag/chunking';
import type { DocumentChunk, DocumentSource, ID, StudyDocument } from '@/types';

/** Métadonnées d'un document, SANS son texte intégral. */
export type DocumentSummary = Omit<StudyDocument, 'text'>;

function toSummary(doc: StudyDocument): DocumentSummary {
  const { text: _text, ...summary } = doc;
  return summary;
}

/**
 * Liste les documents d'un chapitre sans jamais charger leur texte.
 * Afficher « Anatomie.pdf — 82 400 caractères » ne doit pas coûter 82 ko de
 * mémoire par document.
 */
export async function listChapterDocuments(chapterId: ID): Promise<DocumentSummary[]> {
  const docs = await db.documents.where('chapterId').equals(chapterId).toArray();
  return docs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(toSummary);
}

export async function listSubjectDocuments(subjectId: ID): Promise<DocumentSummary[]> {
  const docs = await db.documents.where('subjectId').equals(subjectId).toArray();
  return docs.map(toSummary);
}

export async function getDocument(id: ID): Promise<StudyDocument | undefined> {
  return db.documents.get(id);
}

export interface AddDocumentInput {
  subjectId: ID;
  chapterId: ID;
  name: string;
  text: string;
  source: DocumentSource;
  pageCount?: number | null;
}

/**
 * Ajoute un document ET l'indexe pour le RAG dans la même transaction.
 * Un document sans ses chunks serait invisible pour l'IA : les deux écritures
 * réussissent ou échouent ensemble.
 */
export async function addDocument(input: AddDocumentInput): Promise<StudyDocument> {
  const text = input.text.trim();
  const doc: StudyDocument = {
    id: uid('doc'),
    subjectId: input.subjectId,
    chapterId: input.chapterId,
    name: input.name.trim() || 'Document sans nom',
    text,
    source: input.source,
    pageCount: input.pageCount ?? null,
    charCount: text.length,
    createdAt: nowISO(),
  };

  const chunks: DocumentChunk[] = chunkDocument(text).map((chunk) => ({
    id: uid('chk'),
    documentId: doc.id,
    chapterId: doc.chapterId,
    subjectId: doc.subjectId,
    index: chunk.index,
    text: chunk.text,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    termFreq: chunk.termFreq,
    tokenCount: chunk.tokenCount,
    embedding: null,
  }));

  await db.transaction('rw', [db.documents, db.chunks], async () => {
    await db.documents.add(doc);
    if (chunks.length > 0) await db.chunks.bulkAdd(chunks);
  });

  return doc;
}

export async function renameDocument(id: ID, name: string): Promise<void> {
  await db.documents.update(id, { name: name.trim() || 'Document sans nom' });
}

export async function deleteDocument(id: ID): Promise<void> {
  await db.transaction('rw', [db.documents, db.chunks], async () => {
    await db.documents.delete(id);
    await db.chunks.where('documentId').equals(id).delete();
  });
}

/** Chunks d'une portée donnée — la matière entière, ou un seul chapitre. */
export async function listChunks(scope: {
  subjectId: ID;
  chapterId?: ID | null;
}): Promise<DocumentChunk[]> {
  if (scope.chapterId) {
    return db.chunks.where('chapterId').equals(scope.chapterId).toArray();
  }
  return db.chunks.where('subjectId').equals(scope.subjectId).toArray();
}
