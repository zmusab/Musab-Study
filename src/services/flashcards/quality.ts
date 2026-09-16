import { comparisonKey } from '@/core/text';
import type { Flashcard } from '@/types';

export type CardQualityStatus = 'valid' | 'suspect' | 'unmapped' | 'needs-review';

export interface CardQuality {
  cardId: string;
  status: CardQualityStatus;
  reasons: string[];
}

const FRAGMENT = /^(?:[ivxlcdm]+|[→➔⇒•\-]+|c['’]?|composé?e?\s+(?:par|de))$/i;
const BROKEN_QUESTION = /^(?:qu.?est.ce que|de quoi se compose|quel(?:le)?s? sont)\s*(?:[ivxlcdm]+|[→➔⇒•\-]+)\s*\?*$/i;

/**
 * Audit non destructif de la bibliothèque. Une carte n'est jamais supprimée
 * ni modifiée ici ; l'étudiant décide ensuite de la conserver, corriger,
 * régénérer ou supprimer.
 */
export function analyzeCardQuality(cards: readonly Flashcard[]): CardQuality[] {
  const questionCounts = new Map<string, number>();
  for (const card of cards) {
    const key = comparisonKey(card.question);
    if (key) questionCounts.set(key, (questionCounts.get(key) ?? 0) + 1);
  }
  return cards.map((card) => {
    if (card.qualityReviewedAt) return { cardId: card.id, status: 'valid', reasons: [] };
    const question = card.question.trim();
    const answer = card.answer.trim();
    const reasons: string[] = [];
    if (question.length < 8 || BROKEN_QUESTION.test(question)) reasons.push('question fragmentaire ou sans sujet');
    if (answer.length < 2 || FRAGMENT.test(answer)) reasons.push('réponse incomplète ou parasite');
    if ((questionCounts.get(comparisonKey(question)) ?? 0) > 1) reasons.push('question dupliquée dans la bibliothèque');
    if (card.origin !== 'manual' && card.sourceChunkIds.length === 0) reasons.push('source de cours absente');
    if (reasons.length > 0) {
      const critical = reasons.some((reason) => /fragmentaire|incomplète/.test(reason));
      return { cardId: card.id, status: critical ? 'suspect' : 'needs-review', reasons };
    }
    if ((card.knowledgeFactIds?.length ?? 0) === 0 && card.origin !== 'manual') {
      return { cardId: card.id, status: 'unmapped', reasons: ['pas encore reliée à un fait vérifié'] };
    }
    return { cardId: card.id, status: 'valid', reasons: [] };
  });
}
