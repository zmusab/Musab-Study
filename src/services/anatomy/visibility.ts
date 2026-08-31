import type { AnatomyCategory, ID } from '@/types';

/**
 * Calcule l'état visuel (opacité, mise en évidence) de chaque structure —
 * logique PURE, sans dépendance à Three.js, testable sans WebGL. Le
 * visualiseur 3D applique ces valeurs aux matériaux, éventuellement animées.
 */

export type SystemVisibility = Partial<Record<AnatomyCategory, boolean>>;

export interface StructureVisualState {
  opacity: number;
  highlighted: boolean;
}

export interface VisibilityState {
  activeSystems: SystemVisibility;
  selectedId: ID | null;
  isolated: boolean;
}

export const HIDDEN_OPACITY = 0;
export const DIMMED_OPACITY = 0.18;
export const FULL_OPACITY = 1;

export function computeVisibility(
  structure: { id: ID; category: AnatomyCategory },
  state: VisibilityState,
): StructureVisualState {
  if (state.activeSystems[structure.category] !== true) {
    return { opacity: HIDDEN_OPACITY, highlighted: false };
  }

  const isSelected = state.selectedId !== null && state.selectedId === structure.id;

  // Isolation : seule la structure sélectionnée reste visible, quel que
  // soit l'état des systèmes — restaurer désactive simplement `isolated`.
  if (state.isolated && state.selectedId !== null) {
    return isSelected ? { opacity: FULL_OPACITY, highlighted: true } : { opacity: HIDDEN_OPACITY, highlighted: false };
  }

  if (state.selectedId !== null) {
    return isSelected
      ? { opacity: FULL_OPACITY, highlighted: true }
      : { opacity: DIMMED_OPACITY, highlighted: false };
  }

  return { opacity: FULL_OPACITY, highlighted: false };
}

/** Compte des systèmes actifs — pour l'affichage "N systèmes actifs" et les tests de combinaison. */
export function countActiveSystems(activeSystems: SystemVisibility): number {
  return Object.values(activeSystems).filter(Boolean).length;
}
