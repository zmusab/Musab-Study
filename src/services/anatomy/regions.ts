import type { AnatomyStructure } from '@/types';
import manifest from '@/data/anatomy/assetManifest.json';

/**
 * Régions et sous-régions du corps entier.
 *
 * Cette table décrit la NAVIGATION ; ce qui est réellement disponible en 3D
 * est déterminé par le catalogue généré et le manifeste d'assets, jamais
 * écrit en dur ici. Une sous-région sans structure maillée s'affiche donc
 * comme indisponible plutôt que d'être masquée ou simulée.
 *
 * Aucune icône décorative ici : l'interface illustre chaque région avec la
 * VIGNETTE d'une structure réelle qu'elle contient (`pickRepresentative` +
 * `StructureThumbnail`), donc avec de la géométrie, pas un emoji.
 *
 * Les identifiants sont les mêmes que ceux produits par
 * `scripts/anatomy/regionTree.mjs` — un test vérifie qu'aucune sous-région du
 * catalogue n'est absente d'ici.
 */
export interface SubregionMeta {
  id: string;
  region: string;
  label: string;
  /** Région volumineuse et secondaire : chargée seulement si on l'ouvre. */
  lazy?: boolean;
}

export interface RegionMeta {
  id: string;
  label: string;
}

export const REGIONS: readonly RegionMeta[] = [
  { id: 'tete-et-cou', label: 'Tête et cou' },
  { id: 'tronc', label: 'Tronc' },
  { id: 'membre-superieur', label: 'Membre supérieur' },
  { id: 'membre-inferieur', label: 'Membre inférieur' },
  { id: 'corps', label: 'Général' },
];

export const SUBREGIONS: readonly SubregionMeta[] = [
  // Tête et cou
  { id: 'crane', region: 'tete-et-cou', label: 'Crâne' },
  { id: 'face', region: 'tete-et-cou', label: 'Face' },
  { id: 'machoire', region: 'tete-et-cou', label: 'Mâchoire et bouche' },
  { id: 'dents', region: 'tete-et-cou', label: 'Dents' },
  { id: 'orbite', region: 'tete-et-cou', label: 'Orbite' },
  { id: 'cou', region: 'tete-et-cou', label: 'Cou' },
  { id: 'encephale', region: 'tete-et-cou', label: 'Encéphale', lazy: true },
  // Tronc
  { id: 'thorax', region: 'tronc', label: 'Thorax', lazy: true },
  { id: 'abdomen', region: 'tronc', label: 'Abdomen', lazy: true },
  { id: 'bassin', region: 'tronc', label: 'Bassin', lazy: true },
  { id: 'dos', region: 'tronc', label: 'Dos', lazy: true },
  // Membre supérieur
  { id: 'epaule', region: 'membre-superieur', label: 'Épaule', lazy: true },
  { id: 'bras', region: 'membre-superieur', label: 'Bras', lazy: true },
  { id: 'coude', region: 'membre-superieur', label: 'Coude', lazy: true },
  { id: 'avant-bras', region: 'membre-superieur', label: 'Avant-bras', lazy: true },
  { id: 'poignet', region: 'membre-superieur', label: 'Poignet', lazy: true },
  { id: 'main', region: 'membre-superieur', label: 'Main', lazy: true },
  // Membre inférieur
  { id: 'hanche', region: 'membre-inferieur', label: 'Hanche', lazy: true },
  { id: 'cuisse', region: 'membre-inferieur', label: 'Cuisse', lazy: true },
  { id: 'genou', region: 'membre-inferieur', label: 'Genou', lazy: true },
  { id: 'jambe', region: 'membre-inferieur', label: 'Jambe', lazy: true },
  { id: 'pied', region: 'membre-inferieur', label: 'Pied', lazy: true },
  // Général
  { id: 'tegument', region: 'corps', label: 'Tégument', lazy: true },
];

const SUBREGION_BY_ID = new Map(SUBREGIONS.map((s) => [s.id, s]));

export function subregionMeta(id: string | null): SubregionMeta | null {
  return id ? (SUBREGION_BY_ID.get(id) ?? null) : null;
}

