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

import { FRENCH_STOPWORDS, normalizeText } from '@/core/text';

/**
 * La liste de mots outils et la normalisation viennent désormais de
 * `core/text` — une seule définition pour tout le projet. Le découpage
 * ci-dessous reste PROPRE à l'indexation : aucune singularisation (l'index
 * garde la forme réellement écrite dans le cours) et un seuil à 2 caractères.
 */

/** Minuscules + suppression des diacritiques. */
export const normalize = normalizeText;

/** Découpe en termes significatifs (lettres et chiffres, mots outils exclus). */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !FRENCH_STOPWORDS.has(token));
}

/** Fréquence de chaque terme, pré-calculée à l'indexation. */
export function termFrequencies(tokens: string[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const token of tokens) freq[token] = (freq[token] ?? 0) + 1;
  return freq;
}
