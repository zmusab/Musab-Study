import { BODY_CATALOG } from '@/data/repositories/anatomy';

/**
 * Description d'une dent à partir de son numéro FDI.
 *
 * Rien n'est inventé : la norme FDI (ISO 3950) DÉFINIT le quadrant par le
 * premier chiffre et la position sur l'arcade par le second. Le numéro vient
 * du catalogue généré, pas d'une saisie manuelle — et une structure sans
 * numéro FDI ne reçoit aucune fiche dentaire.
 */
export interface ToothInfo {
  fdi: number;
  /** Quadrant FDI (1 à 4 pour la denture permanente). */
  quadrant: number;
  arcade: 'Maxillaire (supérieure)' | 'Mandibulaire (inférieure)';
  side: 'Droite' | 'Gauche';
  type: string;
  /** Rang sur l'arcade, de l'incisive centrale (1) à la 3ᵉ molaire (8). */
  position: number;
}

const TYPES: Record<number, string> = {
  1: 'Incisive centrale',
  2: 'Incisive latérale',
  3: 'Canine',
  4: 'Première prémolaire',
  5: 'Deuxième prémolaire',
  6: 'Première molaire',
  7: 'Deuxième molaire',
  8: 'Troisième molaire (dent de sagesse)',
};

const FDI_BY_ID = new Map(
  BODY_CATALOG.filter((entry) => typeof entry.fdi === 'number').map((entry) => [entry.id, entry.fdi as number]),
);

export function toothInfo(structureId: string): ToothInfo | null {
  const fdi = FDI_BY_ID.get(structureId);
  if (fdi === undefined) return null;
  const quadrant = Math.floor(fdi / 10);
  const position = fdi % 10;
  const type = TYPES[position];
  if (!type || quadrant < 1 || quadrant > 4) return null;
  return {
    fdi,
    quadrant,
    position,
    type,
    arcade: quadrant <= 2 ? 'Maxillaire (supérieure)' : 'Mandibulaire (inférieure)',
    // Quadrants 1 et 4 = côté droit du patient, 2 et 3 = côté gauche.
    side: quadrant === 1 || quadrant === 4 ? 'Droite' : 'Gauche',
  };
}

/** Provenance vérifiable d'une structure — libellé source et géométrie réelle. */
export interface StructureProvenance {
  sourceLabel: string | null;
  fmaId: string | null;
  triangles: number;
  hasMesh: boolean;
}

const PROVENANCE_BY_ID = new Map(
  BODY_CATALOG.map((entry) => [
    entry.id,
    {
      sourceLabel: entry.sourceLabel,
      fmaId: entry.fmaId,
      triangles: entry.triangles,
      hasMesh: entry.hasMesh,
    } satisfies StructureProvenance,
  ]),
);

export function structureProvenance(structureId: string): StructureProvenance | null {
  return PROVENANCE_BY_ID.get(structureId) ?? null;
}
