import { describe, it, expect } from 'vitest';
import {
  masteryPct,
  masteryLevel,
  masteryStatus,
  masteryDistribution,
  averageMastery,
  itemHistory,
  MASTERY_LEVELS,
} from '@/core/mastery';
import { DEFAULT_EASE, MAX_EASE, MIN_EASE } from '@/core/srs';
import type { Flashcard, ReviewLog } from '@/types';

function card(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'c1',
    subjectId: 's1',
    chapterId: 'ch1',
    question: 'Q',
    answer: 'A',
    importance: 2,
    difficulty: 2,
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: '2026-08-31T10:00:00.000Z',
    lastReview: null,
    origin: 'manual',
    sourceChunkIds: [],
    createdAt: '2026-08-31T10:00:00.000Z',
    ...overrides,
  };
}

function log(overrides: Partial<ReviewLog> = {}): ReviewLog {
  return {
    id: 'l1',
    subjectId: 's1',
    chapterId: 'ch1',
    itemId: 'c1',
    itemKind: 'card',
    at: '2026-08-31T10:00:00.000Z',
    day: '2026-08-31',
    correct: true,
    rating: 2,
    confidence: 'medium',
    elapsedMs: 4000,
    ...overrides,
  };
}

describe('masteryPct', () => {
  it('vaut 0 pour une carte jamais révisée', () => {
    expect(masteryPct({ ease: DEFAULT_EASE, interval: 0, reps: 0 })).toBe(0);
  });

  it('croît avec l’intervalle atteint', () => {
    const short = masteryPct({ ease: DEFAULT_EASE, interval: 3, reps: 2 });
    const long = masteryPct({ ease: DEFAULT_EASE, interval: 30, reps: 5 });
    expect(long).toBeGreaterThan(short);
  });

  it('sature au-delà de 60 jours plutôt que de dépasser 100', () => {
    const at60 = masteryPct({ ease: MAX_EASE, interval: 60, reps: 6 });
    const at365 = masteryPct({ ease: MAX_EASE, interval: 365, reps: 9 });
    expect(at60).toBe(100);
    expect(at365).toBe(100);
  });

  it('reste dans [0, 100] même à l’ease minimum', () => {
    const pct = masteryPct({ ease: MIN_EASE, interval: 1, reps: 1 });
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});

describe('masteryLevel', () => {
  it('classe une carte neuve au niveau le plus bas', () => {
    expect(masteryLevel({ ease: DEFAULT_EASE, interval: 0, reps: 0 })).toBe(0);
  });

  it('classe une carte longuement retenue au niveau le plus haut', () => {
    expect(masteryLevel({ ease: MAX_EASE, interval: 60, reps: 6 })).toBe(4);
  });

  it('ne renvoie jamais de niveau hors bornes', () => {
    for (const interval of [0, 1, 5, 20, 45, 60, 500]) {
      const level = masteryLevel({ ease: DEFAULT_EASE, interval, reps: 3 });
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThan(MASTERY_LEVELS);
    }
  });
});

describe('masteryDistribution', () => {
  it('répartit toutes les cartes sans en perdre', () => {
    const cards = [
      card({ id: 'a' }),
      card({ id: 'b', interval: 30, reps: 5 }),
      card({ id: 'c', interval: 60, reps: 6, ease: MAX_EASE }),
    ];
    const dist = masteryDistribution(cards);
    expect(dist).toHaveLength(MASTERY_LEVELS);
    expect(dist.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('renvoie des compteurs à zéro sans carte', () => {
    expect(masteryDistribution([])).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('averageMastery', () => {
  it('vaut 0 sans carte', () => {
    expect(averageMastery([])).toBe(0);
  });

  it('moyenne bien les cartes', () => {
    const a = card({ id: 'a', interval: 60, reps: 6, ease: MAX_EASE });
    const b = card({ id: 'b' });
    expect(averageMastery([a, b])).toBe(Math.round((masteryPct(a) + masteryPct(b)) / 2));
  });

  it('ne baisse pas quand on ajoute des questions de quiz (régression du prototype)', () => {
    // Le prototype injectait les questions de quiz comme des éléments à 0 %,
    // ce qui faisait chuter la maîtrise à chaque question ajoutée.
    const cards = [card({ id: 'a', interval: 30, reps: 5 })];
    expect(averageMastery(cards)).toBe(masteryPct(cards[0]!));
  });
});

describe('itemHistory', () => {
  it('renvoie un historique vide pour un élément jamais révisé', () => {
    expect(itemHistory([], 'c1')).toEqual({
      reviews: 0,
      correct: 0,
      successRate: null,
      lastReviewAt: null,
    });
  });

  it('ne compte que les révisions de l’élément demandé', () => {
    const logs = [
      log({ id: '1', itemId: 'c1', correct: true }),
      log({ id: '2', itemId: 'c2', correct: false }),
      log({ id: '3', itemId: 'c1', correct: false }),
    ];
    const history = itemHistory(logs, 'c1');
    expect(history.reviews).toBe(2);
    expect(history.correct).toBe(1);
    expect(history.successRate).toBe(0.5);
  });

  it('retient la révision la plus récente quel que soit l’ordre du journal', () => {
    const logs = [
      log({ id: '1', at: '2026-08-20T10:00:00.000Z' }),
      log({ id: '2', at: '2026-08-29T10:00:00.000Z' }),
      log({ id: '3', at: '2026-08-25T10:00:00.000Z' }),
    ];
    expect(itemHistory(logs, 'c1').lastReviewAt).toBe('2026-08-29T10:00:00.000Z');
  });
});

describe('masteryStatus', () => {
  it('une carte jamais révisée n’affiche jamais « Très faible · 0% » — le badge de maîtrise le plus bas jugerait la carte, pas son historique', () => {
    const status = masteryStatus(card({ reps: 0, interval: 0 }));
    expect(status.label).toBe('À découvrir · jamais révisée');
    expect(status.pct).toBeNull();
    expect(status.level).toBeNull();
  });

  it('une carte réellement mal maîtrisée après des révisions garde un pourcentage réel, distinct d’une carte neuve', () => {
    const status = masteryStatus(card({ reps: 4, interval: 1, ease: MIN_EASE }));
    expect(status.pct).not.toBeNull();
    expect(status.level).toBe(0);
    expect(status.label).toContain('Très faible');
    expect(status.label).not.toBe('À découvrir · jamais révisée');
  });

  it('reflète exactement masteryPct/masteryLevel pour une carte déjà révisée', () => {
    const c = card({ reps: 3, interval: 30, ease: (MIN_EASE + MAX_EASE) / 2 });
    const status = masteryStatus(c);
    expect(status.pct).toBe(masteryPct(c));
    expect(status.level).toBe(masteryLevel(c));
  });
});
