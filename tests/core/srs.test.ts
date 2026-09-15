import { describe, it, expect } from 'vitest';
import {
  scheduleNext,
  buildDueQueue,
  isDue,
  initialSchedulingState,
  clampEase,
  confidenceModifier,
  importanceFactor,
  difficultyFactor,
  overdueFactor,
  MIN_EASE,
  MAX_EASE,
  DEFAULT_EASE,
  RELEARN_DELAY_MS,
  type SchedulingInput,
} from '@/core/srs';

const NOW = new Date('2026-08-31T10:00:00.000Z');
const DAY_MS = 86_400_000;

function makeItem(overrides: Partial<SchedulingInput> = {}): SchedulingInput {
  return {
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: NOW.toISOString(),
    lastReview: null,
    importance: 2,
    difficulty: 2,
    ...overrides,
  };
}

const daysBetween = (from: Date, iso: string) =>
  Math.round((new Date(iso).getTime() - from.getTime()) / DAY_MS);

describe('clampEase', () => {
  it('borne l’ease des deux côtés', () => {
    expect(clampEase(0.2)).toBe(MIN_EASE);
    expect(clampEase(99)).toBe(MAX_EASE);
    expect(clampEase(2.0)).toBe(2.0);
  });
});

describe('confidenceModifier', () => {
  it('récompense une réussite confiante', () => {
    expect(confidenceModifier('high', 3)).toBeGreaterThan(0);
  });

  it('pénalise le plus durement un échec annoncé confiant', () => {
    // Une illusion de maîtrise est le signal le plus coûteux à ignorer.
    expect(confidenceModifier('high', 0)).toBeLessThan(confidenceModifier('low', 0));
  });

  it('atténue une réussite peu confiante', () => {
    expect(confidenceModifier('low', 2)).toBeLessThan(0);
  });

  it('est neutre en confiance moyenne', () => {
    expect(confidenceModifier('medium', 2)).toBe(0);
    expect(confidenceModifier('medium', 0)).toBe(0);
  });
});

describe('facteurs de modulation', () => {
  it('resserre l’intervalle quand l’importance monte', () => {
    expect(importanceFactor(3)).toBeLessThan(importanceFactor(1));
    expect(importanceFactor(1)).toBe(1);
  });

  it('resserre l’intervalle quand la difficulté monte', () => {
    expect(difficultyFactor(3)).toBeLessThan(difficultyFactor(1));
  });

  it('n’applique le retard qu’au-delà de 1,5× l’intervalle', () => {
    const base = { ease: 2.3, interval: 10, reps: 3, lapses: 0, due: '', lastReview: '' };
    const onTime = { ...base, lastReview: new Date(NOW.getTime() - 10 * DAY_MS).toISOString() };
    const late = { ...base, lastReview: new Date(NOW.getTime() - 20 * DAY_MS).toISOString() };
    expect(overdueFactor(onTime, NOW)).toBe(1);
    expect(overdueFactor(late, NOW)).toBeLessThan(1);
  });

  it('ne pénalise pas une carte jamais révisée', () => {
    expect(overdueFactor({ ...makeItem(), lastReview: null }, NOW)).toBe(1);
  });
});

describe('scheduleNext — échec (Encore)', () => {
  const result = scheduleNext(makeItem({ ease: 2.5, interval: 20, reps: 4 }), 0, 'medium', NOW);

  it('remet les répétitions à zéro et incrémente les oublis', () => {
    expect(result.reps).toBe(0);
    expect(result.lapses).toBe(1);
    expect(result.interval).toBe(0);
  });

  it('baisse l’ease', () => {
    expect(result.ease).toBeLessThan(2.5);
  });

  it('replanifie la carte dans la même session, pas le lendemain', () => {
    expect(new Date(result.due).getTime()).toBe(NOW.getTime() + RELEARN_DELAY_MS);
  });

  it('ne descend jamais sous l’ease minimum, même après de nombreux échecs', () => {
    let state = makeItem({ ease: MIN_EASE });
    for (let i = 0; i < 10; i += 1) {
      state = { ...state, ...scheduleNext(state, 0, 'high', NOW) };
    }
    expect(state.ease).toBe(MIN_EASE);
  });
});

