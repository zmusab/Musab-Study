import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import headNeckCatalog from '@/data/anatomy/headNeckCatalog.json';
import type { AnatomyCategory, AnatomySheet, AnatomyStructure, Citation, ID } from '@/types';

/** Entrée brute du catalogue statique versionné (source de vérité — voir SOURCES.md). */
export interface CatalogEntry {
  id: string;
  name: string;
  latinName: string;
  category: AnatomyCategory;
  region: string;
  fmaId: string | null;
  hasMesh: boolean;
  fdi?: string;
  vesselType?: 'artery' | 'vein';
}

export const HEAD_NECK_CATALOG: readonly CatalogEntry[] = headNeckCatalog as CatalogEntry[];

/**
 * Peuple `anatomyStructures` depuis le catalogue statique — idempotent (upsert
 * par id de catalogue, stable et non généré) : rejouer le seed ne crée jamais
 * de doublon, et une structure déjà liée à une matière (`subjectId`) garde ce
 * lien même si le catalogue est régénéré.
 */
export async function seedHeadNeckCatalog(): Promise<void> {
  // `region` n'est pas indexé (champ additif, pas de bump de version Dexie
  // nécessaire — voir db.ts) : on filtre en mémoire, la table reste petite.
  const existing = (await db.anatomyStructures.toArray()).filter((s) => s.region === 'tete-et-cou');
  const existingById = new Map(existing.map((s) => [s.id, s]));

  const rows: AnatomyStructure[] = HEAD_NECK_CATALOG.map((entry) => {
    const previous = existingById.get(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      latinName: entry.latinName,
      category: entry.category,
      subjectId: previous?.subjectId ?? null,
      model3dRef: entry.hasMesh ? entry.id : null,
      region: entry.region,
      createdAt: previous?.createdAt ?? nowISO(),
    };
  });

  await db.anatomyStructures.bulkPut(rows);
}

export interface StructureFilter {
  category?: AnatomyCategory;
  region?: string;
}

export async function listStructures(filter: StructureFilter = {}): Promise<AnatomyStructure[]> {
  let structures = filter.category
    ? await db.anatomyStructures.where('category').equals(filter.category).toArray()
    : await db.anatomyStructures.toArray();
  if (filter.region) structures = structures.filter((s) => s.region === filter.region);
  return structures.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function getStructure(id: ID): Promise<AnatomyStructure | undefined> {
  return db.anatomyStructures.get(id);
}

export async function linkStructureToSubject(id: ID, subjectId: ID | null): Promise<void> {
  await db.anatomyStructures.update(id, { subjectId });
}

/** Fiche d'une structure pour une provenance donnée — via l'index composé, sans scanner toute la table. */
export async function getAnatomySheet(
  structureId: ID,
  origin: 'course' | 'internet',
): Promise<AnatomySheet | undefined> {
  return db.anatomySheets.where('[structureId+origin]').equals([structureId, origin]).first();
}

/** Enregistre (ou remplace) la fiche d'une structure pour une provenance — une régénération écrase l'ancienne. */
export async function saveAnatomySheet(
  structureId: ID,
  origin: 'course' | 'internet',
  content: string,
  citations: Citation[],
): Promise<AnatomySheet> {
  const existing = await getAnatomySheet(structureId, origin);
  const sheet: AnatomySheet = {
    id: existing?.id ?? uid('anatsheet'),
    structureId,
    origin,
    content,
    citations,
    generatedAt: nowISO(),
  };
  await db.anatomySheets.put(sheet);
  return sheet;
}
