const normalizeForComparison = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const WORD_PATTERN = /[a-zà-ÿ0-9]+/gi;

interface WordEntry {
  original: string;
  normalized: string;
}

/** Mots « significatifs » d'un texte : au moins 3 lettres/chiffres après normalisation, casse d'origine conservée pour l'affichage. */
function significantWords(text: string): WordEntry[] {
  const matches = text.match(WORD_PATTERN) ?? [];
  return matches
    .map((word) => ({ original: word, normalized: normalizeForComparison(word) }))
    .filter((entry) => entry.normalized.length > 2);
}

const VRAI_TOKENS = new Set(['vrai', 'v']);
const FAUX_TOKENS = new Set(['faux', 'f']);

/** Reconnaît un texte réduit à « vrai »/« v » ou « faux »/« f » — jamais une devinette sur un texte plus long ou ambigu. */
function detectBooleanToken(text: string): 'vrai' | 'faux' | null {
  const normalized = normalizeForComparison(text);
  if (VRAI_TOKENS.has(normalized)) return 'vrai';
  if (FAUX_TOKENS.has(normalized)) return 'faux';
  return null;
}

export type AnswerVerdict = 'correct' | 'partial' | 'incorrect' | 'indeterminate';

export interface AnswerEvaluation {
  verdict: AnswerVerdict;
  /** Explication pédagogique — UNIQUEMENT des mots réellement présents dans la réponse attendue, jamais une phrase inventée. */
  explanation: string | null;
}

const CORRECT_THRESHOLD = 0.85;
const PARTIAL_THRESHOLD = 0.4;

/**
 * Évaluation LOCALE et déterministe d'une réponse d'étudiant — indépendante
 * de l'IA, aucun appel réseau. Ce n'est PAS un correcteur sémantique : c'est
 * un recouvrement de mots-clés entre la réponse tapée et la réponse
 * attendue, calibré pour distinguer une réponse clairement fausse ("Jsp")
 * d'une réponse partiellement correcte (il manque une composante) d'une
 * réponse correcte — mais quand ce recouvrement ne permet pas de trancher
 * de façon fiable, le verdict est `indeterminate`, jamais une devinette.
 *
 * RÈGLE ABSOLUE : ce résultat est un feedback pédagogique affiché AVANT les
 * boutons de confiance — il ne pilote jamais la répétition espacée (SM-2).
 * Seul le bouton choisi par l'étudiant (Encore/Difficile/Bien/Facile) reste
 * la source de vérité pour `reviewCard`.
 */
export function evaluateAnswer(attempt: string, expectedAnswer: string): AnswerEvaluation {
  const trimmedAttempt = attempt.trim();
  if (trimmedAttempt.length === 0) {
    return { verdict: 'indeterminate', explanation: null };
  }

  // ── Cas Vrai/Faux : la réponse attendue est exactement "Vrai" ou "Faux". ──
  const expectedBoolean = detectBooleanToken(expectedAnswer);
  if (expectedBoolean) {
    const attemptBoolean = detectBooleanToken(trimmedAttempt);
    if (!attemptBoolean) return { verdict: 'indeterminate', explanation: null };
    return attemptBoolean === expectedBoolean
      ? { verdict: 'correct', explanation: null }
      : { verdict: 'incorrect', explanation: null };
  }

  const normalizedAttempt = normalizeForComparison(trimmedAttempt);
  const normalizedExpected = normalizeForComparison(expectedAnswer);
  if (normalizedAttempt === normalizedExpected) {
    return { verdict: 'correct', explanation: null };
  }

  const expectedWords = significantWords(expectedAnswer);
  if (expectedWords.length === 0) {
    // La réponse attendue elle-même ne porte aucun mot exploitable — aucune évaluation fiable possible.
    return { verdict: 'indeterminate', explanation: null };
  }
  const attemptWords = new Set(significantWords(trimmedAttempt).map((entry) => entry.normalized));

  const missing = expectedWords.filter((entry) => !attemptWords.has(entry.normalized));
  const coverage = (expectedWords.length - missing.length) / expectedWords.length;

  if (coverage >= CORRECT_THRESHOLD) return { verdict: 'correct', explanation: null };

  if (coverage >= PARTIAL_THRESHOLD) {
    const missingOriginals = [...new Set(missing.map((entry) => entry.original.toLowerCase()))];
    const explanation =
      missingOriginals.length > 0
        ? `Une partie importante de la réponse est présente, mais il manque : ${missingOriginals.join(', ')}.`
        : null;
    return { verdict: 'partial', explanation };
  }

  return { verdict: 'incorrect', explanation: null };
}
