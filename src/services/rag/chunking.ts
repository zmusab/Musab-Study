import { termFrequencies, tokenize } from '@/services/rag/tokenize';
import { pageAtOffset } from '@/services/pdf/pages';

/**
 * Découpage d'un document en fragments récupérables.
 *
 * Le prototype envoyait 16 000 caractères bruts des documents les mieux notés.
 * Ici, on découpe en fragments de taille bornée avec recouvrement, ce qui
 * permet de citer précisément un passage — et donc de vérifier une réponse.
 *
 * Le découpage suit les frontières de paragraphes puis de phrases : couper au
 * milieu d'une définition anatomique la rendrait inutilisable.
 */

export const TARGET_CHUNK_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 150;
const MIN_CHUNK_CHARS = 80;

export interface ChunkDraft {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  pageStart: number | null;
  pageEnd: number | null;
  termFreq: Record<string, number>;
  tokenCount: number;
}


/** Segments de texte alignés sur les paragraphes, puis les phrases si besoin. */
function splitIntoSegments(text: string): { text: string; start: number }[] {
  const segments: { text: string; start: number }[] = [];
  const paragraphRegex = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;

  for (const match of text.matchAll(paragraphRegex)) {
    const paragraph = match[0];
    const start = match.index;
    if (paragraph.length <= TARGET_CHUNK_CHARS) {
      segments.push({ text: paragraph, start });
      continue;
    }
    // Paragraphe trop long (fréquent avec du texte extrait de PDF) :
    // on redescend au niveau de la phrase.
    const sentenceRegex = /[^.!?]+(?:[.!?]+|$)/g;
    for (const sentence of paragraph.matchAll(sentenceRegex)) {
      if (sentence[0].trim().length === 0) continue;
      segments.push({ text: sentence[0], start: start + sentence.index });
    }
  }

  return segments;
}

/**
 * Le recouvrement entre deux fragments reprenait les 150 DERNIERS CARACTÈRES
 * du fragment précédent, donc presque toujours en plein milieu d'une phrase,
 * souvent d'un mot. Ce début tronqué devenait ensuite une « phrase » à part
 * entière pour le moteur local, qui pouvait la citer telle quelle dans une
 * réponse — d'où des extraits qui commencent ou s'arrêtent au milieu de rien.
 *
 * On avance donc jusqu'à la première frontière propre : début de phrase de
 * préférence, début de mot à défaut. Le recouvrement reste un filet pour les
 * notions à cheval sur deux fragments ; il n'a pas besoin d'être exactement
 * de 150 caractères.
 */
function trimOverlapToBoundary(overlap: string): string {
  const sentenceStart = overlap.search(/(?<=[.!?:;]\s)\S/);
  if (sentenceStart > 0) return overlap.slice(sentenceStart);
  const firstSpace = overlap.indexOf(' ');
  return firstSpace >= 0 ? overlap.slice(firstSpace + 1) : overlap;
}

/**
 * @param pageOffsets Offsets de début de page (voir `ExtractedPdf.pageOffsets`).
 *   Omis pour un document sans pagination (`source: 'paste'`) : les chunks
 *   produits ont alors `pageStart`/`pageEnd` à `null`.
 */
export function chunkDocument(text: string, pageOffsets: number[] = []): ChunkDraft[] {
  if (text.trim().length === 0) return [];

  const segments = splitIntoSegments(text);
  const chunks: ChunkDraft[] = [];

  let buffer = '';
  let bufferStart = segments[0]?.start ?? 0;

  const flush = (end: number) => {
    const trimmed = buffer.trim();
    if (trimmed.length < MIN_CHUNK_CHARS && chunks.length > 0) return;
    if (trimmed.length === 0) return;
    const tokens = tokenize(trimmed);
    chunks.push({
      index: chunks.length,
      text: trimmed,
      charStart: bufferStart,
      charEnd: end,
      pageStart: pageOffsets.length > 0 ? pageAtOffset(bufferStart, pageOffsets) : null,
      pageEnd: pageOffsets.length > 0 ? pageAtOffset(Math.max(bufferStart, end - 1), pageOffsets) : null,
      termFreq: termFrequencies(tokens),
      tokenCount: tokens.length,
    });
  };

  for (const segment of segments) {
    const candidate = buffer.length === 0 ? segment.text : `${buffer}\n${segment.text}`;

    if (candidate.length > TARGET_CHUNK_CHARS && buffer.length > 0) {
      flush(bufferStart + buffer.length);
      // Recouvrement : on reprend la fin du fragment précédent pour qu'une
      // notion à cheval sur deux fragments reste retrouvable.
      const overlap = trimOverlapToBoundary(buffer.slice(-CHUNK_OVERLAP_CHARS));
      bufferStart = segment.start - overlap.length;
      buffer = `${overlap}\n${segment.text}`;
    } else {
      if (buffer.length === 0) bufferStart = segment.start;
      buffer = candidate;
    }
  }

  if (buffer.trim().length > 0) flush(bufferStart + buffer.length);

  return chunks;
}
