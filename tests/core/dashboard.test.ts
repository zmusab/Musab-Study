import { describe, it, expect } from 'vitest';
import {
  triageDueCards,
  averageElapsedMs,
  estimateSessionMinutes,
  computeWeakConcepts,
  computeGreeting,
  computeDailySummary,
} from '@/core/dashboard';
import { MIN_EASE, MAX_EASE, DEFAULT_EASE } from '@/core/srs';
import type { Flashcard, ReviewLog } from '@/types';

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: overrides.id ?? 'crd-1',
    subjectId: 's1',
    chapterId: null,
    question: 'Question ?',
    answer: 'Réponse.',
    importance: 2,
    difficulty: 2,
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: new Date().toISOString(),
    lastReview: null,
    origin: 'manual',
    sourceChunkIds: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeLog(overrides: Partial<ReviewLog> = {}): ReviewLog {
  return {
    id: overrides.id ?? 'rev-1',
    subjectId: 's1',
    chapterId: null,
    itemId: 'crd-1',
    itemKind: 'card',
    at: new Date().toISOString(),
    day: new Date().toISOString().slice(0, 10),
    correct: true,
    rating: 2,
    confidence: 'medium',
    elapsedMs: 5000,
    ...overrides,
  };
}

describe('triageDueCards', () => {
  it('classe par niveau de maîtrise réel (SM-2)', () => {
    const veryWeak = makeCard({ id: 'a', ease: MIN_EASE, interval: 0, reps: 0 });
    const strong = makeCard({ id: 'b', ease: MAX_EASE, interval: 90, reps: 10 });
    const triage = triageDueCards([veryWeak, strong]);
    expect(triage.total).toBe(2);
    expect(triage.atRisk + triage.difficult + triage.normal).toBe(2);
  });

  it('ne produit rien pour une liste vide', () => {
    expect(triageDueCards([])).toEqual({ atRisk: 0, difficult: 0, normal: 0, total: 0 });
  });
});

describe('averageElapsedMs', () => {
  it('renvoie null sans historique — jamais 0 déguisé en mesure', () => {
    expect(averageElapsedMs([])).toBeNull();
  });

  it('moyenne les temps réels', () => {
    expect(averageElapsedMs([{ elapsedMs: 1000 }, { elapsedMs: 3000 }])).toBe(2000);
  });
});

describe('estimateSessionMinutes', () => {
  it('vaut 0 sans carte', () => {
    expect(estimateSessionMinutes(0, 5000)).toBe(0);
  });

  it('utilise le temps moyen réel quand il existe', () => {
    // 10 cartes à 60s chacune = 10 minutes.
    expect(estimateSessionMinutes(10, 60_000)).toBe(10);
  });

  it('retombe sur une estimation par défaut sans historique', () => {
    expect(estimateSessionMinutes(10, null)).toBeGreaterThan(0);
  });
});

describe('computeWeakConcepts', () => {
  it('signale une carte oubliée à la dernière révision', () => {
    const card = makeCard({ id: 'a', question: 'Nerf facial' });
    const logs = [makeLog({ itemId: 'a', correct: false, rating: 0, at: '2026-01-01T10:00:00.000Z' })];
    const weak = computeWeakConcepts([card], logs, new Date('2026-01-02T00:00:00.000Z'));
    expect(weak).toHaveLength(1);
    expect(weak[0]!.reason).toContain('Oublié');
  });

  it('signale plusieurs erreurs récentes même si la dernière est réussie', () => {
    const card = makeCard({ id: 'a', question: 'Muscle masséter' });
    const now = new Date('2026-01-10T00:00:00.000Z');
    const logs = [
      makeLog({ itemId: 'a', correct: false, rating: 0, at: '2026-01-05T10:00:00.000Z' }),
      makeLog({ itemId: 'a', correct: false, rating: 0, at: '2026-01-07T10:00:00.000Z' }),
      makeLog({ itemId: 'a', correct: true, rating: 2, confidence: 'high', at: '2026-01-09T10:00:00.000Z' }),
    ];
    const weak = computeWeakConcepts([card], logs, now);
    expect(weak).toHaveLength(1);
    expect(weak[0]!.reason).toContain('erreurs cette semaine');
  });

  it('signale des réussites répétées mais hésitantes', () => {
    const card = makeCard({ id: 'a' });
    const logs = [
      makeLog({ itemId: 'a', correct: true, rating: 2, confidence: 'low', at: '2026-01-08T10:00:00.000Z' }),
      makeLog({ itemId: 'a', correct: true, rating: 2, confidence: 'low', at: '2026-01-09T10:00:00.000Z' }),
    ];
    const weak = computeWeakConcepts([card], logs, new Date('2026-01-10T00:00:00.000Z'));
    expect(weak).toHaveLength(1);
    expect(weak[0]!.reason).toContain('hésitation');
  });

  it('ignore une carte sans historique — jamais de notion inventée', () => {
    const card = makeCard({ id: 'a' });
    expect(computeWeakConcepts([card], [])).toEqual([]);
  });

  it('ignore une carte solide (réussie, confiante)', () => {
    const card = makeCard({ id: 'a' });
    const logs = [makeLog({ itemId: 'a', correct: true, rating: 3, confidence: 'high' })];
    expect(computeWeakConcepts([card], logs)).toEqual([]);
  });

  it('respecte la limite et priorise les plus sévères', () => {
    const cards = ['a', 'b', 'c', 'd'].map((id) => makeCard({ id }));
    const logs = cards.map((c) => makeLog({ itemId: c.id, correct: false, rating: 0 }));
    const weak = computeWeakConcepts(cards, logs, new Date(), 2);
    expect(weak).toHaveLength(2);
  });
});

describe('computeGreeting', () => {
  it('félicite quand rien n’est dû', () => {
    expect(computeGreeting({ totalDue: 0, atRisk: 0, weakCount: 0 })).toContain('à jour');
  });

  it('signale la fragilité quand des notions faibles existent', () => {
    expect(computeGreeting({ totalDue: 5, atRisk: 1, weakCount: 0 })).toContain('fragiles');
  });

  it('invite à réviser sinon', () => {
    expect(computeGreeting({ totalDue: 5, atRisk: 0, weakCount: 0 })).toContain('retenir');
  });
});

describe('computeDailySummary', () => {
  it('compte uniquement les cartes, jamais les quiz dans le même total', () => {
    const logs = [
      makeLog({ itemKind: 'card', elapsedMs: 10_000 }),
      makeLog({ itemKind: 'quiz', elapsedMs: 20_000 }),
    ];
    const summary = computeDailySummary(logs, 2);
    expect(summary.cardsReviewed).toBe(1);
    expect(summary.documentsOpened).toBe(2);
  });

  it('convertit les millisecondes en minutes arrondies', () => {
    const logs = [makeLog({ elapsedMs: 90_000 })];
    expect(computeDailySummary(logs, 0).minutesStudied).toBe(2);
  });

  it('vaut zéro sans aucune activité — jamais un chiffre gonflé', () => {
    expect(computeDailySummary([], 0)).toEqual({ cardsReviewed: 0, minutesStudied: 0, documentsOpened: 0 });
  });
});
