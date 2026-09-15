import { describe, expect, it, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { db, clearAllData } from '@/data/db';

/**
 * LA TABLE DU PODCAST EST RÉELLEMENT SUPPRIMÉE.
 *
 * La fonctionnalité avait été retirée, mais sa table restait déclarée, avec
 * ce commentaire : « supprimer un store demanderait une migration
 * destructrice ». C'était inexact — Dexie le fait en déclarant le store
 * `null` dans une version suivante.
 *
 * Ce test vérifie les deux choses qui comptent : la table n'existe plus, ET
 * une base créée AVANT la suppression s'ouvre sans erreur en ne perdant que
 * cette table-là. Un test qui n'ouvrirait qu'une base neuve ne dirait rien du
 * seul cas qui existe chez l'utilisateur : une base déjà remplie.
 */
beforeEach(async () => {
  await clearAllData();
});

describe('suppression de la table du podcast', () => {
  it('la table n’existe plus dans la base ouverte', async () => {
    await db.open();
    expect(db.tables.map((table) => table.name)).not.toContain('podcastEpisodes');
  });

  it('les tables de cours, elles, sont toutes là', async () => {
    await db.open();
    const noms = db.tables.map((table) => table.name);
    for (const attendue of ['subjects', 'chapters', 'documents', 'flashcards', 'reviewLogs', 'notes', 'calendarEvents']) {
      expect(noms).toContain(attendue);
    }
  });

  it('une base d’avant la suppression s’ouvre et garde ses cours', async () => {
    const nom = `migration-podcast-${Date.now()}`;

    // Une base telle que l'application l'écrivait AVANT : la table du podcast
    // existe et contient un épisode.
    const ancienne = new Dexie(nom);
    ancienne.version(4).stores({
      subjects: 'id, position, name',
      podcastEpisodes: 'id, subjectId, chapterId, createdAt',
    });
    await ancienne.open();
    await ancienne.table('subjects').add({ id: 's1', name: 'Anatomie', position: 0 });
    await ancienne.table('podcastEpisodes').add({ id: 'e1', subjectId: 's1', createdAt: '2026-01-01' });
    expect(await ancienne.table('podcastEpisodes').count()).toBe(1);
    ancienne.close();

    // La même base, rouverte par une version qui supprime ce store.
    const migree = new Dexie(nom);
    migree.version(4).stores({
      subjects: 'id, position, name',
      podcastEpisodes: 'id, subjectId, chapterId, createdAt',
    });
    migree.version(5).stores({ podcastEpisodes: null });
    await migree.open();

    expect(migree.tables.map((table) => table.name)).not.toContain('podcastEpisodes');
    // Et la matière, elle, a survécu — c'est ce qui rend la migration sûre.
    expect(await migree.table('subjects').get('s1')).toMatchObject({ name: 'Anatomie' });
    migree.close();
    await Dexie.delete(nom);
  });
});
