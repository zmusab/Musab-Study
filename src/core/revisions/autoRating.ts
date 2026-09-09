import type { AnswerVerdict } from './evaluateAnswer';
import type { Confidence, Rating } from '@/types';

/**
 * NOTATION AUTOMATIQUE — déduire la note SM-2 au lieu de la demander.
 *
 * Jusqu'ici, l'étudiant devait juger lui-même chaque carte : « Encore »,
 * « Difficile », « Bien », « Facile », plus un niveau de confiance. Cinq
 * décisions par carte, sur des dizaines de cartes, alors que l'application
 * dispose déjà des deux signaux qui comptent : ce qu'il a répondu (évalué par
 * `evaluateAnswer`) et le temps qu'il a mis.
 *
 * Ce module reste ENTIÈREMENT déterministe et local — aucun appel IA. Il ne
 * remplace pas SM-2, il lui fournit son entrée : `scheduleNext` est inchangé.
 *
 * L'étudiant garde le dernier mot. La note déduite est AFFICHÉE avec sa
 * raison, et modifiable d'un geste : un moteur qui se trompe en silence serait
 * pire que la question qu'il remplace.
 */

export interface AutoRating {
  rating: Rating;
  confidence: Confidence;
  /** Phrase courte montrée à l'étudiant — il doit pouvoir comprendre, donc contester. */
  reason: string;
}

/**
 * Temps « raisonnable » pour lire une question et taper sa réponse, au clavier
 * tactile d'un iPad. Volontairement généreux : dépasser ce budget ne signale
 * PAS un échec, seulement que le rappel a demandé un effort — la différence
 * entre « Facile » et « Bien », jamais entre réussite et échec.
 */
export function answerTimeBudgetMs(expectedAnswer: string): number {
  const words = expectedAnswer.trim().split(/\s+/).filter(Boolean).length;
  const budget = 10_000 + words * 2_000;
  return Math.min(budget, 120_000);
}

/**
 * Note déduite d'une réponse, ou `null` quand le moteur ne peut pas trancher —
 * l'application repose alors la question à l'étudiant plutôt que d'inventer une
 * note. C'est la même règle d'abstention que partout ailleurs dans le projet.
 */
export function deriveRating(
  verdict: AnswerVerdict,
  elapsedMs: number,
  expectedAnswer: string,
): AutoRating | null {
  if (verdict === 'indeterminate') return null;

  if (verdict === 'incorrect') {
    return { rating: 0, confidence: 'low', reason: 'Réponse incorrecte — la carte revient très vite.' };
  }

  if (verdict === 'partial') {
    return {
      rating: 1,
      confidence: 'medium',
      reason: 'Réponse incomplète — la carte revient bientôt.',
    };
  }

  // Correcte : le temps de réponse départage « su d'emblée » et « retrouvé ».
  const quick = elapsedMs <= answerTimeBudgetMs(expectedAnswer);
  return quick
    ? { rating: 3, confidence: 'high', reason: 'Correct, et rapidement — la carte s’espace nettement.' }
    : { rating: 2, confidence: 'medium', reason: 'Correct, après réflexion — la carte s’espace un peu.' };
}
