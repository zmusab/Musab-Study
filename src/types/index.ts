/**
 * Modèle de domaine de Musab Study.
 *
 * Chaque interface correspond à une table IndexedDB (voir src/data/db.ts) et,
 * à terme, à une table PostgreSQL/Supabase. Les entités sont volontairement
 * PLATES et reliées par des identifiants : contrairement au prototype, une
 * matière ne contient pas ses chapitres, ses documents et ses cartes dans un
 * seul objet. Noter une carte n'écrit donc que cette carte, pas les mégaoctets
 * de texte des PDF de la matière.
 */

export type ID = string;
/** Date ISO 8601 complète, ex. "2026-08-31T09:12:00.000Z". */
export type ISODateTime = string;
/** Jour civil local, ex. "2026-08-31". */
export type DayKey = string;

// ─────────────────────────────── Profil ───────────────────────────────

export type ThemePreference = 'light' | 'dark' | 'system';

export interface Profile {
  id: 'me';
  name: string;
  university: string;
  section: string;
  program: string;
  goals: string;
  theme: ThemePreference;
  /** Objectif quotidien de cartes révisées, utilisé par le Dashboard. */
  dailyCardGoal: number;
}

// ────────────────────────── Cours & documents ──────────────────────────

export interface Subject {
  id: ID;
  name: string;
  color: string;
  createdAt: ISODateTime;
  /** Ordre d'affichage manuel. */
  position: number;
}

export interface Chapter {
  id: ID;
  subjectId: ID;
  name: string;
  createdAt: ISODateTime;
  position: number;
}

export type DocumentSource = 'pdf' | 'paste';

export interface StudyDocument {
  id: ID;
  subjectId: ID;
  chapterId: ID;
  name: string;
  /** Texte intégral extrait. Volumineux : jamais chargé pour du simple affichage. */
  text: string;
  source: DocumentSource;
  pageCount: number | null;
  charCount: number;
  createdAt: ISODateTime;
}

/**
 * Fragment indexable d'un document — l'unité de récupération du RAG.
 * Une réponse de l'IA ne peut citer que des chunks réellement transmis :
 * c'est ce qui rend la garantie anti-hallucination structurelle.
 */
export interface DocumentChunk {
  id: ID;
  documentId: ID;
  chapterId: ID;
  subjectId: ID;
  /** Index du chunk dans le document, à partir de 0. */
  index: number;
  text: string;
  /** Position de départ dans le texte du document (pour retrouver la source). */
  charStart: number;
  charEnd: number;
  /** Fréquences des termes normalisés, pré-calculées pour la recherche BM25. */
  termFreq: Record<string, number>;
  tokenCount: number;
  /**
   * Emplacement réservé pour un vecteur d'embedding.
   * Null tant qu'aucun fournisseur d'embeddings n'est branché — la recherche
   * lexicale BM25 fonctionne sans.
   */
  embedding: number[] | null;
}

// ──────────────────────────── Flashcards ────────────────────────────

/** 1 = normale, 2 = importante, 3 = tombe à l'examen. */
export type Importance = 1 | 2 | 3;
/** 1 = facile, 2 = moyenne, 3 = difficile. */
export type Difficulty = 1 | 2 | 3;

export interface Flashcard {
  id: ID;
  subjectId: ID;
  chapterId: ID | null;
  question: string;
  answer: string;
  importance: Importance;
  difficulty: Difficulty;

  // État de répétition espacée
  ease: number;
  /** Intervalle courant en jours. 0 = jamais planifiée / à réapprendre. */
  interval: number;
  reps: number;
  lapses: number;
  due: ISODateTime;
  lastReview: ISODateTime | null;

  /** Origine de la carte, utile pour l'audit et l'affichage. */
  origin: 'manual' | 'ai' | 'quiz-error';
  /** Chunks ayant servi à la générer, quand elle vient de l'IA. */
  sourceChunkIds: ID[];
  createdAt: ISODateTime;
}

// ─────────────────────────────── Quiz ───────────────────────────────

export type QuizKind = 'qcm' | 'vf';

