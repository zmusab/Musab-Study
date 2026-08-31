import { db, clearAllData } from '@/data/db';
import { nowISO } from '@/lib/date';
import { uid } from '@/lib/id';
import { chunkDocument } from '@/services/rag/chunking';
import type { BackupBundle, DocumentChunk, StudyDocument } from '@/types';

/**
 * Sauvegarde, restauration et migration depuis le prototype.
 *
 * La clé API n'est jamais incluse : un fichier de sauvegarde peut être envoyé
 * par courriel ou déposé dans un nuage, il ne doit pas contenir de secret.
 */

export async function exportBackup(): Promise<BackupBundle> {
  const [
    profile,
    subjects,
    chapters,
    documents,
    flashcards,
    quizQuestions,
    reviewLogs,
    notes,
    calendarEvents,
    anatomyStructures,
    anatomySheets,
    chatMessages,
    podcastEpisodes,
  ] = await Promise.all([
    db.profile.get('me'),
    db.subjects.toArray(),
    db.chapters.toArray(),
    db.documents.toArray(),
    db.flashcards.toArray(),
    db.quizQuestions.toArray(),
    db.reviewLogs.toArray(),
    db.notes.toArray(),
    db.calendarEvents.toArray(),
    db.anatomyStructures.toArray(),
    db.anatomySheets.toArray(),
    db.chatMessages.toArray(),
    db.podcastEpisodes.toArray(),
  ]);

  return {
    v: 2,
    exportedAt: nowISO(),
    profile: profile ?? null,
    subjects,
    chapters,
    // Les fragments ne sont pas exportés : ils sont recalculés à l'import.
    // Cela divise la taille du fichier par deux sans perte d'information.
    documents,
    flashcards,
    quizQuestions,
    reviewLogs,
    notes,
    calendarEvents,
    anatomyStructures,
    anatomySheets,
    chatMessages,
    podcastEpisodes,
  };
}

export interface ImportReport {
  subjects: number;
  chapters: number;
  documents: number;
  flashcards: number;
  quizQuestions: number;
  reviewLogs: number;
  notes: number;
  calendarEvents: number;
  anatomyStructures: number;
  /** Vrai si le fichier venait du prototype HTML d'origine. */
  fromLegacyPrototype: boolean;
}

function rebuildChunks(documents: StudyDocument[]): DocumentChunk[] {
  return documents.flatMap((doc) =>
    chunkDocument(doc.text).map((chunk) => ({
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
    })),
  );
}

/**
 * Restaure une sauvegarde. REMPLACE les données existantes : la restauration
 * doit produire l'état exact du fichier, pas une fusion imprévisible.
 */
export async function importBackup(bundle: BackupBundle): Promise<ImportReport> {
  const chunks = rebuildChunks(bundle.documents);

  await clearAllData();
  await db.transaction('rw', db.tables, async () => {
    if (bundle.profile) await db.profile.put(bundle.profile);
    await Promise.all([
      db.subjects.bulkAdd(bundle.subjects),
      db.chapters.bulkAdd(bundle.chapters),
      db.documents.bulkAdd(bundle.documents),
      db.chunks.bulkAdd(chunks),
      db.flashcards.bulkAdd(bundle.flashcards),
      db.quizQuestions.bulkAdd(bundle.quizQuestions),
      db.reviewLogs.bulkAdd(bundle.reviewLogs),
      db.notes.bulkAdd(bundle.notes),
      db.calendarEvents.bulkAdd(bundle.calendarEvents),
      db.anatomyStructures.bulkAdd(bundle.anatomyStructures),
      db.anatomySheets.bulkAdd(bundle.anatomySheets),
      db.chatMessages.bulkAdd(bundle.chatMessages),
      db.podcastEpisodes.bulkAdd(bundle.podcastEpisodes),
    ]);
  });

  return {
    subjects: bundle.subjects.length,
    chapters: bundle.chapters.length,
    documents: bundle.documents.length,
    flashcards: bundle.flashcards.length,
    quizQuestions: bundle.quizQuestions.length,
    reviewLogs: bundle.reviewLogs.length,
    notes: bundle.notes.length,
    calendarEvents: bundle.calendarEvents.length,
    anatomyStructures: bundle.anatomyStructures.length,
    fromLegacyPrototype: false,
  };
}
