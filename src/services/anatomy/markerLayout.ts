/**
 * Répartition de positions le long d'un axe, sans chevauchement.
 *
 * Logique PURE et déterministe, volontairement séparée de tout composant :
 * elle ne connaît que des coordonnées écran déjà projetées, donc elle se
 * teste sans WebGL ni navigateur.
 *
 * Utilisée par le schéma anatomique (`BodySchema`) pour écarter des points
 * d'accroche trop serrés — six zones de la tête tiennent dans quelques
 * pixels de la vue corps entier.
 *
 * Note : le placement des points du modèle 3D vit dans `dotLayout.ts`. Cette
 * fonction-ci ne concerne que la répartition sur un axe.
 */

/**
 * Répartit une série de positions désirées en respectant un espacement
 * minimal, en restant aussi proche que possible des positions d'origine et
 * dans les bornes [min, max]. Deux passes : on pousse vers le bas, puis on
 * corrige le débordement en remontant depuis la fin.
 */
export function spreadPositions(desired: number[], spacing: number, min: number, max: number): number[] {
  if (desired.length === 0) return [];
  const out = [...desired];

  for (let i = 1; i < out.length; i++) {
    if (out[i]! < out[i - 1]! + spacing) out[i] = out[i - 1]! + spacing;
  }
  const overflow = out[out.length - 1]! - max;
  if (overflow > 0) {
    for (let i = 0; i < out.length; i++) out[i] = out[i]! - overflow;
  }
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i]! > out[i + 1]! - spacing) out[i] = out[i + 1]! - spacing;
  }
  // Si l'ensemble ne tient pas dans la hauteur disponible, on borne : le
  // dépassement résiduel est assumé plutôt que de superposer les étiquettes.
  for (let i = 0; i < out.length; i++) out[i] = Math.max(min, out[i]!);
  return out;
}
