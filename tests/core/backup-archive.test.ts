import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync } from 'fflate';
import { db, clearAllData } from '@/data/db';
import { createSubject, createChapter } from '@/data/repositories/subjects';
import { addDocument } from '@/data/repositories/documents';
import { createFlashcard } from '@/data/repositories/cards';
import { exportBackup } from '@/services/backup';
import {
  exportBackupArchive,
  importBackupArchive,
  looksLikeArchive,
  packArchive,
  unpackArchive,
} from '@/services/backupArchive';

/**
 * SAUVEGARDE COMPLÈTE — ce qui doit survivre à un changement d'appareil.
 *
 * La sauvegarde JSON n'emportait que du texte : on récupérait ses cours et son
 * historique, mais il fallait ré-importer chaque PDF à la main.
 *
 * CE QUE CE FICHIER PEUT ET NE PEUT PAS PROUVER. `fake-indexeddb` ne restitue
 * pas les Blob qu'on lui confie — ils reviennent en objets vides, leur contenu
 * binaire est perdu par l'environnement de test lui-même. Un aller-retour
 * passant par Dexie ne prouverait donc RIEN sur les octets.
 *
 * D'où la séparation vérifiée ici :
 *  - la garantie des octets se teste sur la couche PURE (`packArchive` /
 *    `unpackArchive`), avec de vrais binaires ;
 *  - le câblage à la base se teste sur les décomptes et les refus ;
 *  - l'aller-retour complet, PDF réel compris, est vérifié dans un vrai
 *    navigateur (`tests/e2e/sauvegarde.mjs`).
 */

/** Un « PDF » minimal mais réaliste : en-tête %PDF, puis du binaire non-texte. */
function fakePdfBytes(seed: number): Uint8Array {
  const header = new TextEncoder().encode('%PDF-1.7\n');
  const body = new Uint8Array(512);
  for (let i = 0; i < body.length; i += 1) body[i] = (i * 31 + seed) % 256;
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

async function seedLibrary() {
  const subject = await createSubject('Anatomie', '#c9a227');
  const chapter = await createChapter(subject.id, 'Trijumeau');
  const doc = await addDocument({
    subjectId: subject.id,
    chapterId: chapter.id,
    name: 'Branches du trijumeau.pdf',
    text: 'Le nerf trijumeau possède trois branches terminales.',
    pageOffsets: [0],
    source: 'pdf',
    pageCount: 1,
    file: new File([fakePdfBytes(7).slice().buffer as ArrayBuffer], 'trijumeau.pdf', {
      type: 'application/pdf',
    }),
  });
  await createFlashcard({
    subjectId: subject.id,
    chapterId: chapter.id,
    question: 'Combien de branches ?',
    answer: 'Trois.',
    origin: 'manual',
  });
  return { subject, chapter, doc };
}

describe('archive — la couche qui porte les octets', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('rend chaque PDF octet pour octet', async () => {
    const bundle = await exportBackup();
    const files = [
      { documentId: 'doc-a', bytes: fakePdfBytes(3) },
      { documentId: 'doc-b', bytes: fakePdfBytes(200) },
    ];

    const { files: back } = unpackArchive(packArchive(bundle, files));

    expect(back).toHaveLength(2);
    for (const original of files) {
      const restored = back.find((f) => f.documentId === original.documentId);
      expect(restored).toBeDefined();
      expect([...restored!.bytes]).toEqual([...original.bytes]);
    }
  });

  it('transporte la sauvegarde elle-même sans l’altérer', async () => {
    await seedLibrary();
    const bundle = await exportBackup();

    const { bundle: back } = unpackArchive(packArchive(bundle, []));

    expect(back).toEqual(bundle);
  });

  it('refuse une archive sans data.json', () => {
    const bogus = zipSync({ 'lisezmoi.txt': new TextEncoder().encode('rien') });
    expect(() => unpackArchive(bogus)).toThrow(/data\.json/);
  });

  it('refuse un data.json qui n’est pas une sauvegarde', () => {
    const bogus = zipSync({ 'data.json': new TextEncoder().encode('{"autre":true}') });
    expect(() => unpackArchive(bogus)).toThrow(/Format non reconnu/);
  });

  it('ignore les entrées qui ne sont pas des PDF joints', async () => {
    const bundle = await exportBackup();
    // Une archive ouverte puis refermée sur un ordinateur gagne volontiers des
    // fichiers parasites : ils ne doivent pas devenir des documents.
    const withNoise = zipSync({
      'data.json': new TextEncoder().encode(JSON.stringify(bundle)),
      'fichiers/doc-a.pdf': fakePdfBytes(1),
      'fichiers/notes.txt': new TextEncoder().encode('parasite'),
      '.DS_Store': new Uint8Array([0, 1, 2]),
    });

    const { files } = unpackArchive(withNoise);
    expect(files.map((f) => f.documentId)).toEqual(['doc-a']);
  });
});

