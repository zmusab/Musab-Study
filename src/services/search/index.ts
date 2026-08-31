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
const BODY_SUBSTRING_SCORE = 24;
const TITLE_EXACT_PHRASE_BONUS = 30;

/** Extrait de texte autour de la première correspondance, pour donner du contexte visuellement. */
function excerptAround(text: string, normalizedQuery: string, radius = 70): string {
  const normalizedText = normalize(text);
  const index = normalizedText.indexOf(normalizedQuery);
  if (index === -1) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + normalizedQuery.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Classe les entités par pertinence approximative face à une requête.
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

    let score = 0;
    let matched = false;

    for (const queryWord of queryWords) {
      const titleScore = bestWordMatch(queryWord, titleWords);
      const subtitleScore = bestWordMatch(queryWord, subtitleWords);
      if (titleScore > 0) matched = true;
      if (subtitleScore > 0) matched = true;
      score += titleScore * TITLE_WEIGHT + subtitleScore * SUBTITLE_WEIGHT;
    }

    // Une phrase complète retrouvée telle quelle dans le titre passe devant
    // tout le reste — c'est le cas le plus évident, il doit gagner.
    if (normalize(item.title).includes(normalizedQuery)) score += TITLE_EXACT_PHRASE_BONUS;

    let excerpt: string | undefined;
    if (normalizedBody.length > 0 && normalizedBody.includes(normalizedQuery)) {
      score += BODY_SUBSTRING_SCORE;
      matched = true;
      excerpt = excerptAround(item.body!, normalizedQuery);
    }

    if (matched && score > 0) {
      results.push({ ...item, score, excerpt });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