describe('scheduleNext — progression normale', () => {
  it('suit les paliers 1 → 3 → 7 jours à importance et difficulté neutres', () => {
    let item = makeItem({ importance: 1, difficulty: 1 });
    const seen: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const next = scheduleNext(item, 2, 'medium', NOW);
      seen.push(next.interval);
      item = { ...item, ...next };
    }
    expect(seen).toEqual([1, 3, 7]);
  });

  it('donne un intervalle plus long pour « Facile » que pour « Bien »', () => {
    const item = makeItem({ interval: 7, reps: 3 });
    const good = scheduleNext(item, 2, 'medium', NOW);
    const easy = scheduleNext(item, 3, 'medium', NOW);
    expect(easy.interval).toBeGreaterThan(good.interval);
  });

  it('donne un intervalle plus court pour « Difficile » que pour « Bien »', () => {
    const item = makeItem({ interval: 7, reps: 3 });
    const hard = scheduleNext(item, 1, 'medium', NOW);
    const good = scheduleNext(item, 2, 'medium', NOW);
    expect(hard.interval).toBeLessThan(good.interval);
  });

  it('garantit toujours au moins un jour sur une réussite', () => {
    const item = makeItem({ importance: 3, difficulty: 3, interval: 1, reps: 1 });
    expect(scheduleNext(item, 1, 'low', NOW).interval).toBeGreaterThanOrEqual(1);
  });

  it('fait revenir plus tôt une notion « examen » qu’une notion normale', () => {
    const base = { interval: 14, reps: 4 };
    const normal = scheduleNext(makeItem({ ...base, importance: 1 }), 2, 'medium', NOW);
    const exam = scheduleNext(makeItem({ ...base, importance: 3 }), 2, 'medium', NOW);
    expect(exam.interval).toBeLessThan(normal.interval);
  });

  it('aligne la date d’échéance sur l’intervalle calculé', () => {
    const next = scheduleNext(makeItem({ interval: 7, reps: 3 }), 2, 'medium', NOW);
    expect(daysBetween(NOW, next.due)).toBe(next.interval);
  });

  it('horodate la révision', () => {
    expect(scheduleNext(makeItem(), 2, 'medium', NOW).lastReview).toBe(NOW.toISOString());
  });

  it('reste pur : l’objet d’entrée n’est pas muté', () => {
    const item = makeItem({ interval: 7, reps: 3, ease: 2.3 });
    const snapshot = structuredClone(item);
    scheduleNext(item, 3, 'high', NOW);
    expect(item).toEqual(snapshot);
  });

  it('est déterministe pour un même instant injecté', () => {
    const item = makeItem({ interval: 5, reps: 2 });
    expect(scheduleNext(item, 2, 'high', NOW)).toEqual(scheduleNext(item, 2, 'high', NOW));
  });
});

describe('isDue / buildDueQueue', () => {
  it('espace les cartes d’une même notion dans la session', () => {
    const queue = buildDueQueue([
      { ...makeItem(), notionKey: 'nerf-ophtalmique', answer: 'A' },
      { ...makeItem(), notionKey: 'nerf-ophtalmique', answer: 'B' },
      { ...makeItem(), notionKey: 'muscles-droits', answer: 'C' },
    ], NOW);
    expect(queue.map((item) => item.notionKey)).toEqual(['nerf-ophtalmique', 'muscles-droits', 'nerf-ophtalmique']);
  });
  it('ne présente qu’une fois deux cartes qui testent exactement le même fait', () => {
    const queue = buildDueQueue([
      { ...makeItem(), notionKey: 'nerf-ophtalmique', question: 'Q1', answer: 'Trois branches' },
      { ...makeItem(), notionKey: 'nerf-ophtalmique', question: 'Q2', answer: 'Trois branches' },
    ], NOW);
    expect(queue).toHaveLength(1);
  });
  const past = new Date(NOW.getTime() - DAY_MS).toISOString();
  const future = new Date(NOW.getTime() + DAY_MS).toISOString();

  it('considère due une carte dont l’échéance est passée ou atteinte', () => {
    expect(isDue({ due: past }, NOW)).toBe(true);
    expect(isDue({ due: NOW.toISOString() }, NOW)).toBe(true);
    expect(isDue({ due: future }, NOW)).toBe(false);
  });

  it('exclut les cartes non échues de la file', () => {
    const queue = buildDueQueue(
      [
        { ease: 2.0, interval: 1, reps: 1, lapses: 0, due: past, lastReview: null },
        { ease: 2.0, interval: 1, reps: 1, lapses: 0, due: future, lastReview: null },
      ],
      NOW,
    );
    expect(queue).toHaveLength(1);
  });

  it('présente les cartes les plus fragiles en premier', () => {
    const queue = buildDueQueue(
      [
        { ease: 2.8, interval: 1, reps: 1, lapses: 0, due: past, lastReview: null },
        { ease: 1.4, interval: 1, reps: 1, lapses: 0, due: past, lastReview: null },
        { ease: 2.1, interval: 1, reps: 1, lapses: 0, due: past, lastReview: null },
      ],
      NOW,
    );
    expect(queue.map((c) => c.ease)).toEqual([1.4, 2.1, 2.8]);
  });
});

describe('initialSchedulingState', () => {
  it('crée une carte immédiatement révisable et jamais révisée', () => {
    const state = initialSchedulingState(NOW);
    expect(isDue(state, NOW)).toBe(true);
    expect(state.reps).toBe(0);
    expect(state.lastReview).toBeNull();
  });
});
