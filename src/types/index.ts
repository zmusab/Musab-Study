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
  /**
   * Objectifs HEBDOMADAIRES affichés et modifiables depuis « Progression ».
   * Champs additifs non indexés : aucune migration Dexie nécessaire (voir
   * `db.ts`), les profils enregistrés avant leur ajout retombent sur
   * `DEFAULT_PROFILE`.
   */
  weeklyStudyMinutesGoal: number;
  weeklyReviewGoal: number;
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
  /**
   * Texte intégral extrait — la COUCHE IA, jamais ce que l'utilisateur lit.
   * Volumineux : jamais chargé pour du simple affichage.
   */
  text: string;
  /**
   * Offset (dans `text`) où commence chaque page, page 1 en premier —
   * `text.slice(pageOffsets[i], pageOffsets[i+1])` est le texte de la page
   * `i+1`. Permet de retrouver le numéro de page d'un passage cité par l'IA,
   * sans dupliquer le texte par page. Vide pour un document collé à la main
   * (`source: 'paste'`), qui n'a pas de pagination.
   */
  pageOffsets: number[];
  source: DocumentSource;
  pageCount: number | null;
  charCount: number;
  /** Petite couverture (première page rendue), affichée dans la liste des cours. Null pour un document collé. */
  thumbnail: Blob | null;
  /** Dernière page consultée dans le lecteur — reprend la lecture là où elle s'est arrêtée. */
  lastReadPage: number;
  /** Dernière ouverture dans le lecteur — alimente « Continuer mes cours » sur l'accueil. Null si jamais ouvert. */
  lastOpenedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

/**
 * Le PDF ORIGINAL, intact — la COUCHE DOCUMENT que l'utilisateur consulte.
 *
 * Séparée de `documents` à dessein : les écrans qui listent des documents
 * (compteurs, bibliothèque) ne doivent jamais charger un fichier de plusieurs
 * mégaoctets pour afficher un nom. C'est aussi ce qui rend une migration vers
 * Supabase directe — cette table devient un objet dans un bucket Storage
 * (`documentId` comme clé), `documents` reste une table Postgres ordinaire.
 */
export interface DocumentFile {
  documentId: ID;
  blob: Blob;
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
  /** Page du PDF où commence/finit ce fragment. Null si le document n'a pas de pagination (`source: 'paste'`). */
  pageStart: number | null;
  pageEnd: number | null;
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
  /** Document et page d'où la note a été prise — null pour une note générale, pas liée à un passage précis. */
  documentId: ID | null;
  page: number | null;
  title: string;
  text: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ───────────────────────────── Calendrier ─────────────────────────────

/**
 * Nature d'un événement. `midterm` (contrôle) et `final` (examen final) sont
 * des ajouts ADDITIFS aux valeurs d'origine : les événements déjà
 * enregistrés restent valides, l'index `[kind+day]` n'en est pas affecté, et
 * la distinction sert réellement — un examen final ne pèse pas comme un
 * contrôle dans le calcul des priorités.
 */
export type CalendarEventKind = 'exam' | 'midterm' | 'final' | 'course' | 'task' | 'review';

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

export type AnatomyCategory = 'squelette' | 'muscles' | 'organes' | 'nerfs' | 'vaisseaux';

/**
 * Une structure anatomique. `model3dRef` est désormais réellement utilisé :
 * c'est le nom du noeud correspondant dans le `.glb` de sa catégorie/région
 * (voir `data/anatomy/headNeckCatalog.json`), null si aucun maillage 3D sous
 * licence ouverte n'est disponible pour cette structure — la structure reste
 * alors réelle et exploitable (recherche, IA, flashcards), simplement non
 * représentée visuellement dans la scène 3D. `region` distingue la région du
 * corps (ex. `'tete-et-cou'`) pour permettre plus tard d'autres régions sans
 * dupliquer le schéma ; `subregion` affine la navigation hiérarchique à
 * l'intérieur d'une région (ex. `'crane' | 'machoire' | 'face' | 'cou' | 'dents'`
 * pour tête-et-cou) — un regroupement de structures déjà réelles, pas une
 * nouvelle géométrie.
 */
export interface AnatomyStructure {
  id: ID;
  name: string;
  latinName: string;
  category: AnatomyCategory;
  subjectId: ID | null;
  model3dRef: string | null;
  region: string | null;
  subregion: string | null;
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
  /** Page du PDF d'où vient l'extrait — « → page 42 » ramène au bon endroit. Null sans pagination. */
  page: number | null;
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

// ──────────────────────── Podcast d'étude ────────────────────────

export type PodcastLength = 'quick' | 'normal' | 'deep';
export type PodcastSpeakerId = 'A' | 'B';

/** Notion identifiée dans le cours comme méritant d'être retenue. */
export interface PodcastConcept {
  id: string;
  label: string;
  importance: Importance;
  /** Vrai si l'IA l'a signalée comme source de confusion fréquente. */
  isPitfall: boolean;
  citations: Citation[];
}

/**
 * Analyse d'un chapitre — les notions qu'il contient. Réutilise
 * `PodcastConcept` : une notion sourcée et vérifiée est la même chose,
 * qu'elle serve à préparer un podcast ou à peupler l'onglet « Notions »
 * d'une matière.
 */
export interface ChapterAnalysis {
  id: ID;
  subjectId: ID;
  chapterId: ID;
  notions: PodcastConcept[];
  generatedAt: ISODateTime;
}

export type PodcastSegmentType =
  | 'intro'
  | 'concept'
  | 'explanation'
  | 'example'
  | 'pitfall'
  | 'connection'
  | 'recap'
  | 'quiz';

export interface PodcastSegment {
  id: string;
  speaker: PodcastSpeakerId;
  type: PodcastSegmentType;
  text: string;
  /**
   * Provenance établie par vérification des citations, jamais déclarée par le
   * modèle — même principe que pour l'assistant IA. Null pour les répliques
   * qui ne portent pas d'affirmation factuelle (transition, exemple fictif).
   */
  provenance: AnswerProvenance | null;
  citations: Citation[];
  /** Durée estimée en secondes, pour la barre de progression du lecteur. */
  estimatedDurationSec: number;
}

export interface PodcastEpisode {
  id: ID;
  subjectId: ID;
  chapterId: ID | null;
  title: string;
  length: PodcastLength;
  enrichedWithInternet: boolean;
  concepts: PodcastConcept[];
  segments: PodcastSegment[];
  estimatedDurationSec: number;
  /** Réplique où la lecture s'est arrêtée — reprend l'écoute au bon endroit. */
  lastSegmentIndex: number;
  /** Dernière écoute — alimente « Continuer l'écoute » sur l'accueil. Null si jamais lancé. */
  lastPlayedAt: ISODateTime | null;
  createdAt: ISODateTime;
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
  podcastEpisodes: PodcastEpisode[];
}
