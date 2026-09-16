import Dexie, { type EntityTable } from 'dexie';
import type {
  AiCacheEntry,
  AiUsageDay,
  AnatomySheet,
  AnatomyStructure,
  CalendarEvent,
  Chapter,
  ChapterAnalysis,
  ChatMessage,
  DocumentChunk,
  DocumentFile,
  Flashcard,
  Note,
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
  chapterAnalyses!: EntityTable<ChapterAnalysis, 'id'>;
  aiCache!: EntityTable<AiCacheEntry, 'key'>;
  aiUsage!: EntityTable<AiUsageDay, 'day'>;
  knowledgeConcepts!: EntityTable<import('@/types').KnowledgeConcept, 'id'>;
  knowledgeFacts!: EntityTable<import('@/types').KnowledgeFact, 'id'>;
  knowledgeEvidence!: EntityTable<import('@/types').KnowledgeEvidence, 'id'>;
  quizRuns!: EntityTable<import('@/types').QuizRun, 'id'>;
  factAttempts!: EntityTable<import('@/types').FactAttempt, 'id'>;
  learnerFactStates!: EntityTable<import('@/types').LearnerFactState, 'factId'>;

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
      // La table `podcastEpisodes` a existé ici, et v5 la supprime : la
      // déclaration d'origine reste, parce qu'une base créée à la v1 doit
      // pouvoir rejouer son historique jusqu'à la suppression.
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

    // v3 : notes liées à une page précise d'un document (nouvel index
    // `documentId`, nécessaire pour lister les notes d'un document sans
    // scanner toute la table) + `chapterAnalyses`, une ligne par chapitre
    // dont les notions ont été détectées et vérifiées (voir
    // services/courses/notions.ts).
    this.version(3).stores({
      notes: 'id, subjectId, chapterId, documentId, updatedAt',
      chapterAnalyses: 'id, subjectId, chapterId',
    });

    // v4 : cache des réponses IA (`services/ai/cache.ts`) et statistiques
    // d'usage quotidiennes (`services/ai/usageStats.ts`) — deux tables
    // entièrement nouvelles, sans effet sur les tables existantes. Ni l'une
    // ni l'autre ne contient de donnée de cours à préserver : volontairement
    // absentes de `BackupBundle`.
    this.version(4).stores({
      // `lastUsedAt` indexé : c'est ce qui permet un nettoyage éventuel des
      // entrées les plus anciennes sans scanner toute la table.
      aiCache: 'key, lastUsedAt',
      aiUsage: 'day',
    });

    /*
      v5 : LA TABLE DU PODCAST EST SUPPRIMÉE.

      La fonctionnalité avait été retirée, mais sa table restait déclarée avec
      ce commentaire : « supprimer un store demanderait une migration
      destructrice ». C'était inexact. Dexie supprime un store en le déclarant
      `null` dans une version suivante — c'est l'idiome documenté, il ne touche
      qu'à ce store et laisse les autres intacts.

      Ce qu'on perd : les épisodes enregistrés par une version antérieure de
      l'application. Plus rien ne les lisait ni ne les écrivait depuis le
      retrait de la fonctionnalité, ils n'apparaissaient dans aucune
      sauvegarde, et l'utilisateur a demandé la suppression complète.
    */
    this.version(5).stores({
      podcastEpisodes: null,
    });

    // v6 : socle additif du moteur de connaissances et mémoire des quiz.
    // Aucune carte, aucun PDF et aucun historique existant n'est réécrit par
    // cette migration : le remplissage est progressif et vérifiable.
    this.version(6).stores({
      knowledgeConcepts: 'id, subjectId, chapterId, normalizedLabel, [subjectId+normalizedLabel]',
      knowledgeFacts: 'id, subjectId, chapterId, conceptId, status, [conceptId+predicate]',
      knowledgeEvidence: 'id, factId, documentId, sourceChunkId, active, [documentId+active]',
      quizRuns: 'id, createdAt, completedAt',
    });

    // v7 : tentatives et maîtrise attachées aux FAITS, jamais aux seules
    // formulations de cartes. C'est strictement additif : les anciennes
    // révisions restent dans `reviewLogs` et peuvent être reliées plus tard
    // lorsqu'une carte possède un `knowledgeFactIds` non ambigu.
    this.version(7).stores({
      factAttempts: 'id, factId, conceptId, subjectId, at, [factId+at], [subjectId+at]',
      learnerFactStates: 'factId, conceptId, subjectId, status, nextReviewAt, [subjectId+status]',
    });

    // v8 : annuler une révision doit aussi annuler la tentative de fait qui
    // en découle. Cet index évite un scan complet au moment de l'annulation.
    this.version(8).stores({
      factAttempts: 'id, factId, conceptId, subjectId, sourceItemId, at, [factId+at], [subjectId+at]',
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
