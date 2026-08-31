import { normalize } from '@/services/rag/tokenize';

/**
 * Correspondance approximative — c'est le cœur de « l'approximation » demandée
 * pour la recherche : une faute de frappe sur un terme court (« masster » au
 * lieu de « masséter ») doit quand même retrouver la bonne carte ou le bon
 * document, pas seulement une correspondance exacte.
 *
 * Appliquée aux champs COURTS (titres, questions) — pas au corps des longs
 * documents, où la distance d'édition mot à mot deviendrait coûteuse pour un
 * gain marginal. Le corps est comparé en sous-chaîne normalisée (accents et
 * casse ignorés), déjà largement suffisant sur un texte de cours.
 */

/** Distance de Levenshtein — nombre minimal d'éditions pour passer de a à b. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i += 1) {
    const currentRow = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const insertCost = currentRow[j]! + 1;
      const deleteCost = previousRow[j + 1]! + 1;
      const substituteCost = previousRow[j]! + (a[i] === b[j] ? 0 : 1);
      currentRow.push(Math.min(insertCost, deleteCost, substituteCost));
    }
    previousRow = currentRow;
  }

  return previousRow[b.length]!;
}

/**
 * Similarité entre 0 (aucun rapport) et 1 (identique), tolérante aux fautes
 * de frappe proportionnellement à la longueur du mot : un mot de 3 lettres
 * tolère une faute, un mot de 8 lettres en tolère deux.
 */
export function wordSimilarity(query: string, target: string): number {
  if (query.length === 0 || target.length === 0) return 0;
  if (query === target) return 1;
  if (target.includes(query) || query.includes(target)) {
    return 0.85 * (Math.min(query.length, target.length) / Math.max(query.length, target.length) + 0.4);
  }

  const maxLen = Math.max(query.length, target.length);
  const allowedDistance = query.length <= 4 ? 1 : query.length <= 7 ? 2 : 3;
  const distance = levenshteinDistance(query, target);
  if (distance > allowedDistance) return 0;

  return Math.max(0, 1 - distance / maxLen);
}

/**
 * Découpage léger, sans filtrage de mots outils : une recherche accepte des
 * mots courts (« V3 », « M1 »). Le seuil de 2 caractères écarte seulement les
 * résidus d'élision française (« l'innervation » → « l », « innervation ») —
 * sans lui, ces fragments d'une lettre correspondent par inclusion triviale à
 * n'importe quel mot de la requête qui contient cette même lettre.
 */
export function looseWords(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2);
}

/** Meilleure similarité d'un mot de requête contre l'ensemble des mots d'une cible. */
export function bestWordMatch(queryWord: string, targetWords: string[]): number {
  let best = 0;
  for (const word of targetWords) {
    const score = wordSimilarity(queryWord, word);
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}
