import { normalizeText, significantWordEntries, significantWords } from '@/core/text';

/**
 * Évaluation LOCALE et déterministe d'une réponse d'étudiant — aucune IA,
 * aucun appel réseau.
 *
 * ── CE QUI N'ALLAIT PAS ──────────────────────────────────────────────────
 * La version précédente comparait bêtement des sacs de mots et rendait le
 * MÊME verdict « partiellement correct » à quatre réponses de nature
 * radicalement différente :
 *   « Il est à la fois sensitif et moteur »        (juste, reformulé)
 *   « Le nerf trijumeau est uniquement sensitif »  (faux : exclut le moteur)
 *   « Le nerf trijumeau ne possède pas de … »      (faux : nie l'énoncé)
 *   « bla bla nerf trijumeau sensitif moteur bla » (charabia)
 * Elle reprochait de surcroît à l'étudiant de ne pas avoir répété « nerf,
 * trijumeau » — le sujet pourtant écrit dans la question — et comptait « est »
 * et « possède » comme du contenu obligatoire.
 *
 * Trois corrections, toutes déterministes :
 *  1. les mots outils viennent de `core/text` (« est » n'est plus du contenu) ;
 *  2. ce que la QUESTION donne déjà n'est pas réclamé à l'étudiant ;
 *  3. une CONTRADICTION (négation inversée, exclusivité) n'est plus une
 *     réponse « partielle » : c'est une réponse fausse.
 *
 * RÈGLE ABSOLUE INCHANGÉE : ce verdict est un feedback pédagogique affiché
 * avant les boutons de confiance. Il ne pilote JAMAIS la répétition espacée.
 * Seul le bouton choisi par l'étudiant (Encore/Difficile/Bien/Facile) décide
 * de la programmation SM-2.
 */

export type AnswerVerdict = 'correct' | 'partial' | 'incorrect' | 'indeterminate';

export interface AnswerEvaluation {
  verdict: AnswerVerdict;
  /** Explication — UNIQUEMENT des mots réellement présents dans la réponse attendue, jamais une phrase inventée. */
  explanation: string | null;
}

const VRAI_TOKENS = new Set(['vrai', 'v']);
const FAUX_TOKENS = new Set(['faux', 'f']);
const UNKNOWN_ANSWER_PATTERN = /^(?:je\s+)?(?:ne\s+)?(?:sais|sais\s+pas|ne\s+comprends\s+pas|aucune\s+idee|pas\s+du\s+tout|idk)$/i;

/** Reconnaît un texte réduit à « vrai »/« v » ou « faux »/« f » — jamais une devinette sur un texte plus long. */
function detectBooleanToken(text: string): 'vrai' | 'faux' | null {
  const normalized = normalizeText(text).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (VRAI_TOKENS.has(normalized)) return 'vrai';
  if (FAUX_TOKENS.has(normalized)) return 'faux';
  return null;
}

/**
 * Marqueurs de négation. Cherchés sur le texte normalisé mais NON dépouillé de
 * ses mots outils : « ne … pas », « aucun », « sans » sont précisément les
 * mots que le filtrage de mots outils supprime, alors qu'ils portent ici tout
 * le sens.
 */
