import { normalize } from '@/services/rag/tokenize';
import { bestWordMatch, looseWords } from './fuzzy';

export type SearchItemKind =
  | 'subject'
  | 'chapter'
  | 'document'
  | 'note'
  | 'flashcard'
  | 'quiz'
  | 'podcast'
  | 'anatomy'
  | 'calendar';

/** Une entité indexée pour la recherche, quelle que soit sa provenance. */
export interface SearchableItem {
  id: string;
  kind: SearchItemKind;
  title: string;
  /** Fil d'Ariane affiché sous le titre, ex. « Anatomie › Muscles ». */
  subtitle: string;
  /** Texte long dans lequel chercher (contenu du document, réponse de la carte…). */
  body?: string;
  to: string;
}

export interface SearchResult extends SearchableItem {
  score: number;
  /** Extrait du corps autour de la correspondance, pour donner du contexte. */
  excerpt?: string;
}

const TITLE_WEIGHT = 42;
const SUBTITLE_WEIGHT = 12;
const TITLE_EXACT_PHRASE_BONUS = 30;
/** Par mot de la requête retrouvé dans le corps — voir searchItems() pour pourquoi ce n'est plus juste une phrase entière. */
const BODY_WORD_WEIGHT = 9;
/** En plus du score par mot, quand la phrase complète apparaît telle quelle : le cas le plus net. */
const BODY_PHRASE_BONUS = 22;
/** Répéter un mot 20 fois dans un document ne doit pas dominer le score face à un document qui le cite une fois avec pertinence. */
const MAX_BODY_WORD_OCCURRENCES = 3;
/** Récompense la couverture : un document qui touche 3 des 3 mots de la requête doit passer devant un autre qui n'en touche qu'un. */
const COVERAGE_BONUS = 16;

/** Fréquence de chaque mot — un `Map` plutôt qu'un objet, pour ne rien devoir aux clés spéciales de JS (`__proto__` et consorts). */
function wordFrequencies(words: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const word of words) freq.set(word, (freq.get(word) ?? 0) + 1);
  return freq;
}

/** Extrait de texte autour d'un point d'ancrage (résultat d'`indexOf`), pour donner du contexte visuellement. */
function excerptAround(text: string, anchorIndex: number, anchorLength: number, radius = 70): string {
  const start = Math.max(0, anchorIndex - radius);
  const end = Math.min(text.length, anchorIndex + anchorLength + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Classe les entités par pertinence approximative face à une requête.
 *
 * Le corps (contenu d'un document de cours, réponse d'une carte…) est noté
 * MOT PAR MOT plutôt que par phrase exacte : un cours rédigé en prose ne
 * contient presque jamais la question de l'utilisateur telle quelle. Une
 * recherche « nerf trijumeau branches » doit retrouver un passage qui parle
 * du nerf trijumeau et de ses branches même si ces mots n'apparaissent pas
 * consécutifs et dans cet ordre — c'est précisément ce que ratait la
 * version précédente, qui n'acceptait qu'une sous-chaîne exacte complète.
 *
 * La comparaison mot à mot du corps reste volontairement EXACTE (pas de
 * distance d'édition comme pour le titre) : la tolérance aux fautes de
 * frappe importe surtout sur des champs courts, et l'appliquer mot à mot à
 * un document entier coûterait cher pour un gain marginal — voir fuzzy.ts.
 *
 * Fonction pure — aucun accès à la base ici, ce qui la rend testable sans
 * IndexedDB. `buildSearchIndex` (ci-dessous) fait le pont avec les données
 * réelles.
 */
export function searchItems(items: SearchableItem[], query: string, limit = 40): SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const queryWords = looseWords(trimmed);
  if (queryWords.length === 0) return [];

  const normalizedQuery = normalize(trimmed);
  const results: SearchResult[] = [];

  for (const item of items) {
    const titleWords = looseWords(item.title);
    const subtitleWords = looseWords(item.subtitle);
    const normalizedBody = item.body ? normalize(item.body) : '';
    const bodyWordFreq = item.body ? wordFrequencies(looseWords(item.body)) : null;

    let score = 0;
    let matched = false;
    const coveredWords = new Set<string>();
    let firstBodyMatch: { index: number; length: number } | null = null;

    for (const queryWord of queryWords) {
      const titleScore = bestWordMatch(queryWord, titleWords);
      const subtitleScore = bestWordMatch(queryWord, subtitleWords);
      if (titleScore > 0) coveredWords.add(queryWord);
      if (subtitleScore > 0) coveredWords.add(queryWord);
      score += titleScore * TITLE_WEIGHT + subtitleScore * SUBTITLE_WEIGHT;

      const bodyFreq = bodyWordFreq?.get(queryWord) ?? 0;
      if (bodyFreq > 0) {
        coveredWords.add(queryWord);
        score += Math.min(bodyFreq, MAX_BODY_WORD_OCCURRENCES) * BODY_WORD_WEIGHT;
        if (!firstBodyMatch) {
          const index = normalizedBody.indexOf(queryWord);
          if (index !== -1) firstBodyMatch = { index, length: queryWord.length };
        }
      }
    }
    matched = coveredWords.size > 0;

    // Une phrase complète retrouvée telle quelle passe devant tout le
    // reste — c'est le cas le plus évident, il doit gagner.
    if (normalize(item.title).includes(normalizedQuery)) score += TITLE_EXACT_PHRASE_BONUS;

    let excerpt: string | undefined;
    const phraseIndex = normalizedBody.length > 0 ? normalizedBody.indexOf(normalizedQuery) : -1;
    if (phraseIndex !== -1) {
      score += BODY_PHRASE_BONUS;
      excerpt = excerptAround(item.body!, phraseIndex, normalizedQuery.length);
    } else if (firstBodyMatch) {
      excerpt = excerptAround(item.body!, firstBodyMatch.index, firstBodyMatch.length);
    }

    if (matched) score += (coveredWords.size / queryWords.length) * COVERAGE_BONUS;

    if (matched && score > 0) {
      results.push({ ...item, score, excerpt });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
