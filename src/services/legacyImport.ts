import { nowISO, dayKeyFromISO } from '@/lib/date';
import { uid } from '@/lib/id';
import { initialSchedulingState } from '@/core/srs';
import { DEFAULT_PROFILE } from '@/data/repositories/profile';
import type {
  AnatomyCategory,
  AnatomySheet,
  AnatomyStructure,
  BackupBundle,
  CalendarEvent,
  CalendarEventKind,
  Chapter,
  ChatMessage,
  Confidence,
  Difficulty,
  Flashcard,
  Importance,
  Note,
  QuizQuestion,
  ReviewLog,
  StudyDocument,
  Subject,
} from '@/types';
import { SUBJECT_COLORS } from '@/data/repositories/subjects';

/**
 * Migration depuis la sauvegarde JSON du prototype HTML d'origine.
 *
 * Tes données existantes ne sont pas perdues : exporte depuis le prototype,
 * importe ici, tout est converti — y compris l'HISTORIQUE DE RÉVISION, qui est
 * la donnée la plus précieuse. Des mois de répétition espacée ne se
 * reconstituent pas ; les cours, eux, peuvent être réimportés.
 */

interface LegacyCard {
  id?: string;
  q?: string;
  a?: string;
  chapterId?: string;
  importance?: number;
  difficulty?: number;
  ease?: number;
  interval?: number;
  reps?: number;
  lapses?: number;
  due?: string;
  lastReview?: string | null;
}

interface LegacyQuiz {
  id?: string;
  type?: string;
  q?: string;
  options?: string[];
  correct?: number;
  explanation?: string;
  chapterId?: string;
}

interface LegacyReview {
  date?: string;
  type?: string;
  id?: string;
  correct?: boolean;
  confidence?: string;
}

interface LegacySubject {
  id?: string;
  name?: string;
  color?: string;
  createdAt?: string;
  chapters?: { id?: string; name?: string; documents?: { id?: string; name?: string; text?: string; createdAt?: string }[] }[];
  cards?: LegacyCard[];
  quiz?: LegacyQuiz[];
  reviews?: LegacyReview[];
  chat?: { role?: string; text?: string }[];
  notes?: { id?: string; chapterId?: string; text?: string; createdAt?: string }[];
}

export interface LegacyDump {
  profile?: Record<string, unknown>;
  subjectsIndex?: { id?: string }[];
  subjects?: Record<string, LegacySubject>;
  tasks?: { id?: string; title?: string; date?: string; type?: string; subjectId?: string }[];
  anatomyStructures?: {
    id?: string;
    name?: string;
    category?: string;
    subjectId?: string;
    ficheCourse?: string;
    ficheInternet?: string;
    generatedAt?: string;
  }[];
}

/**
 * Reconnaît une sauvegarde du prototype.
 * Le marqueur est `subjectsIndex`, qui n'existe que dans l'ancien format.
 */
export function isLegacyDump(value: unknown): value is LegacyDump {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if ('v' in candidate) return false;
  return 'subjectsIndex' in candidate || 'anatomyStructures' in candidate;
}

const clampScale = (value: unknown, fallback: 1 | 2 | 3): 1 | 2 | 3 => {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 ? n : fallback;
};

