import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import type { AnatomyCategory, AnatomySheet, AnatomyStructure, ID } from '@/types';

export function useAnatomyStructures(region?: string, category?: AnatomyCategory): AnatomyStructure[] | undefined {
  return useLiveQuery(async () => {
    let structures = await db.anatomyStructures.toArray();
    if (region) structures = structures.filter((s) => s.region === region);
    if (category) structures = structures.filter((s) => s.category === category);
    return structures.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [region, category]);
}

export function useAnatomyStructure(id: ID | undefined): AnatomyStructure | undefined | null {
  return useLiveQuery(async () => (id ? ((await db.anatomyStructures.get(id)) ?? null) : null), [id]);
}

export function useAnatomySheet(
  structureId: ID | undefined,
  origin: 'course' | 'internet',
): AnatomySheet | undefined | null {
  return useLiveQuery(async () => {
    if (!structureId) return null;
    const sheet = await db.anatomySheets.where('[structureId+origin]').equals([structureId, origin]).first();
    return sheet ?? null;
  }, [structureId, origin]);
}