const NEGATION_PATTERN =
  /\bn[e']\s*\S*\s*\b(?:pas|plus|jamais|rien)\b|\baucun\b|\baucune\b|\bjamais\b|\bsans\b|\bnon\b|\bni\b/;

/** « uniquement sensitif », « seulement moteur », « ne … que » : la réponse EXCLUT le reste. */
const EXCLUSIVITY_PATTERN = /\buniquement\b|\bseulement\b|\bexclusivement\b|\bn[e']\s*\S+\s+que\b/;

const hasNegation = (text: string): boolean => NEGATION_PATTERN.test(normalizeText(text));
const hasExclusivity = (text: string): boolean => EXCLUSIVITY_PATTERN.test(normalizeText(text));

const CORRECT_THRESHOLD = 1;
const PARTIAL_THRESHOLD = 0.5;

const listFrench = (words: string[]): string => words.join(', ');

/**
 * @param attempt        Ce que l'étudiant a écrit.
 * @param expectedAnswer La réponse de la carte.
 * @param question       La question de la carte, si disponible. Ce qu'elle
 *                       nomme déjà n'est pas exigé de l'étudiant : à
 *                       « Qu'est-ce que le nerf trijumeau ? », répondre
 *                       « il est sensitif et moteur » est une réponse
 *                       complète, pas une réponse à laquelle il manque
 *                       « nerf » et « trijumeau ».
 */
export function evaluateAnswer(
  attempt: string,
  expectedAnswer: string,
  question?: string,
): AnswerEvaluation {
  const trimmedAttempt = attempt.trim();
  if (trimmedAttempt.length === 0) return { verdict: 'indeterminate', explanation: null };
  if (UNKNOWN_ANSWER_PATTERN.test(normalizeText(trimmedAttempt))) {
    return { verdict: 'incorrect', explanation: 'Tu as indiqué ne pas connaître la réponse.' };
  }

  // ── Vrai/Faux : la réponse attendue est exactement « Vrai » ou « Faux ». ──
  const expectedBoolean = detectBooleanToken(expectedAnswer);
  if (expectedBoolean) {
    const attemptBoolean = detectBooleanToken(trimmedAttempt);
    if (!attemptBoolean) return { verdict: 'indeterminate', explanation: null };
    return attemptBoolean === expectedBoolean
      ? { verdict: 'correct', explanation: null }
      : { verdict: 'incorrect', explanation: null };
  }

  if (normalizeText(trimmedAttempt) === normalizeText(expectedAnswer)) {
    return { verdict: 'correct', explanation: null };
  }

  // ── Ce que l'étudiant doit réellement produire. ──
  const questionTerms = question ? significantWords(question) : new Set<string>();
  const expectedEntries = significantWordEntries(expectedAnswer);
  if (expectedEntries.length === 0) return { verdict: 'indeterminate', explanation: null };

  const requiredEntries = expectedEntries.filter((entry) => !questionTerms.has(entry.normalized));
  if (requiredEntries.length === 0) {
    // La réponse attendue n'ajoute aucun terme que la question ne donne déjà :
    // impossible de juger la réponse sur son contenu sans deviner.
    return { verdict: 'indeterminate', explanation: null };
  }

  const attemptTerms = significantWords(trimmedAttempt);
  const missing = requiredEntries.filter((entry) => !attemptTerms.has(entry.normalized));
  const coverage = (requiredEntries.length - missing.length) / requiredEntries.length;
  const missingWords = [...new Set(missing.map((entry) => entry.original.toLowerCase()))];

  // ── Contradictions : ce n'est pas « incomplet », c'est faux. ──
  // Une polarité inversée (l'un nie, l'autre affirme) change le sens de
  // l'énoncé, quel que soit le nombre de mots partagés.
  if (hasNegation(trimmedAttempt) !== hasNegation(expectedAnswer)) {
    return {
      verdict: 'incorrect',
      explanation: 'Ta réponse affirme le contraire de la réponse attendue.',
    };
  }

  // Une réponse qui se dit EXCLUSIVE tout en omettant une partie de la réponse
  // attendue exclut activement cette partie : elle est fausse, pas partielle.
  if (missing.length > 0 && hasExclusivity(trimmedAttempt)) {
    return {
      verdict: 'incorrect',
      explanation: `Ta réponse présente comme exclusif ce qui ne l’est pas : il manque ${listFrench(missingWords)}.`,
    };
  }

  if (coverage >= CORRECT_THRESHOLD) return { verdict: 'correct', explanation: null };

  if (coverage >= PARTIAL_THRESHOLD) {
    return {
      verdict: 'partial',
      explanation: `Une partie importante de la réponse est présente, mais il manque : ${listFrench(missingWords)}.`,
    };
  }

  return { verdict: 'incorrect', explanation: null };
}
