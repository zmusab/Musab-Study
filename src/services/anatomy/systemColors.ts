import palette from '@/data/anatomy/systemPalette.json';
import type { AnatomyCategory, AnatomyStructure } from '@/types';

/**
 * IDENTITÉ VISUELLE PAR SYSTÈME — source unique, partagée par le modèle 3D
 * et par toute l'interface.
 *
 * Les couleurs ne sont pas décidées ici : elles viennent de
 * `src/data/anatomy/systemPalette.json`, le même fichier que lit
 * `scripts/anatomy/convert-meshes.mjs` pour écrire le `baseColorFactor` des
 * `.glb`. La pastille d'un muscle dans la liste et le maillage de ce muscle
 * dans le modèle affichent donc littéralement la même teinte — `linear` pour
 * le glTF (espace linéaire), `hex` pour le DOM (sRGB encodé du même triplet).
 *
 * Deux distinctions que la seule `AnatomyCategory` ne porte pas :
 *  - les DENTS sont des os au sens du catalogue, mais l'usage dentaire en
 *    fait une famille à part entière — elles sont donc séparées ;
 *  - les VAISSEAUX se scindent en artères (rouge) et veines (bleu), déduites
 *    du nom réel de la structure et non d'un champ saisi à la main.
 */

interface PaletteEntry {
  label: string;
  linear: number[];
  hex: string;
}

const SYSTEMS: Record<string, PaletteEntry> = palette.systems;
const VEIN_RE = new RegExp(palette.vesselPatterns.vein, 'i');
const ARTERY_RE = new RegExp(palette.vesselPatterns.artery, 'i');

export type SystemKey = 'os' | 'dents' | 'muscles' | 'nerfs' | 'arteres' | 'veines' | 'vaisseaux' | 'organes';

/**
 * Ordre d'affichage : le squelette d'abord (le repère), puis les dents (le
 * sujet du cursus), puis les tissus mous. Cet ordre est celui des sections
 * de l'exploration par région, pour que la liste soit toujours lue pareil.
 */
export const SYSTEM_ORDER: readonly SystemKey[] = [
  'os',
  'dents',
  'muscles',
  'nerfs',
  'arteres',
  'veines',
  'vaisseaux',
  'organes',
];

/** Artère, veine, ou ni l'un ni l'autre — jamais un choix par défaut arbitraire. */
export function vesselType(name: string): 'artery' | 'vein' | null {
  if (VEIN_RE.test(name)) return 'vein';
  if (ARTERY_RE.test(name)) return 'artery';
  return null;
}

export interface SystemIdentity {
  key: SystemKey;
  label: string;
  /** Teinte sRGB — identique à celle du maillage dans le modèle 3D. */
  hex: string;
}

export function systemIdentity(key: SystemKey): SystemIdentity {
  const entry = SYSTEMS[key] ?? SYSTEMS.organes;
  return { key, label: entry!.label, hex: entry!.hex };
}

type StructureLike = Pick<AnatomyStructure, 'name' | 'category'> & { subregion?: string | null };

export function systemKeyOf(structure: StructureLike): SystemKey {
  switch (structure.category as AnatomyCategory) {
    case 'squelette':
      return structure.subregion === 'dents' ? 'dents' : 'os';
    case 'muscles':
      return 'muscles';
    case 'nerfs':
      return 'nerfs';
    case 'organes':
      return 'organes';
    case 'vaisseaux': {
      const type = vesselType(structure.name);
      return type === 'vein' ? 'veines' : type === 'artery' ? 'arteres' : 'vaisseaux';
    }
    default:
      return 'organes';
  }
}

/** Identité visuelle complète d'une structure — clé, libellé et teinte. */
export function systemOf(structure: StructureLike): SystemIdentity {
  return systemIdentity(systemKeyOf(structure));
}

/**
 * Regroupe des structures par système, dans `SYSTEM_ORDER`, en n'émettant
 * que les groupes RÉELLEMENT peuplés : une région sans vaisseau n'affiche
 * pas une section « Vaisseaux » vide.
 */
export function groupBySystem<T extends StructureLike>(
  structures: readonly T[],
): { system: SystemIdentity; structures: T[] }[] {
  const byKey = new Map<SystemKey, T[]>();
  for (const structure of structures) {
    const key = systemKeyOf(structure);
    const list = byKey.get(key);
    if (list) list.push(structure);
    else byKey.set(key, [structure]);
  }
  return SYSTEM_ORDER.filter((key) => byKey.has(key)).map((key) => ({
    system: systemIdentity(key),
    structures: byKey.get(key) as T[],
  }));
}
