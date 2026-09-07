import { comparisonKey } from '@/core/text';

/** Normalisation partagée — voir `core/text`, une seule définition pour tout le projet. */
const normalizeQuestion = comparisonKey;

/**
 * Vrai si `question` reformule, mot pour mot ou presque, une question déjà
 * posée — jamais une vraie compréhension sémantique, seulement un filet de
 * sécurité bon marché à base de recouvrement de vocabulaire. Partagé entre
 * la génération IA (`services/flashcards/generate.ts`) et le moteur local
 * (`services/local/localFlashcards.ts`) — la même règle de déduplication
 * s'applique quelle que soit la source des propositions.
 */
export function isDuplicateQuestion(question: string, existingQuestions: readonly string[]): boolean {
  const normalized = normalizeQuestion(question);
  if (normalized.length === 0) return false;
  const words = new Set(normalized.split(' '));

  return existingQuestions.some((existing) => {
    const existingNormalized = normalizeQuestion(existing);
    if (existingNormalized === normalized) return true;

    const existingWords = new Set(existingNormalized.split(' '));
    const intersection = [...words].filter((w) => existingWords.has(w)).length;
    const union = new Set([...words, ...existingWords]).size;
    // Recouvrement massif du vocabulaire : une vraie reformulation
    // superficielle, pas juste deux questions qui partagent un même sujet
    // sans partager la question elle-même.
    return union > 0 && intersection / union >= 0.7;
  });
}
