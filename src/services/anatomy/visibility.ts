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
  /**
   * Retour du mode apprentissage, appliqué DIRECTEMENT sur le modèle :
   * `'correct'` = c'était la bonne structure (vert), `'incorrect'` = celle
   * qui a été cliquée à tort (rouge). `null` = pas de correction en cours.
   */
  feedback: LearningFeedbackKind | null;
}

export type LearningFeedbackKind = 'correct' | 'incorrect';

/**
 * État d'une question du mode apprentissage. `answeredId` reste `null` tant
 * que l'élève n'a pas répondu : avant la réponse, la cible n'est évidemment
 * PAS mise en évidence, sinon le jeu n'aurait aucun intérêt.
 */
export interface LearningState {
  targetId: ID;
  answeredId: ID | null;
}

export interface VisibilityState {
  activeSystems: SystemVisibility;
  selectedId: ID | null;
  isolated: boolean;
  learning?: LearningState | null;
}

export const HIDDEN_OPACITY = 0;
export const DIMMED_OPACITY = 0.18;
export const FULL_OPACITY = 1;

export function computeVisibility(
  structure: { id: ID; category: AnatomyCategory },
  state: VisibilityState,
): StructureVisualState {
  if (state.activeSystems[structure.category] !== true) {
    return { opacity: HIDDEN_OPACITY, highlighted: false, feedback: null };
  }

  const isSelected = state.selectedId !== null && state.selectedId === structure.id;

  // Correction du mode apprentissage : elle prime sur la sélection, car
  // c'est elle que l'élève doit voir sur le modèle. La bonne structure passe
  // au vert ; si la réponse était fausse, la structure cliquée passe au
  // rouge EN MÊME TEMPS que la bonne apparaît en vert — les deux sont
  // visibles simultanément, c'est ce qui permet de comparer.
  const learning = state.learning;
  if (learning && learning.answeredId !== null) {
    if (structure.id === learning.targetId) {
      return { opacity: FULL_OPACITY, highlighted: true, feedback: 'correct' };
    }
    if (structure.id === learning.answeredId) {
      return { opacity: FULL_OPACITY, highlighted: true, feedback: 'incorrect' };
    }
    return { opacity: DIMMED_OPACITY, highlighted: false, feedback: null };
  }

  // Isolation : seule la structure sélectionnée reste visible, quel que
  // soit l'état des systèmes — restaurer désactive simplement `isolated`.
  if (state.isolated && state.selectedId !== null) {
    return isSelected
      ? { opacity: FULL_OPACITY, highlighted: true, feedback: null }
      : { opacity: HIDDEN_OPACITY, highlighted: false, feedback: null };
  }

  if (state.selectedId !== null) {
    return isSelected
      ? { opacity: FULL_OPACITY, highlighted: true, feedback: null }
      : { opacity: DIMMED_OPACITY, highlighted: false, feedback: null };
  }

  return { opacity: FULL_OPACITY, highlighted: false, feedback: null };
}

/** Compte des systèmes actifs — pour l'affichage "N systèmes actifs" et les tests de combinaison. */
export function countActiveSystems(activeSystems: SystemVisibility): number {
  return Object.values(activeSystems).filter(Boolean).length;
}