export interface QuizQuestion {
  id: ID;
  subjectId: ID;
  chapterId: ID | null;
  kind: QuizKind;
  question: string;
  options: string[];
  /** Index de la bonne option dans `options`. */
  correctIndex: number;
  explanation: string;
  difficulty: Difficulty;
  sourceChunkIds: ID[];
  createdAt: ISODateTime;
}

// ─────────────────────── Historique de révision ───────────────────────

export type ReviewItemKind = 'card' | 'quiz';
export type Confidence = 'low' | 'medium' | 'high';
/** 0 = Encore, 1 = Difficile, 2 = Bien, 3 = Facile. */
export type Rating = 0 | 1 | 2 | 3;

/**
 * Une ligne par réponse donnée. Table append-only : c'est la source de vérité
 * de toutes les statistiques de progression.
 */
export interface ReviewLog {
  id: ID;
  subjectId: ID;
  chapterId: ID | null;
  itemId: ID;
  itemKind: ReviewItemKind;
  at: ISODateTime;
  day: DayKey;
  correct: boolean;
  rating: Rating | null;
  confidence: Confidence | null;
  /** Temps de réflexion en millisecondes — alimente le « temps étudié ». */
  elapsedMs: number;
}

// ─────────────────────────────── Notes ───────────────────────────────

export interface Note {
  id: ID;
  subjectId: ID;
  chapterId: ID | null;
  title: string;
  text: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ───────────────────────────── Calendrier ─────────────────────────────

export type CalendarEventKind = 'exam' | 'course' | 'task' | 'review';

export interface CalendarEvent {
  id: ID;
  title: string;
  kind: CalendarEventKind;
  /** Jour civil de l'événement. */
  day: DayKey;
  /** "HH:MM" en heure locale, ou null pour un événement sur la journée. */
  startTime: string | null;
  endTime: string | null;
  subjectId: ID | null;
  notes: string;
  done: boolean;
  createdAt: ISODateTime;
}

// ───────────────────────────── Anatomie ─────────────────────────────

export type AnatomyCategory = 'squelette' | 'muscles' | 'organes' | 'nerfs';

/**
 * Une structure anatomique. `model3dRef` est le point d'accroche prévu pour un
 * futur atlas 3D sous licence : il contiendra l'identifiant de maillage du
 * fournisseur, sans qu'aucune autre partie du modèle ne change.
 */
export interface AnatomyStructure {
  id: ID;
  name: string;
  latinName: string;
  category: AnatomyCategory;
  subjectId: ID | null;
  model3dRef: string | null;
  createdAt: ISODateTime;
}

/** Fiche générée pour une structure, séparée par provenance. */
export interface AnatomySheet {
  id: ID;
  structureId: ID;
  origin: 'course' | 'internet';
  content: string;
  citations: Citation[];
  generatedAt: ISODateTime;
}

// ──────────────────────────── IA & RAG ────────────────────────────

/** Référence vérifiable vers un passage réellement transmis au modèle. */
export interface Citation {
  chunkId: ID;
  documentId: ID;
  documentName: string;
  chapterId: ID;
  chapterName: string;
  subjectName: string;
  /** Extrait exact cité, pour que l'affirmation soit contrôlable. */
  excerpt: string;
}

/** Provenance d'une réponse de l'assistant — jamais devinée, toujours calculée. */
export type AnswerProvenance = 'course' | 'internet' | 'insufficient' | 'error';

export interface ChatMessage {
  id: ID;
  subjectId: ID;
  role: 'user' | 'assistant';
  text: string;
  provenance: AnswerProvenance | null;
  citations: Citation[];
  at: ISODateTime;
}

// ─────────────────────────── Sauvegarde ───────────────────────────

/** Format d'export/import complet. `v` permet les migrations futures. */
export interface BackupBundle {
  v: 2;
  exportedAt: ISODateTime;
  profile: Profile | null;
  subjects: Subject[];
  chapters: Chapter[];
  documents: StudyDocument[];
  flashcards: Flashcard[];
  quizQuestions: QuizQuestion[];
  reviewLogs: ReviewLog[];
  notes: Note[];
  calendarEvents: CalendarEvent[];
  anatomyStructures: AnatomyStructure[];
  anatomySheets: AnatomySheet[];
  chatMessages: ChatMessage[];
}
