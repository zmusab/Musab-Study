import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import type { SearchableItem } from '@/services/search';

/**
 * Construit l'index de recherche à partir des données réelles de
 * l'utilisateur — jamais de contenu simulé. Une matière ou une carte encore
 * vide ne produit simplement aucune entrée : c'est le reflet honnête de
 * l'état de l'app, pas un manque à combler artificiellement.
 */
export function useSearchIndex(): SearchableItem[] | undefined {
  return useLiveQuery(async () => {
    const [
      subjects,
      chapters,
      documents,
      notes,
      flashcards,
      quizQuestions,
      podcastEpisodes,
      anatomyStructures,
      calendarEvents,
    ] = await Promise.all([
      db.subjects.toArray(),
      db.chapters.toArray(),
      db.documents.toArray(),
      db.notes.toArray(),
      db.flashcards.toArray(),
      db.quizQuestions.toArray(),
      db.podcastEpisodes.toArray(),
      db.anatomyStructures.toArray(),
      db.calendarEvents.toArray(),
    ]);

    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    const chapterName = new Map(chapters.map((c) => [c.id, c.name]));
    const breadcrumb = (subjectId: string | null, chapterId?: string | null): string => {
      const parts = [subjectId ? subjectName.get(subjectId) : undefined, chapterId ? chapterName.get(chapterId) : undefined];
      return parts.filter(Boolean).join(' › ');
    };

    const items: SearchableItem[] = [];

    for (const subject of subjects) {
      items.push({ id: subject.id, kind: 'subject', title: subject.name, subtitle: 'Matière', to: `/cours/${subject.id}` });
    }

    for (const chapter of chapters) {
      items.push({
        id: chapter.id,
        kind: 'chapter',
        title: chapter.name,
        subtitle: breadcrumb(chapter.subjectId) || 'Chapitre',
        to: `/cours/${chapter.subjectId}`,
      });
    }

    for (const doc of documents) {
      items.push({
        id: doc.id,
        kind: 'document',
        title: doc.name,
        subtitle: breadcrumb(doc.subjectId, doc.chapterId) || 'Document',
        body: doc.text,
        to: `/cours/${doc.subjectId}`,
      });
    }

    for (const note of notes) {
      items.push({
        id: note.id,
        kind: 'note',
        title: note.title,
        subtitle: breadcrumb(note.subjectId, note.chapterId) || 'Note',
        body: note.text,
        to: '/notes',
      });
    }

    for (const card of flashcards) {
      items.push({
        id: card.id,
        kind: 'flashcard',
        title: card.question,
        subtitle: breadcrumb(card.subjectId, card.chapterId) || 'Flashcard',
        body: card.answer,
        to: '/flashcards',
      });
    }

    for (const question of quizQuestions) {
      items.push({
        id: question.id,
        kind: 'quiz',
        title: question.question,
        subtitle: breadcrumb(question.subjectId, question.chapterId) || 'Quiz',
        body: [...question.options, question.explanation].join(' '),
        to: '/quiz',
      });
    }

    for (const episode of podcastEpisodes) {
      items.push({
        id: episode.id,
        kind: 'podcast',
        title: episode.title,
        subtitle: breadcrumb(episode.subjectId, episode.chapterId) || 'Podcast',
        body: episode.segments.map((segment) => segment.text).join(' '),
        to: `/podcast/${episode.id}`,
      });
    }

    for (const structure of anatomyStructures) {
      items.push({
        id: structure.id,
        kind: 'anatomy',
        title: structure.name,
        subtitle: structure.latinName || 'Anatomie',
        to: '/anatomie',
      });
    }

    for (const event of calendarEvents) {
      items.push({
        id: event.id,
        kind: 'calendar',
        title: event.title,
        subtitle: breadcrumb(event.subjectId) || 'Calendrier',
        body: event.notes,
        to: '/calendrier',
      });
    }

    return items;
  }, []);
}
