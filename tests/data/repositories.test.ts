import { describe, it, expect, beforeEach } from 'vitest';
import { db, clearAllData } from '@/data/db';
import {
  createSubject,
  createChapter,
  deleteSubject,
  deleteChapter,
  getSubjectStats,
  listChapters,
  listSubjects,
} from '@/data/repositories/subjects';
import { addDocument, listChapterDocuments, deleteDocument } from '@/data/repositories/documents';
import {
  createFlashcard,
  countDueCards,
  listDueCards,
  reviewCard,
  deleteCard,
} from '@/data/repositories/cards';
import { getProfile, saveProfile } from '@/data/repositories/profile';

const LONG_TEXT = 'Le muscle masséter élève la mandibule et participe à la mastication. '.repeat(30);

beforeEach(async () => {
  await clearAllData();
});

describe('profil', () => {
  it('renvoie les valeurs par défaut UMF Iași avant toute sauvegarde', async () => {
    const profile = await getProfile();
    expect(profile.university).toContain('Iași');
    expect(profile.program).toBe('Dentisterie');
  });

  it('persiste les modifications', async () => {
    await saveProfile({ name: 'Musab' });
    expect((await getProfile()).name).toBe('Musab');
  });
});

describe('matières et chapitres', () => {
  it('assigne des positions croissantes', async () => {
    await createSubject('Anatomie', '#4F5BD5');
    await createSubject('Histologie', '#1F8A5F');
    expect((await listSubjects()).map((s) => s.position)).toEqual([0, 1]);
  });

  it('supprime en cascade tout le contenu d’une matière', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles masticateurs');
    await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Cours.pdf',
      text: LONG_TEXT,
      source: 'pdf',
    });
    await createFlashcard({
      subjectId: subject.id,
      chapterId: chapter.id,
      question: 'Q',
      answer: 'A',
    });

    await deleteSubject(subject.id);

    // Aucun orphelin ne doit subsister : ils fausseraient les statistiques.
    expect(await db.chapters.count()).toBe(0);
    expect(await db.documents.count()).toBe(0);
    expect(await db.chunks.count()).toBe(0);
    expect(await db.flashcards.count()).toBe(0);
  });

  it('conserve les cartes mais détache leur chapitre à la suppression du chapitre', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    const card = await createFlashcard({
      subjectId: subject.id,
      chapterId: chapter.id,
      question: 'Q',
      answer: 'A',
    });

    await deleteChapter(chapter.id);

    const kept = await db.flashcards.get(card.id);
    expect(kept).toBeDefined();
    expect(kept!.chapterId).toBeNull();
    expect(await listChapters(subject.id)).toHaveLength(0);
  });
});

describe('documents et indexation RAG', () => {
  it('indexe le document en fragments dans la même transaction', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    const doc = await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Cours.pdf',
      text: LONG_TEXT,
      source: 'pdf',
    });

    const chunks = await db.chunks.where('documentId').equals(doc.id).toArray();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.subjectId === subject.id)).toBe(true);
  });

  it('liste les documents sans charger leur texte intégral', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Cours.pdf',
      text: LONG_TEXT,
      source: 'pdf',
    });

    const summaries = await listChapterDocuments(chapter.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.charCount).toBe(LONG_TEXT.trim().length);
    // Le champ `text` ne doit pas remonter : c'est tout l'intérêt du résumé.
    expect('text' in summaries[0]!).toBe(false);
  });

  it('supprime les fragments avec le document', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    const doc = await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Cours.pdf',
      text: LONG_TEXT,
      source: 'pdf',
    });
    await deleteDocument(doc.id);
    expect(await db.chunks.count()).toBe(0);
  });
});

describe('cartes dues — index composé [subjectId+due]', () => {
  it('ne compte que les cartes échues de la bonne matière', async () => {
    const a = await createSubject('Anatomie', '#4F5BD5');
    const b = await createSubject('Histologie', '#1F8A5F');

    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    const c1 = await createFlashcard({ subjectId: a.id, chapterId: null, question: '1', answer: 'x' });
    const c2 = await createFlashcard({ subjectId: a.id, chapterId: null, question: '2', answer: 'x' });
    const c3 = await createFlashcard({ subjectId: b.id, chapterId: null, question: '3', answer: 'x' });
    await db.flashcards.update(c1.id, { due: past });
    await db.flashcards.update(c2.id, { due: future });
    await db.flashcards.update(c3.id, { due: past });

    expect(await countDueCards(a.id)).toBe(1);
    expect(await countDueCards(b.id)).toBe(1);
    expect((await listDueCards(a.id)).map((c) => c.id)).toEqual([c1.id]);
  });

  it('rend une carte neuve immédiatement révisable', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    await createFlashcard({ subjectId: subject.id, chapterId: null, question: 'Q', answer: 'A' });
    expect(await countDueCards(subject.id)).toBe(1);
  });
});

describe('reviewCard', () => {
  it('met à jour la planification ET journalise la révision atomiquement', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const card = await createFlashcard({
      subjectId: subject.id,
      chapterId: null,
      question: 'Q',
      answer: 'A',
    });

    const updated = await reviewCard(card.id, 2, 'high', 4200);

    expect(updated.reps).toBe(1);
    expect(updated.interval).toBeGreaterThan(0);

    const logs = await db.reviewLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.correct).toBe(true);
    expect(logs[0]!.elapsedMs).toBe(4200);
    expect(logs[0]!.confidence).toBe('high');
  });

  it('retire la carte des cartes dues après une réussite', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const card = await createFlashcard({
      subjectId: subject.id,
      chapterId: null,
      question: 'Q',
      answer: 'A',
    });
    await reviewCard(card.id, 2, 'medium', 1000);
    expect(await countDueCards(subject.id)).toBe(0);
  });

  it('garde la carte à réviser dans la session après un échec', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const card = await createFlashcard({
      subjectId: subject.id,
      chapterId: null,
      question: 'Q',
      answer: 'A',
    });
    const updated = await reviewCard(card.id, 0, 'medium', 1000);
    expect(updated.lapses).toBe(1);
    // Due dans 10 minutes : hors du décompte immédiat, mais dans la session.
    expect(new Date(updated.due).getTime()).toBeGreaterThan(Date.now());
  });

  it('échoue clairement sur une carte inexistante', async () => {
    await expect(reviewCard('inconnue', 2, 'medium', 0)).rejects.toThrow(/introuvable/);
  });

  it('supprime le journal avec la carte', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const card = await createFlashcard({
      subjectId: subject.id,
      chapterId: null,
      question: 'Q',
      answer: 'A',
    });
    await reviewCard(card.id, 2, 'medium', 1000);
    await deleteCard(card.id);
    expect(await db.reviewLogs.count()).toBe(0);
  });
});

describe('getSubjectStats', () => {
  it('compte par index sans charger les documents', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Cours.pdf',
      text: LONG_TEXT,
      source: 'pdf',
    });
    await createFlashcard({ subjectId: subject.id, chapterId: chapter.id, question: 'Q', answer: 'A' });

    expect(await getSubjectStats(subject.id)).toEqual({
      chapters: 1,
      documents: 1,
      cards: 1,
      dueCards: 1,
      quizQuestions: 0,
    });
  });
});
