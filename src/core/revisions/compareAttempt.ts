const normalizeForComparison = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export type AttemptComparison = 'close' | 'partial' | 'different';

/**
 * Indice de rapprochement entre la réponse tapée et la réponse attendue —
 * LOCAL, approximatif (recouvrement de mots, pas de compréhension réelle),
 * jamais un appel IA. Ce n'est PAS un verdict vrai/faux : la répétition
 * espacée reste pilotée exclusivement par le choix de l'étudiant sur les 4
 * boutons de notation, jamais par ce résultat.
 */
export function compareAttempt(attempt: string, expectedAnswer: string): AttemptComparison | null {
  const normalizedAttempt = normalizeForComparison(attempt);
  if (normalizedAttempt.length === 0) return null;

  const expected = normalizeForComparison(expectedAnswer);
  if (normalizedAttempt === expected) return 'close';

  const wordsExpected = new Set(expected.split(' ').filter((word) => word.length > 2));
  if (wordsExpected.size === 0) return null;
  const wordsAttempt = new Set(normalizedAttempt.split(' ').filter((word) => word.length > 2));

  const covered = [...wordsExpected].filter((word) => wordsAttempt.has(word)).length;
  const coverage = covered / wordsExpected.size;
  if (coverage >= 0.6) return 'close';
  if (coverage >= 0.25) return 'partial';
  return 'different';
}
