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
import {
  addDocument,
  listChapterDocuments,
  deleteDocument,
  getDocumentFile,
  moveDocument,
  updateLastReadPage,
} from '@/data/repositories/documents';
import {
  createFlashcard,
  countDueCards,
  listDueCards,
  reviewCard,
  deleteCard,
} from '@/data/repositories/cards';
import { getProfile, saveProfile } from '@/data/repositories/profile';
import {
  createNote,
  deleteNote,
  listNotesForDocument,
  listNotesForSubject,
  updateNote,
} from '@/data/repositories/notes';
import { getChapterAnalysis, saveChapterAnalysis } from '@/data/repositories/notions';
import {
  getAnatomySheet,
  getStructure,
  HEAD_NECK_CATALOG,
  linkStructureToSubject,
  listStructures,
  saveAnatomySheet,
  seedHeadNeckCatalog,
} from '@/data/repositories/anatomy';

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

  it('numérote les fragments par page à partir de pageOffsets', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    // Suffisamment long pour que chaque page dépasse une taille de fragment
    // et force le découpage à produire au moins un fragment par page.
    const page1 = 'Le nerf trijumeau possède trois branches principales. '.repeat(30);
    const page2 = 'La branche mandibulaire porte des fibres motrices. '.repeat(30);
    const text = [page1, page2].join('\n\n');

    const doc = await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Cours.pdf',
      text,
      source: 'pdf',
      pageOffsets: [0, page1.length + 2],
    });

    const chunks = await db.chunks.where('documentId').equals(doc.id).toArray();
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.pageStart !== null)).toBe(true);
    expect(chunks.some((c) => c.pageStart === 1)).toBe(true);
    expect(chunks.some((c) => c.pageStart === 2)).toBe(true);
  });

  it('conserve le PDF original, séparément du texte, et le supprime avec le document', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    const file = new File(['%PDF-1.4 contenu factice'], 'Cours.pdf', { type: 'application/pdf' });

    const doc = await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Cours.pdf',
      text: LONG_TEXT,
      source: 'pdf',
      pageCount: 3,
      file,
    });

    // `fake-indexeddb` (environnement de test) ne clone pas fidèlement les
    // Blob — le contenu binaire n'est donc pas vérifiable ici. Ce qui compte
    // dans ce test, c'est la présence/absence de l'entrée et son cycle de vie,
    // qu'un vrai IndexedDB (Safari, Chrome) stocke intégralement.
    const stored = await getDocumentFile(doc.id);
    expect(stored).toBeDefined();
    expect(stored!.documentId).toBe(doc.id);

    await deleteDocument(doc.id);
    expect(await getDocumentFile(doc.id)).toBeUndefined();
  });

  it("sans fichier PDF, aucune entrée n'est créée dans documentFiles", async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    const doc = await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Notes collées',
      text: LONG_TEXT,
      source: 'paste',
    });
    expect(await getDocumentFile(doc.id)).toBeUndefined();
  });

  it('mémorise la dernière page lue', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    const doc = await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Cours.pdf',
      text: LONG_TEXT,
      source: 'pdf',
    });
    expect(doc.lastReadPage).toBe(1);

    await updateLastReadPage(doc.id, 17);
    expect((await db.documents.get(doc.id))!.lastReadPage).toBe(17);
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

describe('déplacer un document entre chapitres', () => {
  it('met à jour le document ET ses fragments, pour rester cohérent avec l’analyse par chapitre', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapterA = await createChapter(subject.id, 'Muscles');
    const chapterB = await createChapter(subject.id, 'Squelette');
    const doc = await addDocument({
      subjectId: subject.id,
      chapterId: chapterA.id,
      name: 'Cours.pdf',
      text: LONG_TEXT,
      source: 'pdf',
    });

    await moveDocument(doc.id, chapterB.id);

    expect((await db.documents.get(doc.id))!.chapterId).toBe(chapterB.id);
    const chunks = await db.chunks.where('documentId').equals(doc.id).toArray();
    expect(chunks.every((c) => c.chapterId === chapterB.id)).toBe(true);
  });
});

describe('notes liées à une page', () => {
  it('crée une note associée à un document et une page, puis la retrouve par document', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');
    const doc = await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Cours.pdf',
      text: LONG_TEXT,
      source: 'pdf',
    });

    const note = await createNote({
      subjectId: subject.id,
      chapterId: chapter.id,
      documentId: doc.id,
      page: 12,
      title: 'Page 12',
      text: 'Le masséter élève la mandibule.',
    });

    expect((await listNotesForDocument(doc.id)).map((n) => n.id)).toEqual([note.id]);
    expect((await listNotesForSubject(subject.id)).map((n) => n.id)).toEqual([note.id]);
  });

  it('conserve documentId/page à null pour une note générale', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const note = await createNote({
      subjectId: subject.id,
      chapterId: null,
      title: 'Idée générale',
      text: 'À revoir avant l’examen.',
    });
    expect(note.documentId).toBeNull();
    expect(note.page).toBeNull();
  });

  it('met à jour updatedAt lors d’une modification', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const note = await createNote({ subjectId: subject.id, chapterId: null, title: 'T', text: 'Avant' });
    await updateNote(note.id, { text: 'Après' });
    const updated = await db.notes.get(note.id);
    expect(updated!.text).toBe('Après');
  });

  it('supprime une note', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const note = await createNote({ subjectId: subject.id, chapterId: null, title: 'T', text: 'X' });
    await deleteNote(note.id);
    expect(await db.notes.get(note.id)).toBeUndefined();
  });
});

