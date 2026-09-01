import type { AnatomyStructure } from '@/types';
import { SUBREGIONS } from './regions';

/**
 * Arborescence anatomique du CORPS ENTIER.
 *
 * Elle décrit la structure visée (§3) — Corps entier → région → sous-région —
 * indépendamment de ce qui est aujourd'hui modélisé. La disponibilité n'est
 * JAMAIS écrite en dur ici : elle est calculée par `buildRegionTree()` à
 * partir du catalogue réellement généré depuis BodyParts3D. Une région sans
 * structure maillée est donc affichée comme indisponible, jamais masquée ni
 * simulée.
 *
 * Ajouter une région plus tard = fournir ses structures dans le catalogue
 * (via une source vérifiée) ; aucune modification de ce fichier n'est
 * nécessaire pour qu'elle devienne disponible.
 */
export interface BodyRegionNode {
  id: string;
  label: string;
  icon: string;
  /** Sous-région du catalogue correspondante, quand la feuille est modélisée. */
  subregion?: string;
  children?: readonly BodyRegionNode[];
  /**
   * Raison explicite d'indisponibilité, affichée telle quelle à
   * l'utilisateur — pour ne jamais laisser croire qu'un contenu 3D existe.
   */
  unavailableReason?: string;
}

const NO_ASSETS = 'Aucun maillage 3D dans les données ouvertes intégrées aujourd’hui.';

export const BODY_TREE: BodyRegionNode = {
  id: 'corps',
  label: 'Corps entier',
  icon: '🧍',
  children: [
    {
      id: 'tete-et-cou',
      label: 'Tête et cou',
      icon: '🧠',
      children: [
        { id: 'r-crane', label: 'Crâne', icon: '🦴', subregion: 'crane' },
        { id: 'r-face', label: 'Face', icon: '🙂', subregion: 'face' },
        { id: 'r-machoire', label: 'Mâchoire et bouche', icon: '🦷', subregion: 'machoire' },
        { id: 'r-dents', label: 'Dents', icon: '🪥', subregion: 'dents' },
        { id: 'r-orbite', label: 'Orbite', icon: '👁️', subregion: 'orbite' },
        { id: 'r-cou', label: 'Cou', icon: '⬇️', subregion: 'cou' },
        { id: 'r-encephale', label: 'Encéphale', icon: '🧠', subregion: 'encephale' },
        {
          id: 'r-nerfs-craniens',
          label: 'Nerfs crâniens',
          icon: '⚡',
          // Réels et présents au catalogue comme structures « cours », mais
          // sans géométrie dans BodyParts3D (seuls les nerfs optiques y sont).
          unavailableReason: 'Seuls les nerfs optiques sont modélisés dans BodyParts3D — les autres restent des structures « cours ».',
        },
      ],
    },
    { id: 'tronc', label: 'Tronc', icon: '🫁', unavailableReason: NO_ASSETS },
    {
      id: 'membre-superieur',
      label: 'Membre supérieur',
      icon: '💪',
      children: [
        { id: 'epaule', label: 'Épaule', icon: '🦴', unavailableReason: NO_ASSETS },
        { id: 'bras', label: 'Bras', icon: '💪', unavailableReason: NO_ASSETS },
        { id: 'coude', label: 'Coude', icon: '🦴', unavailableReason: NO_ASSETS },
        { id: 'avant-bras', label: 'Avant-bras', icon: '💪', unavailableReason: NO_ASSETS },
        { id: 'poignet', label: 'Poignet', icon: '🦴', unavailableReason: NO_ASSETS },
        { id: 'main', label: 'Main', icon: '✋', unavailableReason: NO_ASSETS },
      ],
    },
    {
      id: 'membre-inferieur',
      label: 'Membre inférieur',
      icon: '🦵',
      children: [
        { id: 'bassin', label: 'Bassin', icon: '🦴', unavailableReason: NO_ASSETS },
        { id: 'cuisse', label: 'Cuisse', icon: '🦵', unavailableReason: NO_ASSETS },
        { id: 'genou', label: 'Genou', icon: '🦴', unavailableReason: NO_ASSETS },
        { id: 'jambe', label: 'Jambe', icon: '🦵', unavailableReason: NO_ASSETS },
        { id: 'cheville', label: 'Cheville', icon: '🦴', unavailableReason: NO_ASSETS },
        { id: 'pied', label: 'Pied', icon: '🦶', unavailableReason: NO_ASSETS },
      ],
    },
  ],
};

/** Nœud enrichi des comptes RÉELS issus du catalogue. */
export interface RegionNode extends BodyRegionNode {
  /** Nombre de structures du catalogue rattachées à ce nœud (sous-arbre compris). */
  structureCount: number;
  /** Dont celles qui ont un maillage 3D réel. */
  meshCount: number;
  /** Vrai seulement si au moins une structure de ce nœud est réellement modélisée. */
  available: boolean;
  children?: RegionNode[];
}

/**
 * Décore l'arbre avec les comptes réels. Un nœud est « disponible » si et
 * seulement si le catalogue contient au moins une structure MAILLÉE pour lui —
 * c'est la seule source de vérité, pas une liste tenue à la main.
 */
export function buildRegionTree(structures: readonly AnatomyStructure[]): RegionNode {
  const bySubregion = new Map<string, { total: number; meshed: number }>();
  for (const s of structures) {
    if (!s.subregion) continue;
    const entry = bySubregion.get(s.subregion) ?? { total: 0, meshed: 0 };
    entry.total += 1;
    if (s.model3dRef !== null) entry.meshed += 1;
    bySubregion.set(s.subregion, entry);
  }

  const decorate = (node: BodyRegionNode): RegionNode => {
    const children = node.children?.map(decorate);
    const own = node.subregion ? bySubregion.get(node.subregion) : undefined;
    const structureCount =
      (own?.total ?? 0) + (children?.reduce((sum, c) => sum + c.structureCount, 0) ?? 0);
    const meshCount = (own?.meshed ?? 0) + (children?.reduce((sum, c) => sum + c.meshCount, 0) ?? 0);
    return { ...node, children, structureCount, meshCount, available: meshCount > 0 };
  };

  return decorate(BODY_TREE);
}

/** Chemin racine → nœud, pour le fil d'Ariane. Vide si l'identifiant est inconnu. */
export function regionPath(tree: RegionNode, nodeId: string): RegionNode[] {
  const walk = (node: RegionNode, trail: RegionNode[]): RegionNode[] | null => {
    const next = [...trail, node];
    if (node.id === nodeId) return next;
    for (const child of node.children ?? []) {
      const found = walk(child, next);
      if (found) return found;
    }
    return null;
  };
  return walk(tree, []) ?? [];
}

/** Retrouve le nœud correspondant à une sous-région du catalogue. */
export function nodeForSubregion(tree: RegionNode, subregion: string): RegionNode | null {
  const walk = (node: RegionNode): RegionNode | null => {
    if (node.subregion === subregion) return node;
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(tree);
}

/**
 * Garde-fou de cohérence : toute sous-région réellement présente au catalogue
 * doit être rattachée à un nœud de l'arbre, sinon elle serait invisible dans
 * la navigation. Utilisé par les tests.
 */
export function orphanSubregions(): string[] {
  const attached = new Set<string>();
  const walk = (node: BodyRegionNode) => {
    if (node.subregion) attached.add(node.subregion);
    node.children?.forEach(walk);
  };
  walk(BODY_TREE);
  return SUBREGIONS.filter((s) => !attached.has(s.id)).map((s) => s.id);
}
