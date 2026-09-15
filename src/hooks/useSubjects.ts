import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { countDueCards } from '@/data/repositories/cards';
import type { Chapter, ID, Subject } from '@/types';
import type { DocumentSummary } from '@/data/repositories/documents';

/**
 * Accès réactifs aux cours.
 *
 * `useLiveQuery` réexécute la requête dès que les tables concernées changent :
 * importer un document met à jour les compteurs partout, sans rechargement et
 * sans gestion d'état manuelle.
 *
 * Aucun de ces hooks ne charge le TEXTE des documents. Le prototype chargeait
 * toutes les matières entières à chaque affichage d'écran ; ici, les compteurs
 * viennent des index.
 */

export function useSubjects(): Subject[] | undefined {
  return useLiveQuery(() => db.subjects.orderBy('position').toArray(), []);
}

export function useSubject(subjectId: ID | undefined): Subject | undefined | null {
  return useLiveQuery(
    async () => (subjectId ? ((await db.subjects.get(subjectId)) ?? null) : null),
    [subjectId],
  );
}

export function useChapters(subjectId: ID | undefined): Chapter[] | undefined {
  return useLiveQuery(async () => {
    if (!subjectId) return [];
    const chapters = await db.chapters.where('subjectId').equals(subjectId).toArray();
    return chapters.sort((a, b) => a.position - b.position);
  }, [subjectId]);
}

export interface SubjectOverview {
  chapters: number;
  documents: number;
  cards: number;
  dueCards: number;
  notes: number;
}

/*
 * `quizQuestions` a été RETIRÉ de ces compteurs. La table du même nom n'est
 * jamais écrite : le quiz est construit à la volée à partir des flashcards
 * réelles (voir `core/quiz`). Le compteur affichait donc « 0 question(s) » en
 * permanence, sur une matière dont le quiz fonctionnait parfaitement — une
 * statistique décorative et fausse. La table reste en base (elle figure dans
 * les sauvegardes) mais plus rien ne prétend qu'elle contient quelque chose.
 */

/** Compteurs de toutes les matières, calculés uniquement par index. */
export function useSubjectOverviews(): Record<ID, SubjectOverview> | undefined {
  return useLiveQuery(async () => {
    const now = new Date().toISOString();
    const subjects = await db.subjects.toArray();
    const entries = await Promise.all(
      subjects.map(async (subject): Promise<[ID, SubjectOverview]> => {
        const [chapters, documents, cards, dueCards, notes] = await Promise.all([
          db.chapters.where('subjectId').equals(subject.id).count(),
          db.documents.where('subjectId').equals(subject.id).count(),
          db.flashcards.where('subjectId').equals(subject.id).count(),
          // Passe par le dépôt, JAMAIS par l'index directement : c'est lui qui
          // sait qu'une carte suspendue ou enterrée n'est pas une carte à
          // réviser. Recompter ici « à la main » faisait annoncer des cartes
          // dues que la session de révision n'ouvrait pas.
          countDueCards(subject.id, new Date(now)),
          db.notes.where('subjectId').equals(subject.id).count(),
        ]);
        return [subject.id, { chapters, documents, cards, dueCards, notes }];
      }),
    );
    return Object.fromEntries(entries);
  }, []);
}

/** Documents d'un chapitre, sans leur texte intégral. */
export function useChapterDocuments(chapterId: ID | undefined): DocumentSummary[] | undefined {
  return useLiveQuery(async () => {
    if (!chapterId) return [];
    const docs = await db.documents.where('chapterId').equals(chapterId).toArray();
    return docs
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ text: _text, ...summary }) => summary);
  }, [chapterId]);
}

/** Documents de toute une matière, groupés par chapitre. */
export function useSubjectDocumentsByChapter(
  subjectId: ID | undefined,
): Record<ID, DocumentSummary[]> | undefined {
  return useLiveQuery(async () => {
    if (!subjectId) return {};
    const docs = await db.documents.where('subjectId').equals(subjectId).toArray();
    const grouped: Record<ID, DocumentSummary[]> = {};
    for (const { text: _text, ...summary } of docs) {
      (grouped[summary.chapterId] ??= []).push(summary);
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    return grouped;
  }, [subjectId]);
}
