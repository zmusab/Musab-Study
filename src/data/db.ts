import Dexie, { type EntityTable } from 'dexie';
import type {
  AnatomySheet,
  AnatomyStructure,
  CalendarEvent,
  Chapter,
  ChatMessage,
  DocumentChunk,
  DocumentFile,
  Flashcard,
  Note,
  PodcastEpisode,
  Profile,
  QuizQuestion,
  ReviewLog,
  StudyDocument,
  Subject,
} from '@/types';

/**
 * Base IndexedDB locale — les cours restent sur l'appareil et fonctionnent
 * hors ligne (indispensable en amphi).
 *
 * Le schéma est RELATIONNEL. Le prototype stockait une matière entière dans une
 * seule clé : noter une carte réécrivait alors tout le texte des PDF. Ici, les
 * tables sont séparées et indexées, donc chaque écriture ne touche que sa ligne.
 *
 * Les index déclarés ci-dessous ne sont pas décoratifs : ils permettent au
 * Dashboard de compter les cartes dues sans jamais charger un seul document.
 */
export class MusabStudyDatabase extends Dexie {
  profile!: EntityTable<Profile, 'id'>;
  subjects!: EntityTable<Subject, 'id'>;
  chapters!: EntityTable<Chapter, 'id'>;
  documents!: EntityTable<StudyDocument, 'id'>;
  documentFiles!: EntityTable<DocumentFile, 'documentId'>;
  chunks!: EntityTable<DocumentChunk, 'id'>;
  flashcards!: EntityTable<Flashcard, 'id'>;
  quizQuestions!: EntityTable<QuizQuestion, 'id'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  calendarEvents!: EntityTable<CalendarEvent, 'id'>;
  anatomyStructures!: EntityTable<AnatomyStructure, 'id'>;
  anatomySheets!: EntityTable<AnatomySheet, 'id'>;
  chatMessages!: EntityTable<ChatMessage, 'id'>;
  podcastEpisodes!: EntityTable<PodcastEpisode, 'id'>;

  constructor() {
    super('musab-study');

    this.version(1).stores({
      profile: 'id',
      subjects: 'id, position, name',
      chapters: 'id, subjectId, position, [subjectId+position]',
      documents: 'id, subjectId, chapterId, createdAt',
      chunks: 'id, documentId, chapterId, subjectId, [documentId+index]',
      // `due` est indexé : c'est ce qui rend le comptage des cartes dues
      // instantané, quel que soit le volume de cours importés.
      flashcards: 'id, subjectId, chapterId, due, [subjectId+due], createdAt',
      quizQuestions: 'id, subjectId, chapterId, kind, createdAt',
      reviewLogs: 'id, subjectId, itemId, itemKind, day, at, [subjectId+day]',
      notes: 'id, subjectId, chapterId, updatedAt',
      calendarEvents: 'id, day, kind, subjectId, [kind+day]',
      anatomyStructures: 'id, category, subjectId, name',
      anatomySheets: 'id, structureId, origin, [structureId+origin]',
      chatMessages: 'id, subjectId, at',
      podcastEpisodes: 'id, subjectId, chapterId, createdAt',
    });

    // v2 : le PDF original est désormais conservé (table séparée, voir
    // DocumentFile) au lieu d'être jeté après extraction du texte. Aucune
    // transformation des données existantes n'est nécessaire : `documents`
    // garde le même schéma indexé, ses nouveaux champs (thumbnail,
    // pageOffsets, lastReadPage) sont simplement absents sur les anciennes
    // lignes et le code les traite comme tels.
    this.version(2).stores({
      documentFiles: 'documentId',
    });
  }
}

export const db = new MusabStudyDatabase();

/** Efface toutes les données. Utilisé par l'import de sauvegarde et les tests. */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}
