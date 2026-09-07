/**
 * COMPARAISON DE TEXTE — une seule définition pour tout le projet.
 *
 * Avant ce module, six implémentations indépendantes répondaient à la même
 * question (« ces deux textes parlent-ils de la même chose ? ») avec des
 * règles différentes : `rag/tokenize`, `flashcards/dedupe`,
 * `local/localAnswer`, `local/localNotions`, `core/quiz` et
 * `core/revisions/evaluateAnswer`. Ce n'était pas qu'inélégant, c'était
 * FAUX : `localAnswer` écartait correctement « est » comme mot outil,
 * pendant que `evaluateAnswer` l'exigeait comme du contenu obligatoire et
 * reprochait à l'étudiant de l'avoir omis.
 *
 * DEUX JEUX DE MOTS OUTILS, volontairement distincts :
 *  - `FRENCH_STOPWORDS` — le socle. Sa composition est FIGÉE : elle alimente
 *    `rag/tokenize`, dont la sortie est PERSISTÉE dans `chunk.termFreq`.
 *    Y ajouter un mot rendrait les index déjà écrits incohérents avec les
 *    requêtes suivantes, sans qu'aucun test ne le voie.
 *  - `QUESTION_WORDS` — la formulation d'une question (« c'est quoi »,
 *    « je ne comprends pas », « explique-moi »). Ces mots ne disent rien du
 *    SUJET cherché : les écarter est ce qui permet d'isoler le terme
 *    réellement distinctif (« Willis » dans « c'est quoi les nerfs de
 *    Willis ? »). Séparés du socle parce qu'ils ne concernent QUE
 *    l'interprétation d'une question, jamais l'indexation d'un cours.
 */

/**
 * Mots outils français. NE PAS MODIFIER sans migration de l'index : voir
 * l'avertissement en tête de fichier.
 */
export const FRENCH_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'ai', 'au', 'aux', 'avec', 'ce', 'ces', 'cet', 'cette', 'dans', 'de', 'des', 'du', 'elle',
  'en', 'est', 'et', 'eux', 'il', 'ils', 'je', 'la', 'le', 'les', 'leur', 'lui', 'ma', 'mais',
  'me', 'meme', 'mes', 'moi', 'mon', 'ne', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'pas',
  'pour', 'qu', 'que', 'qui', 'sa', 'se', 'ses', 'son', 'sont', 'sur', 'ta', 'te', 'tes', 'toi',
  'ton', 'tu', 'un', 'une', 'vos', 'votre', 'vous', 'y', 'etre', 'avoir', 'plus', 'aussi',
  'comme', 'tout', 'tous', 'toute', 'toutes', 'entre', 'sans', 'sous', 'ainsi', 'donc', 'car',
  'dont', 'lors', 'apres', 'avant', 'chez', 'peut', 'cela', 'ils', 'nous',
]);

/**
 * Tournures de question — à écarter EN PLUS du socle quand on cherche de quoi
 * parle une question. « Explique-moi le nerf trijumeau » et « nerf trijumeau »
 * portent la même demande.
 */
export const QUESTION_WORDS: ReadonlySet<string> = new Set([
  // Interrogatifs et verbes de demande.
  'quoi', 'quel', 'quelle', 'quels', 'quelles', 'comment', 'pourquoi', 'combien', 'ceci', 'celui',
  'comprends', 'comprend', 'comprendre', 'explique', 'expliquer', 'expliques', 'explication',
  'dis', 'dire', 'donne', 'donner', 'parle', 'parler', 'sais', 'savoir', 'veux', 'vouloir',
  'peux', 'pouvoir', 'aide', 'aider', 'signifie', 'signifier', 'definition', 'definir',
  'elles', 'quest', 'cest', 'sert', 'servent', 'servir', 'fait', 'faire',
  // Politesse et adverbes de remplissage. Leur place ici est ce qui permet à
  // `localAnswer` de traiter TOUT autre terme absent du cours comme un vrai
  // signal d'abstention : sans cette liste, « explique-moi RAPIDEMENT le nerf
  // trijumeau » ferait abstenir le moteur parce que « rapidement » n'est pas
  // dans le cours.
  'stp', 'svp', 'merci', 'please', 'rapidement', 'simplement', 'vraiment', 'exactement',
  'precisement', 'brievement', 'clairement', 'facilement', 'vite', 'petit', 'peu', 'bien',
  'court', 'courte', 'resume', 'resumer', 'detail', 'details', 'detaille',
]);

/** Minuscules + suppression des diacritiques. « masséter » et « masseter » se correspondent. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Retrait de pluriel volontairement grossier (« nerfs » → « nerf ») : ce
 * n'est PAS une lemmatisation, et ça ne prétend pas l'être. Suffisant pour
 * que le pluriel d'un terme anatomique ne fasse pas rater une correspondance.
 */
export function singularize(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

/**
 * Clé de comparaison d'un texte court : minuscules, sans accents, sans
 * ponctuation, espaces normalisés. Sert à décider si deux libellés désignent
 * la même chose (dédoublonnage de questions de flashcards, regroupement de
 * notions sous un même sujet). Les mots outils sont CONSERVÉS : sur un
 * libellé court, ils font partie de l'identité du texte.
 */
export function comparisonKey(text: string): string {
  return normalizeText(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Longueur minimale d'un terme retenu. 2 et non 3, délibérément : la
 * nomenclature dentaire tient en deux caractères (« V3 », « M1 », « pH ») et
 * un seuil à 3 la perdrait entièrement.
 */
const MIN_TERM_LENGTH = 2;

export interface WordEntry {
  /** Forme telle qu'écrite dans le texte source — pour l'affichage, jamais pour la comparaison. */
  original: string;
  /** Forme normalisée et singularisée — la seule utilisée pour comparer. */
  normalized: string;
}

/**
 * Mots porteurs de sens d'un texte, casse d'origine conservée.
 *
 * `dropQuestionWords` écarte en plus les tournures interrogatives : à activer
 * pour interpréter une QUESTION, jamais pour analyser un contenu de cours.
 */
export function significantWordEntries(text: string, dropQuestionWords = false): WordEntry[] {
  const matches = text.match(/[a-zà-ÿ0-9]+/gi) ?? [];
  const entries: WordEntry[] = [];
  for (const original of matches) {
    const normalized = singularize(normalizeText(original));
    if (normalized.length < MIN_TERM_LENGTH) continue;
    if (FRENCH_STOPWORDS.has(normalized)) continue;
    if (dropQuestionWords && QUESTION_WORDS.has(normalized)) continue;
    entries.push({ original, normalized });
  }
  return entries;
}

/** Mêmes mots que `significantWordEntries`, dédoublonnés, sans la casse d'origine. */
export function significantWords(text: string, dropQuestionWords = false): Set<string> {
  return new Set(significantWordEntries(text, dropQuestionWords).map((entry) => entry.normalized));
}