export function regionMeta(id: string | null): RegionMeta | null {
  return id ? (REGIONS.find((r) => r.id === id) ?? null) : null;
}

export function subregionsOfRegion(regionId: string): SubregionMeta[] {
  return SUBREGIONS.filter((s) => s.region === regionId);
}

/**
 * Chargement initial en DEUX TEMPS.
 *
 * Le corps entier représente 26,3 M triangles et 106 Mo d'assets : les
 * charger tous à l'ouverture serait absurde. Mais même la tête et le cou
 * pèsent 11,5 Mo — dont 3,3 Mo pour le seul cou, qui est hors du cadrage
 * initial de la caméra (elle vise crâne, face, mâchoire et dents).
 *
 * On sépare donc :
 *  - PRIORITAIRE : ce que la caméra cadre réellement à l'ouverture. Ces
 *    fichiers partent immédiatement, le modèle est utilisable au plus vite ;
 *  - CONTEXTE : ce qui complète la vue (cou, orbite) sans être le sujet. Ces
 *    fichiers partent une fois la page interactive, en arrière-plan.
 *
 * Aucune structure n'est perdue : le second temps arrive de lui-même, sans
 * action de l'utilisateur.
 */
export const PRIORITY_SUBREGIONS: readonly string[] = ['crane', 'face', 'machoire', 'dents'];

export const CONTEXT_SUBREGIONS: readonly string[] = SUBREGIONS.filter(
  (s) => s.region === 'tete-et-cou' && !s.lazy && !PRIORITY_SUBREGIONS.includes(s.id),
).map((s) => s.id);

/** Périmètre complet de la tête et du cou — priorité + contexte. */
export const DEFAULT_LOADED_SUBREGIONS: readonly string[] = [
  ...PRIORITY_SUBREGIONS,
  ...CONTEXT_SUBREGIONS,
];

/**
 * Clé du fichier `.glb` contenant une structure : le pipeline écrit un
 * fichier par couple (sous-région, système).
 */
export function assetKey(subregion: string, category: string): string {
  return `${subregion}-${category}`;
}

interface AssetGroup {
  key: string;
  subregion: string;
  category: string;
  structures: number;
  triangles: number;
}
const GROUPS = manifest as AssetGroup[];

/** Sous-régions pour lesquelles au moins un fichier d'assets existe vraiment. */
export const SUBREGIONS_WITH_ASSETS: ReadonlySet<string> = new Set(GROUPS.map((g) => g.subregion));

/** Structures d'une sous-région, triées par nom. */
export function structuresInSubregion(
  structures: readonly AnatomyStructure[],
  subregionId: string,
): AnatomyStructure[] {
  return structures
    .filter((s) => s.subregion === subregionId)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export interface SubregionSummary extends SubregionMeta {
  structureCount: number;
  meshCount: number;
  triangles: number;
}

/** Résumé réel d'une sous-région — comptes issus du catalogue, jamais estimés. */
export function summarizeSubregions(
  structures: readonly AnatomyStructure[],
  regionId?: string,
): SubregionSummary[] {
  const scope = regionId ? SUBREGIONS.filter((s) => s.region === regionId) : SUBREGIONS;
  return scope
    .map((meta) => {
      const inRegion = structuresInSubregion(structures, meta.id);
      const group = GROUPS.filter((g) => g.subregion === meta.id);
      return {
        ...meta,
        structureCount: inRegion.length,
        meshCount: inRegion.filter((s) => s.model3dRef !== null).length,
        triangles: group.reduce((sum, g) => sum + g.triangles, 0),
      };
    })
    .filter((s) => s.structureCount > 0);
}

/** Résumé par région de premier niveau. */
export function summarizeRegions(structures: readonly AnatomyStructure[]) {
  return REGIONS.map((region) => {
    const subs = summarizeSubregions(structures, region.id);
    return {
      ...region,
      subregions: subs,
      structureCount: subs.reduce((n, s) => n + s.structureCount, 0),
      meshCount: subs.reduce((n, s) => n + s.meshCount, 0),
      triangles: subs.reduce((n, s) => n + s.triangles, 0),
    };
  }).filter((r) => r.structureCount > 0);
}
