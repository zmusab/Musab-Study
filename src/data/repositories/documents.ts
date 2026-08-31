import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import { chunkDocument } from '@/services/rag/chunking';
import type { DocumentChunk, DocumentFile, DocumentSource, ID, StudyDocument } from '@/types';

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
  /** Offsets de page dans `text` — voir `ExtractedPdf.pageOffsets`. Vide pour un document collé. */
  pageOffsets?: number[];
  /**
   * Le PDF ORIGINAL. Conservé intact et consultable dans le lecteur intégré —
   * `text` n'en est qu'une extraction au service de l'IA, jamais un
   * remplacement. Absent pour un document collé à la main.
   */
  file?: File;
}

/**
 * Ajoute un document ET l'indexe pour le RAG dans la même transaction.
 * Un document sans ses chunks serait invisible pour l'IA : les deux écritures
 * réussissent ou échouent ensemble.
 *
 * Le PDF original (s'il y en a un) et sa miniature sont écrits séparément :
 * générer la miniature demande de rouvrir le fichier avec pdf.js, une
 * opération asynchrone qu'il vaut mieux garder hors de la transaction
 * Dexie (qui doit rester courte pour ne pas bloquer les autres écritures).
 *
 * `renderThumbnail` est importé dynamiquement plutôt qu'en tête de fichier :
 * ce module (comme `documents.ts` tout entier) est utilisé par des écrans qui
 * n'ont jamais besoin de rendre un PDF — l'assistant IA ou les flashcards ne
 * font que lister des fragments. Un import statique aurait entraîné pdf.js
 * (~1,4 Mo) dans LEUR chunk, ruinant le découpage par route déjà en place.
 */
export async function addDocument(input: AddDocumentInput): Promise<StudyDocument> {
  const text = input.text.trim();
  const pageOffsets = input.pageOffsets ?? [];

  const thumbnail = input.file
    ? await (await import('@/services/pdf/render')).renderThumbnail(input.file)
    : null;

  const doc: StudyDocument = {
    id: uid('doc'),
    subjectId: input.subjectId,
    chapterId: input.chapterId,
    name: input.name.trim() || 'Document sans nom',
    text,
    pageOffsets,
    source: input.source,
    pageCount: input.pageCount ?? null,
    charCount: text.length,
    thumbnail,
    lastReadPage: 1,
    lastOpenedAt: null,
    createdAt: nowISO(),
  };

  const chunks: DocumentChunk[] = chunkDocument(text, pageOffsets).map((chunk) => ({
    id: uid('chk'),
    documentId: doc.id,
    chapterId: doc.chapterId,
    subjectId: doc.subjectId,
    index: chunk.index,
    text: chunk.text,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    termFreq: chunk.termFreq,
    tokenCount: chunk.tokenCount,
    embedding: null,
  }));

  await db.transaction('rw', [db.documents, db.chunks, db.documentFiles], async () => {
    await db.documents.add(doc);
    if (chunks.length > 0) await db.chunks.bulkAdd(chunks);
    if (input.file) await db.documentFiles.add({ documentId: doc.id, blob: input.file });
  });

  return doc;
}

/** Le PDF original d'un document, pour le lecteur intégré. Null s'il a été collé à la main. */
export async function getDocumentFile(documentId: ID): Promise<DocumentFile | undefined> {
  return db.documentFiles.get(documentId);
}

/** Mémorise la page atteinte, pour reprendre la lecture là où elle s'est arrêtée. */
export async function updateLastReadPage(documentId: ID, page: number): Promise<void> {
  await db.documents.update(documentId, { lastReadPage: page });
}

/** Marque le document comme consulté maintenant — alimente « Continuer mes cours » sur l'accueil. */
export async function recordDocumentOpened(documentId: ID, now: Date = new Date()): Promise<void> {
  await db.documents.update(documentId, { lastOpenedAt: now.toISOString() });
}

/** Documents les plus récemment ouverts dans le lecteur, tous chapitres confondus. */
export async function listRecentlyOpenedDocuments(limit: number): Promise<DocumentSummary[]> {
  const docs = await db.documents.filter((doc) => doc.lastOpenedAt !== null).toArray();
  return docs
    .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))
    .slice(0, limit)
    .map(toSummary);
}

export async function renameDocument(id: ID, name: string): Promise<void> {
  await db.documents.update(id, { name: name.trim() || 'Document sans nom' });
}

export async function deleteDocument(id: ID): Promise<void> {
  await db.transaction('rw', [db.documents, db.chunks, db.documentFiles], async () => {
    await db.documents.delete(id);
    await db.chunks.where('documentId').equals(id).delete();
    await db.documentFiles.delete(id);
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
