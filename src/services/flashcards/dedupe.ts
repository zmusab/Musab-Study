import { comparisonKey, significantWords } from '@/core/text';

/** Normalisation partagée — voir `core/text`, une seule définition pour tout le projet. */
const normalizeQuestion = comparisonKey;

/**
 * Recouvrement exigé entre les mots PORTEURS DE SENS de deux questions pour
 * les tenir pour une seule. Au-dessus, ce sont deux formulations de la même
 * question ; en dessous, deux questions différentes.
 */
const OVERLAP_THRESHOLD = 0.7;

/**
 * Vrai si `question` reformule, mot pour mot ou presque, une question déjà
 * posée — jamais une vraie compréhension sémantique, seulement un filet de
 * sécurité bon marché à base de recouvrement de vocabulaire. Partagé entre
 * la génération IA (`services/flashcards/generate.ts`), le moteur local
 * (`services/local/localFlashcards.ts`) et l'import de fichiers
 * (`services/flashcards/importFile.ts`) — la même règle s'applique quelle que
 * soit la source des propositions.
 *
 * LE RECOUVREMENT SE MESURE SUR LES MOTS PORTEURS DE SENS, jamais sur tous
 * les mots. Compter les mots outils écrasait les questions courtes, qui sont
 * justement les plus nombreuses dans un jeu de cartes :
 *
 *   « Qu'est-ce que le parodonte ? »  →  qu est ce que le parodonte
 *   « Qu'est-ce que le sulcus ? »     →  qu est ce que le sulcus
 *
 * Cinq mots sur sept en commun : 0,71, donc « doublon » — alors que ces deux
 * cartes portent sur deux notions différentes, et que la seconde disparaissait
 * silencieusement. Sur les seuls mots porteurs (`parodonte` contre `sulcus`),
 * le recouvrement est nul et les deux cartes sont conservées.
 *
 * L'égalité EXACTE des libellés normalisés reste testée en premier et
 * indépendamment : deux questions identiques sont des doublons même quand
 * elles ne contiennent aucun mot porteur (« Et après ? »).
 */
export function isDuplicateQuestion(question: string, existingQuestions: readonly string[]): boolean {
  const normalized = normalizeQuestion(question);
  if (normalized.length === 0) return false;
  const words = significantWords(question, true);

  return existingQuestions.some((existing) => {
    if (normalizeQuestion(existing) === normalized) return true;

    // Sans aucun mot porteur d'un côté ou de l'autre, il n'y a rien à
    // comparer : on s'en tient à l'égalité exacte, déjà écartée ci-dessus.
    if (words.size === 0) return false;
    const existingWords = significantWords(existing, true);
    if (existingWords.size === 0) return false;

    const intersection = [...words].filter((w) => existingWords.has(w)).length;
    const union = new Set([...words, ...existingWords]).size;
    return union > 0 && intersection / union >= OVERLAP_THRESHOLD;
  });
}
