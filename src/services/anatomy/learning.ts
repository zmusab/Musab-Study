import type { AnatomyStructure } from '@/types';

/**
 * Mode apprentissage « Trouve la structure » — un mini-jeu réel construit
 * uniquement à partir des structures déjà cataloguées et déjà chargées en
 * 3D, PAS le Quiz complet du cahier des charges (banque de questions,
 * QCM, intégration SRS) : cette phase-là dépend d'une phase Quiz qui n'est
 * pas construite. Ici, aucune question n'est inventée — seul le nom réel
 * d'une structure sert de consigne, et la réponse est vérifiée contre son
 * identifiant réel, jamais simulée.
 */

/** Structure cible tirée parmi celles réellement visibles (maillage 3D + système actif) — jamais parmi les structures « cours uniquement ». */
export function pickLearningTarget(
  candidates: readonly AnatomyStructure[],
  excludeId: string | null = null,
  random: () => number = Math.random,
): AnatomyStructure | null {
  const pool = candidates.filter((s) => s.model3dRef !== null && s.id !== excludeId);
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)]!;
}

export type LearningResult = 'correct' | 'wrong';

export function evaluateGuess(targetId: string, guessId: string): LearningResult {
  return targetId === guessId ? 'correct' : 'wrong';
}
