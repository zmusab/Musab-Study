import { normalizeText, significantWords } from '@/core/text';
import { splitIntoSentences, stripBulletPrefix } from './textStructure';
import { citationFromChunk } from './citation';
import type { LocalAnswer } from './localAnswer';
import type { ContextLookup, ScoredChunk } from '@/services/rag/retrieval';

/** Deliberately narrow: explicit affirmative transit statements only, never proximity. */
export function answerPassageQuestion(question: string, chunks: ScoredChunk[], lookup: ContextLookup): LocalAnswer | null {
  const q = normalizeText(question);
  const query = q.match(/^(?:quels?|quelles?)\s+(nerfs?|arteres?|veines?|structures?)\s+(?:passe(?:nt)?|traverse(?:nt)?|chemine(?:nt)?)\s+(?:par|dans|a travers)?\s*(.+?)[?!.]*$/);
  if (!query) return null;
  const target = significantWords(query[2]!);
  if (!target.size || /\b(?:ici|endroit|cet|cette)\b/.test(query[2]!)) {
    return { text: 'Quel passage anatomique veux-tu étudier ? Donne son nom pour que je puisse identifier les structures qui le traversent.', citations: [] };
  }
  const kind = query[1]!.replace(/s$/, '');
  const matches: { name: string; excerpt: string; source: ScoredChunk }[] = [];
  const seen = new Set<string>();
  for (const source of chunks) {
    for (const sentence of splitIntoSentences(source.chunk.text)) {
      const clean = stripBulletPrefix(sentence).trim();
      const normalized = normalizeText(clean);
      // An exact quote alone is not enough: reject negation, exceptions and conditional claims.
      if (/\b(?:ne|non|pas|jamais|sans|sauf|hormis|parfois|peut|peuvent|si|mais|generalement|souvent)\b|n['’]|exception|contrairement/.test(normalized)) continue;
      const relation = clean.match(/^((?:Le|La|Les|L['’])\s*[^.!?;:]{2,85}?)\s+(?:traverse(?:nt)?|passe(?:nt)?\s+par|chemine(?:nt)?\s+(?:par|dans))\s+([^.!?;]{3,150})[.!]?$/i);
      if (!relation) continue;
      const name = relation[1]!;
      const subject = normalizeText(name);
      if (kind !== 'structure' && !subject.split(/\s+/).some(word => word === kind || word === `${kind}s`)) continue;
      const object = significantWords(relation[2]!);
      if (target.size !== object.size || ![...target].every(word => object.has(word))) continue;
      const key = normalizeText(clean);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ name, excerpt: clean, source });
    }
  }
  if (!matches.length) return null;
  return {
    text: '### Structures identifiées dans les passages retrouvés\n\n' + matches.map(m => `- **${m.name}**${m.excerpt.slice(m.name.length)}`).join('\n'),
    citations: matches.map(m => citationFromChunk(m.source.chunk, lookup, m.excerpt)),
  };
}