const isConfidence = (value: unknown): value is Confidence =>
  value === 'low' || value === 'medium' || value === 'high';

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** Convertit une sauvegarde du prototype vers le format actuel. */
export function convertLegacyDump(dump: LegacyDump): BackupBundle {
  const subjects: Subject[] = [];
  const chapters: Chapter[] = [];
  const documents: StudyDocument[] = [];
  const flashcards: Flashcard[] = [];
  const quizQuestions: QuizQuestion[] = [];
  const reviewLogs: ReviewLog[] = [];
  const notes: Note[] = [];
  const chatMessages: ChatMessage[] = [];
  const anatomyStructures: AnatomyStructure[] = [];
  const anatomySheets: AnatomySheet[] = [];

  const createdFallback = nowISO();
  const legacySubjects = Object.values(dump.subjects ?? {});

  legacySubjects.forEach((legacy, subjectIndex) => {
    if (!legacy?.id) return;
    const subjectId = legacy.id;

    subjects.push({
      id: subjectId,
      name: asString(legacy.name, 'Matière sans nom'),
      color: asString(legacy.color) || SUBJECT_COLORS[subjectIndex % SUBJECT_COLORS.length]!,
      createdAt: asString(legacy.createdAt, createdFallback),
      position: subjectIndex,
    });

    // Chapitres et documents
    (legacy.chapters ?? []).forEach((chapter, chapterIndex) => {
      if (!chapter?.id) return;
      chapters.push({
        id: chapter.id,
        subjectId,
        name: asString(chapter.name, 'Chapitre sans nom'),
        createdAt: createdFallback,
        position: chapterIndex,
      });

      (chapter.documents ?? []).forEach((doc) => {
        const text = asString(doc?.text).trim();
        if (!doc?.id || text.length === 0) return;
        documents.push({
          id: doc.id,
          subjectId,
          chapterId: chapter.id!,
          name: asString(doc.name, 'Document sans nom'),
          text,
          // L'ancien format ne distinguait pas PDF et collage, et ne
          // conservait de toute façon aucun fichier original.
          source: 'paste',
          pageCount: null,
          pageOffsets: [],
          thumbnail: null,
          lastReadPage: 1,
          lastOpenedAt: null,
          charCount: text.length,
          createdAt: asString(doc.createdAt, createdFallback),
        });
      });
    });

    const knownChapters = new Set(chapters.filter((c) => c.subjectId === subjectId).map((c) => c.id));
    const resolveChapter = (id: unknown): string | null =>
      typeof id === 'string' && knownChapters.has(id) ? id : null;

    // Cartes — l'état de répétition espacée est repris tel quel.
    (legacy.cards ?? []).forEach((card) => {
      if (!card?.id) return;
      const fresh = initialSchedulingState(new Date());
      flashcards.push({
        id: card.id,
        subjectId,
        chapterId: resolveChapter(card.chapterId),
        question: asString(card.q, 'Question'),
        answer: asString(card.a),
        importance: clampScale(card.importance, 2) as Importance,
        difficulty: clampScale(card.difficulty, 2) as Difficulty,
        ease: typeof card.ease === 'number' ? card.ease : fresh.ease,
        interval: typeof card.interval === 'number' ? card.interval : 0,
        reps: typeof card.reps === 'number' ? card.reps : 0,
        lapses: typeof card.lapses === 'number' ? card.lapses : 0,
        due: asString(card.due, fresh.due),
        lastReview: typeof card.lastReview === 'string' ? card.lastReview : null,
        origin: 'manual',
        sourceChunkIds: [],
        createdAt: createdFallback,
      });
    });

    (legacy.quiz ?? []).forEach((question) => {
      if (!question?.id || !Array.isArray(question.options)) return;
      quizQuestions.push({
        id: question.id,
        subjectId,
        chapterId: resolveChapter(question.chapterId),
        kind: question.type === 'vf' ? 'vf' : 'qcm',
        question: asString(question.q, 'Question'),
        options: question.options.map((option) => asString(option)),
        correctIndex: typeof question.correct === 'number' ? question.correct : 0,
        explanation: asString(question.explanation),
        difficulty: 2,
        sourceChunkIds: [],
        createdAt: createdFallback,
      });
    });

    // Historique de révision — la donnée irremplaçable.
    (legacy.reviews ?? []).forEach((review) => {
      const at = asString(review?.date);
      if (!at || !review?.id) return;
      reviewLogs.push({
        id: uid('rev'),
        subjectId,
        chapterId: null,
        itemId: review.id,
        itemKind: review.type === 'quiz' ? 'quiz' : 'card',
        at,
        day: dayKeyFromISO(at),
        correct: review.correct === true,
        rating: null,
        confidence: isConfidence(review.confidence) ? review.confidence : null,
        // L'ancien format ne mesurait pas le temps par réponse.
        elapsedMs: 0,
      });
    });

    (legacy.notes ?? []).forEach((note) => {
      const text = asString(note?.text).trim();
      if (!note?.id || text.length === 0) return;
      const createdAt = asString(note.createdAt, createdFallback);
      notes.push({
        id: note.id,
        subjectId,
        chapterId: resolveChapter(note.chapterId),
        documentId: null,
        page: null,
        title: '',
        text,
        createdAt,
        updatedAt: createdAt,
      });
    });

    (legacy.chat ?? []).forEach((message) => {
      const text = asString(message?.text).trim();
      if (text.length === 0) return;
      chatMessages.push({
        id: uid('msg'),
        subjectId,
        role: message?.role === 'user' ? 'user' : 'assistant',
        text,
        // On ne peut pas reconstruire a posteriori la provenance d'une ancienne
        // réponse : la marquer « cours » serait une affirmation inventée.
        provenance: null,
        citations: [],
        at: createdFallback,
      });
    });
  });

  const calendarEvents: CalendarEvent[] = (dump.tasks ?? []).flatMap((task) => {
    const day = asString(task?.date);
    if (!task?.id || !day) return [];
    const kind: CalendarEventKind =
      task.type === 'exam' || task.type === 'course' || task.type === 'review' ? task.type : 'task';
    return [
      {
        id: task.id,
        title: asString(task.title, 'Sans titre'),
        kind,
        day,
        startTime: null,
        endTime: null,
        subjectId: asString(task.subjectId) || null,
        notes: '',
        done: false,
        createdAt: createdFallback,
      },
    ];
  });

  (dump.anatomyStructures ?? []).forEach((structure) => {
    if (!structure?.id) return;
    const category: AnatomyCategory =
      structure.category === 'squelette' ||
      structure.category === 'muscles' ||
      structure.category === 'organes' ||
      structure.category === 'nerfs' ||
      structure.category === 'vaisseaux'
        ? structure.category
        : 'muscles';

    anatomyStructures.push({
      id: structure.id,
      name: asString(structure.name, 'Structure'),
      latinName: '',
      category,
      subjectId: asString(structure.subjectId) || null,
      model3dRef: null,
      region: null,
      createdAt: createdFallback,
    });

    const generatedAt = asString(structure.generatedAt, createdFallback);
    for (const [origin, content] of [
      ['course', structure.ficheCourse],
      ['internet', structure.ficheInternet],
    ] as const) {
      const body = asString(content).trim();
      if (body.length === 0) continue;
      anatomySheets.push({
        id: uid('sht'),
        structureId: structure.id,
        origin,
        content: body,
        // Les anciennes fiches n'ont pas de citations vérifiables : on ne peut
        // donc pas en fabriquer. Elles restent lisibles, sans source affichée.
        citations: [],
        generatedAt,
      });
    }
  });

  const legacyProfile = dump.profile ?? {};

  return {
    v: 2,
    exportedAt: nowISO(),
    profile: {
      ...DEFAULT_PROFILE,
      name: asString(legacyProfile.name),
      university: asString(legacyProfile.university, DEFAULT_PROFILE.university),
      section: asString(legacyProfile.section, DEFAULT_PROFILE.section),
      program: asString(legacyProfile.program, DEFAULT_PROFILE.program),
      goals: asString(legacyProfile.goals),
      theme: legacyProfile.theme === 'dark' ? 'dark' : 'system',
    },
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
    // Le prototype d'origine n'avait pas de podcasts.
    podcastEpisodes: [],
  };
}
