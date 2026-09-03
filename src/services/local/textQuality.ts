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
  const subject = stripLeadingArticle(rawSubject.trim());
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