describe('archive — le câblage à la base', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('restaure le travail et reconstruit l’index', async () => {
    await seedLibrary();
    const archive = await exportBackupArchive();

    await clearAllData();
    const report = await importBackupArchive(archive.blob);

    expect(report.subjects).toBe(1);
    expect(report.documents).toBe(1);
    expect(report.flashcards).toBe(1);
    // Les fragments d'index sont reconstruits, jamais transportés.
    expect(await db.chunks.count()).toBeGreaterThan(0);
  });

  it('ne joint aucun fichier quand le document a été collé au clavier', async () => {
    const subject = await createSubject('Physiologie', '#8a6a12');
    const chapter = await createChapter(subject.id, 'Cœur');
    await addDocument({
      subjectId: subject.id,
      chapterId: chapter.id,
      name: 'Notes',
      text: 'Le cœur bat environ soixante fois par minute au repos.',
      source: 'paste',
    });

    const archive = await exportBackupArchive();
    expect(archive.files).toBe(0);
    expect(archive.skipped).toBe(0);

    await clearAllData();
    const report = await importBackupArchive(archive.blob);
    expect(report.documents).toBe(1);
    expect(report.files).toBe(0);
  });

  it('compte les fichiers illisibles au lieu de faire échouer tout l’export', async () => {
    await seedLibrary();
    // Une ligne dont le contenu binaire est inexploitable — exactement ce que
    // rend `fake-indexeddb`, et ce qu'un stockage abîmé rendrait en vrai.
    await db.documentFiles.put({ documentId: 'doc-abime', blob: {} as unknown as Blob });

    const archive = await exportBackupArchive();
    // L'export ABOUTIT : perdre la possibilité de sauvegarder à cause d'un
    // seul fichier abîmé serait la pire réponse possible.
    expect(archive.bytes).toBeGreaterThan(0);
    expect(archive.skipped).toBeGreaterThan(0);
  });

  it('n’écrit pas un fichier dont le document est absent de la sauvegarde', async () => {
    const { doc } = await seedLibrary();
    const bundle = await exportBackup();
    const zipped = packArchive(bundle, [
      { documentId: doc.id, bytes: fakePdfBytes(7) },
      { documentId: 'doc-fantome', bytes: fakePdfBytes(99) },
    ]);

    await clearAllData();
    const report = await importBackupArchive(new Blob([zipped.slice()]));

    expect(report.files).toBe(1);
    expect(await db.documentFiles.get(doc.id)).toBeDefined();
    expect(await db.documentFiles.get('doc-fantome')).toBeUndefined();
  });

  it('refuse une archive illisible SANS avoir effacé la bibliothèque', async () => {
    await seedLibrary();
    const bogus = new Blob([zipSync({ 'lisezmoi.txt': new TextEncoder().encode('rien') }).slice()]);

    await expect(importBackupArchive(bogus)).rejects.toThrow(/data\.json/);
    // L'échec vient avant toute écriture : rien n'a bougé.
    expect(await db.subjects.count()).toBe(1);
    expect(await db.documents.count()).toBe(1);
  });

  it('reconnaît une archive à son contenu, pas à son extension', async () => {
    const { blob } = await exportBackupArchive();
    expect(await looksLikeArchive(blob)).toBe(true);

    const json = new Blob([JSON.stringify({ v: 2 })], { type: 'application/json' });
    expect(await looksLikeArchive(json)).toBe(false);
  });
});
