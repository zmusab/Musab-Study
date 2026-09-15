import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import bodyCatalog from '@/data/anatomy/bodyCatalog.json';
import type { AnatomyCategory, AnatomySheet, AnatomyStructure, Citation, ID } from '@/types';

/**
 * Entrée du catalogue — GÉNÉRÉ, jamais écrit à la main :
 * `node scripts/anatomy/build-catalog.mjs` le dérive de l'arbre d'inclusion
 * officiel de BodyParts3D. Voir SOURCES.md.
 */
export interface CatalogEntry {
  id: string;
  name: string;
  latinName: string | null;
  category: AnatomyCategory;
  region: string | null;
  subregion: string | null;
  fmaId: string | null;
  hasMesh: boolean;
  /** Nombre de triangles réellement présents dans la source (0 si structure « cours »). */
  triangles: number;
  /** Libellé anglais d'origine dans BodyParts3D — trace de provenance vérifiable. */
  sourceLabel: string | null;
  /** Numérotation FDI, uniquement pour les dents. */
  fdi?: number;
}

export const BODY_CATALOG: readonly CatalogEntry[] = bodyCatalog as CatalogEntry[];

/**
 * Peuple `anatomyStructures` depuis le catalogue statique — idempotent (upsert
 * par id de catalogue, stable et non généré) : rejouer le seed ne crée jamais
 * de doublon, et une structure déjà liée à une matière (`subjectId`) garde ce
 * lien même si le catalogue est régénéré.
 */
export async function seedBodyCatalog(): Promise<void> {
  // `region` n'est pas indexé (champ additif, pas de bump de version Dexie
  // nécessaire — voir db.ts) : on filtre en mémoire, la table reste petite.
  const existing = await db.anatomyStructures.toArray();
  const existingById = new Map(existing.map((s) => [s.id, s]));

  const rows: AnatomyStructure[] = BODY_CATALOG.map((entry) => {
    const previous = existingById.get(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      // Le catalogue laisse `latinName` à null quand le nom de la
      // Terminologia Anatomica n'est pas certain (plutôt qu'un latin
      // approximatif) ; l'UI traite déjà la chaîne vide comme « absent ».
      latinName: entry.latinName ?? '',
      category: entry.category,
      subjectId: previous?.subjectId ?? null,
      model3dRef: entry.hasMesh ? entry.id : null,
      region: entry.region,
      subregion: entry.subregion,
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
