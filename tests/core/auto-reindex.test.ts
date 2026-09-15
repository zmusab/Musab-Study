import { describe, it, expect, beforeEach } from 'vitest';
import { db, clearAllData } from '@/data/db';
import { createSubject, createChapter } from '@/data/repositories/subjects';
import { addDocument } from '@/data/repositories/documents';
import { getProfile } from '@/data/repositories/profile';
import { COURSE_LAYOUT_VERSION, runPendingReindex } from '@/services/local/autoReindex';

/**
 * REMISE À NIVEAU AUTOMATIQUE.
 *
 * Le correctif d'extraction ne valait que pour les documents importés APRÈS
 * lui : un cours déjà en base gardait son texte aplati, et l'assistant
 * répondait « absent de tes cours » sur un sujet pourtant traité. Un bouton
 * dans les Paramètres corrigeait cela — encore fallait-il le trouver.
 *
 * Ce qui est vérifié ici : la remise à niveau se fait seule, une seule fois,
 * et elle ne peut pas casser le démarrage.
 */

/** Page aplatie telle que pdf.js la rend : aucune fin de ligne, puces « § ». */
const FLAT_PAGE =
  'Le nerf ophtalmique de Willis Il donne trois branches terminales : ' +
  '§ Nerf naso-ciliaire § Nerf frontal § Nerf lacrymal';

async function seedFlatDocument() {
  const subject = await createSubject('Anatomie', '#c9a227');
  const chapter = await createChapter(subject.id, 'Trijumeau');
  return addDocument({
    subjectId: subject.id,
    chapterId: chapter.id,
    name: 'Cours aplati.pdf',
    text: FLAT_PAGE,
    pageOffsets: [0],
    source: 'pdf',
    pageCount: 1,
  });
}

describe('runPendingReindex', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('remet à niveau une bibliothèque importée avant le correctif', async () => {
    const doc = await seedFlatDocument();
    // On force l'état « jamais retraité », celui d'un profil d'avant.
    await db.profile.put({ ...(await getProfile()), courseLayoutVersion: undefined });

    const outcome = await runPendingReindex();
    expect(outcome.ran).toBe(true);
    expect(outcome.total).toBe(1);

    const after = await db.documents.get(doc.id);
    // La structure est rendue : les puces redeviennent des fins de ligne.
    expect(after!.text.split('\n').length).toBeGreaterThan(1);
    expect(after!.text).toContain('Nerf frontal');
  });

  it('marque la version appliquée et ne refait jamais le travail', async () => {
    await seedFlatDocument();
    await db.profile.put({ ...(await getProfile()), courseLayoutVersion: undefined });

    const first = await runPendingReindex();
    expect(first.ran).toBe(true);
    expect((await getProfile()).courseLayoutVersion).toBe(COURSE_LAYOUT_VERSION);

    const second = await runPendingReindex();
    expect(second.ran).toBe(false);
    expect(second.total).toBe(0);
  });

  it('ne fait rien quand la bibliothèque est déjà à la bonne version', async () => {
    await seedFlatDocument();
    await db.profile.put({ ...(await getProfile()), courseLayoutVersion: COURSE_LAYOUT_VERSION });

    const outcome = await runPendingReindex();
    expect(outcome.ran).toBe(false);
  });

  it('repasse quand la version du traitement AVANCE', async () => {
    await seedFlatDocument();
    // Bibliothèque traitée par une version antérieure : elle doit être reprise.
    await db.profile.put({ ...(await getProfile()), courseLayoutVersion: COURSE_LAYOUT_VERSION - 1 });

    const outcome = await runPendingReindex();
    expect(outcome.ran).toBe(true);
  });

  it('ne casse rien sur une bibliothèque vide', async () => {
    const outcome = await runPendingReindex();
    expect(outcome.ran).toBe(true);
    expect(outcome.total).toBe(0);
    expect((await getProfile()).courseLayoutVersion).toBe(COURSE_LAYOUT_VERSION);
  });

  it('ne retraite pas deux fois quand il est appelé deux fois de suite', async () => {
    await seedFlatDocument();
    await db.profile.put({ ...(await getProfile()), courseLayoutVersion: undefined });

    // `useEffect` est invoqué deux fois en mode strict : les deux appels
    // partent avant que le premier n'ait écrit la version.
    const [a, b] = await Promise.all([runPendingReindex(), runPendingReindex()]);
    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(2);
    // Mais c'est le MÊME passage : un seul document traité, pas deux fois un.
    expect(a).toEqual(b);
    expect(a.total).toBe(1);
  });
});
