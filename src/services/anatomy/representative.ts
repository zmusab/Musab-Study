import type { AnatomyStructure } from '@/types';

/**
 * Choix de la structure qui REPRÉSENTE un groupe (une région, une
 * sous-région, un système) dans les vignettes de l'interface.
 *
 * L'objectif est d'afficher une vraie géométrie plutôt qu'une icône
 * décorative. La règle est volontairement déterministe et pure — donc
 * testable sans WebGL — et ne choisit jamais une structure sans maillage :
 * si le groupe n'en contient aucune, la fonction renvoie `null` et
 * l'interface affiche sa pastille « géométrie 3D non disponible ».
 *
 * Ordre de préférence :
 *   1. structure sans latéralité (« Fémur » plutôt que « Fémur droit ») —
 *      une vignette générique parle mieux qu'un côté arbitraire ;
 *   2. nom le plus court — les noms longs sont des sous-parties précises ;
 *   3. ordre alphabétique — départage stable, indépendant de l'ordre de la
 *      base.
 */
const SIDED = /\b(droit|droite|gauche)\b/i;

export function pickRepresentative(
  structures: readonly AnatomyStructure[],
  predicate: (s: AnatomyStructure) => boolean,
): AnatomyStructure | null {
  let best: AnatomyStructure | null = null;
  for (const candidate of structures) {
    if (!candidate.model3dRef || !predicate(candidate)) continue;
    if (best === null || rank(candidate, best) < 0) best = candidate;
  }
  return best;
}

function rank(a: AnatomyStructure, b: AnatomyStructure): number {
  const sided = Number(SIDED.test(a.name)) - Number(SIDED.test(b.name));
  if (sided !== 0) return sided;
  if (a.name.length !== b.name.length) return a.name.length - b.name.length;
  return a.name.localeCompare(b.name, 'fr');
}
