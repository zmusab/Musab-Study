import type { AnatomyStructure } from '@/types';

/**
 * Sous-régions de la Tête et du Cou — un regroupement des 88 structures déjà
 * cataloguées (`headNeckCatalog.json`), pas une nouvelle donnée anatomique.
 * Sert la navigation hiérarchique demandée (Corps → Tête et cou → sous-
 * région → structure) sans dépendre d'un second niveau de région 3D.
 */
export interface SubregionMeta {
  id: string;
  label: string;
  icon: string;
}

export const SUBREGIONS: readonly SubregionMeta[] = [
  { id: 'crane', label: 'Crâne', icon: '🦴' },
  { id: 'machoire', label: 'Mâchoire', icon: '🦷' },
  { id: 'dents', label: 'Dents', icon: '🪥' },
  { id: 'face', label: 'Face', icon: '👁️' },
  { id: 'cou', label: 'Cou', icon: '⬇️' },
];

const SUBREGION_BY_ID = new Map(SUBREGIONS.map((s) => [s.id, s]));

export function subregionMeta(id: string | null): SubregionMeta | null {
  return id ? (SUBREGION_BY_ID.get(id) ?? null) : null;
}

/** Structures d'une sous-région, triées par nom — pour la liste affichée une fois la sous-région ouverte. */
export function structuresInSubregion(structures: readonly AnatomyStructure[], subregionId: string): AnatomyStructure[] {
  return structures.filter((s) => s.subregion === subregionId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export interface SubregionSummary extends SubregionMeta {
  structureCount: number;
  meshCount: number;
}

/** Une entrée par sous-région réellement peuplée, avec ses vrais comptes — jamais une sous-région vide affichée comme pleine. */
export function summarizeSubregions(structures: readonly AnatomyStructure[]): SubregionSummary[] {
  return SUBREGIONS.map((meta) => {
    const inRegion = structuresInSubregion(structures, meta.id);
    return {
      ...meta,
      structureCount: inRegion.length,
      meshCount: inRegion.filter((s) => s.model3dRef !== null).length,
    };
  }).filter((summary) => summary.structureCount > 0);
}