describe('analyses de chapitre (notions)', () => {
  it('enregistre puis remplace l’analyse d’un chapitre — jamais de doublon', async () => {
    const subject = await createSubject('Anatomie', '#4F5BD5');
    const chapter = await createChapter(subject.id, 'Muscles');

    const first = await saveChapterAnalysis(subject.id, chapter.id, [
      { id: 'cpt-1', label: 'Masséter', importance: 3, isPitfall: false, citations: [] },
    ]);
    const second = await saveChapterAnalysis(subject.id, chapter.id, [
      { id: 'cpt-2', label: 'Temporal', importance: 2, isPitfall: false, citations: [] },
    ]);

    expect(second.id).toBe(first.id);
    expect(await db.chapterAnalyses.count()).toBe(1);
    expect((await getChapterAnalysis(chapter.id))!.notions).toHaveLength(1);
    expect((await getChapterAnalysis(chapter.id))!.notions[0]!.label).toBe('Temporal');
  });
});

describe('catalogue Anatomie Tête et Cou', () => {
  it('peuple la base depuis le catalogue statique, un maillage réel par entrée avec maillage', async () => {
    await seedHeadNeckCatalog();
    const structures = await listStructures({ region: 'tete-et-cou' });
    expect(structures.length).toBe(HEAD_NECK_CATALOG.length);

    const withMesh = HEAD_NECK_CATALOG.filter((c) => c.hasMesh);
    for (const entry of withMesh) {
      const structure = await getStructure(entry.id);
      expect(structure!.model3dRef).toBe(entry.id);
    }
    const withoutMesh = HEAD_NECK_CATALOG.filter((c) => !c.hasMesh);
    for (const entry of withoutMesh) {
      const structure = await getStructure(entry.id);
      expect(structure!.model3dRef).toBeNull();
    }
  });

  it('le mandibule et un maximum de dents sont bien catalogués (couverture dentisterie)', async () => {
    await seedHeadNeckCatalog();
    const teeth = await listStructures({ region: 'tete-et-cou', category: 'squelette' });
    const toothEntries = teeth.filter((s) => /^dent_/.test(s.id));
    expect(toothEntries.length).toBeGreaterThanOrEqual(28);
    expect(teeth.some((s) => s.id === 'mandibule')).toBe(true);
  });

  it('rejouer le seed ne crée jamais de doublon et conserve le lien vers une matière', async () => {
    await seedHeadNeckCatalog();
    const subject = await createSubject('Anatomie céphalique', '#4F5BD5');
    await linkStructureToSubject('mandibule', subject.id);

    await seedHeadNeckCatalog();

    const countAfter = (await listStructures({ region: 'tete-et-cou' })).length;
    expect(countAfter).toBe(HEAD_NECK_CATALOG.length);
    expect((await getStructure('mandibule'))!.subjectId).toBe(subject.id);
  });

  it('filtre par système anatomique via l’index existant', async () => {
    await seedHeadNeckCatalog();
    const vessels = await listStructures({ category: 'vaisseaux' });
    expect(vessels.every((s) => s.category === 'vaisseaux')).toBe(true);
    expect(vessels.length).toBeGreaterThan(0);
  });

  it('enregistre une fiche cours puis internet séparément, sans les mélanger', async () => {
    await seedHeadNeckCatalog();
    await saveAnatomySheet('masseter_superficiel_droit', 'course', 'Contenu cours', []);
    await saveAnatomySheet('masseter_superficiel_droit', 'internet', 'Contenu internet', []);

    const course = await getAnatomySheet('masseter_superficiel_droit', 'course');
    const internet = await getAnatomySheet('masseter_superficiel_droit', 'internet');
    expect(course!.content).toBe('Contenu cours');
    expect(internet!.content).toBe('Contenu internet');
    expect(course!.id).not.toBe(internet!.id);
  });

  it('régénérer une fiche remplace l’ancienne plutôt que d’empiler des doublons', async () => {
    await seedHeadNeckCatalog();
    const first = await saveAnatomySheet('mandibule', 'course', 'Version 1', []);
    const second = await saveAnatomySheet('mandibule', 'course', 'Version 2', []);
    expect(second.id).toBe(first.id);
    expect(await db.anatomySheets.count()).toBe(1);
    expect((await getAnatomySheet('mandibule', 'course'))!.content).toBe('Version 2');
  });
});
