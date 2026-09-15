import { significantWords } from '@/core/text';

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1]! + 1, row[j]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}

/** Correct only a unique, one-edit course term, with another exact topic anchor.
 * Does not rewrite known terms, resolve ambiguous spellings or alter the student's message.
 */
export function correctCourseQuery(question: string, texts: readonly string[]): string {
  const vocabulary = new Set(texts.flatMap(text => [...significantWords(text, true)]));
  const queryTerms = [...significantWords(question, true)];
  if (!queryTerms.some(term => vocabulary.has(term))) return question;
  const replacements = new Map<string, string>();
  for (const term of queryTerms) {
    if (term.length < 3 || vocabulary.has(term)) continue;
    const matches = [...vocabulary].filter(word => Math.abs(word.length - term.length) <= 1 && distance(term, word) === 1);
    if (matches.length === 1) replacements.set(term, matches[0]!);
  }
  return question.replace(/[\p{L}\p{N}]+/gu, original => {
    const term = [...significantWords(original, true)][0];
    return term ? replacements.get(term) ?? original : original;
  });
}
