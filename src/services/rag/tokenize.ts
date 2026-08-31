/**
 * Normalisation et découpage en termes, calibrés pour du français médical.
 *
 * Trois choix délibérés :
 *  1. les accents sont retirés — « masséter » et « masseter » doivent
 *     correspondre, une faute de frappe ne doit pas faire rater un cours ;
 *  2. les mots outils français sont écartés — sans cela, « de », « la » et
 *     « les » dominent tous les scores de pertinence ;
 *  3. les termes de 2 caractères sont conservés (« V3 », « M1 », « pH ») —
 *     le prototype filtrait tout ce qui faisait moins de 4 lettres et perdait
 *     donc les nomenclatures dentaires.
 */

const STOPWORDS = new Set([
  'a', 'ai', 'au', 'aux', 'avec', 'ce', 'ces', 'cet', 'cette', 'dans', 'de', 'des', 'du', 'elle',
  'en', 'est', 'et', 'eux', 'il', 'ils', 'je', 'la', 'le', 'les', 'leur', 'lui', 'ma', 'mais',
  'me', 'meme', 'mes', 'moi', 'mon', 'ne', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'pas',
  'pour', 'qu', 'que', 'qui', 'sa', 'se', 'ses', 'son', 'sont', 'sur', 'ta', 'te', 'tes', 'toi',
  'ton', 'tu', 'un', 'une', 'vos', 'votre', 'vous', 'y', 'etre', 'avoir', 'plus', 'aussi',
  'comme', 'tout', 'tous', 'toute', 'toutes', 'entre', 'sans', 'sous', 'ainsi', 'donc', 'car',
  'dont', 'lors', 'apres', 'avant', 'chez', 'peut', 'cela', 'ils', 'nous',
]);

/** Minuscules + suppression des diacritiques. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Découpe en termes significatifs (lettres et chiffres, mots outils exclus). */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/** Fréquence de chaque terme, pré-calculée à l'indexation. */
export function termFrequencies(tokens: string[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const token of tokens) freq[token] = (freq[token] ?? 0) + 1;
  return freq;
}
