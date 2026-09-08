/**
 * Filtre qualité des extractions locales — le moteur à règles lit du texte
 * brut extrait d'un PDF, qui contient parfois des artefacts de mise en page
 * (numérotation de liste isolée « II », flèche de schéma « → », repère de
 * figure « C' »…). Sans ce filtre, ces artefacts peuvent se glisser dans le
 * SUJET ou la RÉPONSE d'un fait détecté et produire une carte du type
 * « Qu'est-ce que II ? » — vérifié comme un vrai cas d'usage signalé, pas
 * hypothétique.
 *
 * RÈGLE ABSOLUE : ce module ne répare JAMAIS un sujet/une réponse suspecte
 * en la complétant ou en la reformulant — il se contente de dire si le
 * fragment est exploitable ou non. Un sujet rejeté fait rejeter tout le
 * fait qui le porte (voir `relationExtraction.ts`) : mieux vaut une carte
 * de moins qu'une carte incompréhensible.
 */

const ROMAN_NUMERAL_ONLY = /^[ivxlcdm]+$/i;
const SINGLE_LETTER_LABEL = /^[a-z]['’]?$/i;

/**
 * Sujets ANAPHORIQUES — ils désignent quelque chose dit dans la phrase
 * PRÉCÉDENTE, qui n'existe plus une fois la carte isolée. « Son innervation
 * motrice est assurée par le nerf massétérique » donne une carte
 * « Qu'est-ce que Son innervation motrice ? » : l'étudiant n'a aucun moyen de
 * savoir de quoi on parle. Le sujet est donc rejeté, jamais complété — le
 * moteur n'a pas le droit de deviner l'antécédent.
 */
const ANAPHORIC_START =
  /^(?:il|elle|ils|elles|on|celui|celle|ceux|celles|cela|ça|ce|cet|cette|ces|son|sa|ses|leur|leurs|lui|y|en)\b/i;

/**
 * Un SUJET est un groupe nominal, jamais une proposition complète. Quand un
 * sujet contient l'un des verbes de relation, c'est que la capture a dérapé et
 * avalé toute la phrase : « Il se compose de deux faisceaux » comme sujet
 * produisait la carte « De quoi se compose Il se compose de deux faisceaux ? ».
 */
const CLAUSE_VERB =
  /\b(?:se compose de|est composée? de|est constituée? de|comprend|poss[èe]de|comporte|présente|dispose de|désigne|correspond à|représente|permet|assure|commande|contrôle|se situe|se trouve)\b/i;
/** Rien que des flèches/symboles de schéma et de la ponctuation — aucune lettre, aucun chiffre porteur de sens. */
const SYMBOLS_ONLY = /^[\s\-–—→←↔⇒⇔=>*•·.,;:()[\]{}'"’«»]*$/;

const stripLeadingArticle = (text: string): string =>
  text.replace(/^(?:l['’]|le\s+|la\s+|les\s+|un\s+|une\s+|des\s+|de\s+|du\s+)/i, '').trim();

/**
 * Un sujet est exploitable s'il contient au moins un vrai mot (suite de
 * lettres, accents compris, d'au moins 3 caractères) qui n'est pas
 * lui-même un chiffre romain isolé, et si les lettres dominent le texte
 * (pas un sujet majoritairement fait de chiffres/symboles).
 */
export function isPlausibleSubject(rawSubject: string): boolean {
  const trimmed = rawSubject.trim();
  // Testés sur le sujet BRUT : un article en tête est anodin et peut être
  // retiré, un pronom ou un verbe ne le sont pas.
  if (ANAPHORIC_START.test(trimmed)) return false;
  if (CLAUSE_VERB.test(trimmed)) return false;

  const subject = stripLeadingArticle(trimmed);
  if (subject.length === 0) return false;
  if (subject.length > 80) return false; // un « sujet » de deux lignes est une capture ratée, pas un terme.
  if (SYMBOLS_ONLY.test(subject)) return false;
  if (ROMAN_NUMERAL_ONLY.test(subject)) return false;
  if (SINGLE_LETTER_LABEL.test(subject)) return false;

  const words = subject.match(/[a-zà-ÿ]+/gi) ?? [];
  const hasRealWord = words.some((word) => word.length >= 3 && !ROMAN_NUMERAL_ONLY.test(word));
  if (!hasRealWord) return false;

  const letterCount = (subject.match(/[a-zà-ÿ]/gi) ?? []).length;
  return letterCount / subject.length >= 0.5;
}

/**
 * Une réponse est exploitable si elle porte au moins un vrai mot — sinon
 * elle ne permettrait de répondre à la question qu'en devinant le contexte
 * (ex. réponse réduite à un chiffre ou un symbole de schéma isolé).
 */
export function isPlausibleAnswerText(rawAnswer: string): boolean {
  const answer = rawAnswer.trim();
  if (answer.length === 0) return false;
  if (SYMBOLS_ONLY.test(answer)) return false;

  const words = answer.match(/[a-zà-ÿ]+/gi) ?? [];
  return words.some((word) => word.length >= 3 && !ROMAN_NUMERAL_ONLY.test(word));
}
