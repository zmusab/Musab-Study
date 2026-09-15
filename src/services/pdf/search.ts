import { normalize } from '@/services/rag/tokenize';
import { pageAtOffset } from './pages';

export interface PdfSearchMatch {
  page: number;
  /** Offset dans le texte du document, pour désambiguïser plusieurs correspondances sur une même page. */
  charOffset: number;
  excerpt: string;
}

const EXCERPT_RADIUS = 60;

/**
 * Recherche « dans le PDF » — sous-chaîne normalisée (accents et casse
 * ignorés), pas approximative comme la recherche globale du site : ouvrir un
 * document pour y retrouver un terme exact doit rester prévisible.
 */
export function searchDocumentText(
  text: string,
  pageOffsets: number[],
  query: string,
  limit = 50,
): PdfSearchMatch[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const normalizedText = normalize(text);
  const normalizedQuery = normalize(trimmed);
  const matches: PdfSearchMatch[] = [];

  let from = 0;
  while (matches.length < limit) {
    const index = normalizedText.indexOf(normalizedQuery, from);
    if (index === -1) break;

    const start = Math.max(0, index - EXCERPT_RADIUS);
    const end = Math.min(text.length, index + normalizedQuery.length + EXCERPT_RADIUS);
    matches.push({
      page: pageAtOffset(index, pageOffsets),
      charOffset: index,
      excerpt: `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`,
    });

    from = index + normalizedQuery.length;
  }

  return matches;
}
