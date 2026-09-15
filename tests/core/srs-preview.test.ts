import { describe, expect, it } from 'vitest';
import { DEFAULT_EASE, INTERVAL_STEPS, formatDelay, previewDelays, scheduleNext } from '@/core/srs';
import type { SchedulingInput } from '@/core/srs';
import type { Confidence, Rating } from '@/types';

/**
 * CE QUE CHAQUE NOTE VA COÛTER — et pourquoi les quatre boutons doivent
 * réellement se distinguer.
 *
 * Constaté à l'écran sur une carte neuve : « Difficile », « Bien » et
 * « Facile » annonçaient tous « 1 j ». Le choix de l'étudiant ne changeait
 * rien — une carte sue par cœur revenait le lendemain comme une carte à peine
 * retrouvée. Et sur une carte mûre, l'affichage écrasait 46 et 64 jours en
 * « 2 mois » l'un comme l'autre.
 *
 * L'invariant protégé ici est le seul qui rende ces boutons honnêtes : PLUS
 * LA NOTE EST BONNE, PLUS LE DÉLAI EST LONG. Sans lui, l'aperçu ment.
 */

const NOW = new Date('2026-09-14T10:00:00');
const CONFIDENCE: Confidence = 'medium';
const confidenceFor = () => CONFIDENCE;

function card(over: Partial<SchedulingInput> = {}): SchedulingInput {
  return {
    ease: DEFAULT_EASE, interval: 0, reps: 0, lapses: 0,
    due: NOW.toISOString(), lastReview: null, importance: 2, difficulty: 2, ...over,
  };
}

const intervalFor = (item: SchedulingInput, rating: Rating) =>
  scheduleNext(item, rating, CONFIDENCE, NOW).interval;

describe('scheduleNext — l’ordre des notes', () => {
  it('récompense une meilleure note par un délai plus long, sur une carte neuve', () => {
    const neuve = card();
    expect(intervalFor(neuve, 3)).toBeGreaterThan(intervalFor(neuve, 2));
  });

  it('…et sur une carte mûre', () => {
    const mure = card({ interval: 14, reps: 5, lastReview: '2026-08-31T10:00:00' });
    expect(intervalFor(mure, 2)).toBeGreaterThan(intervalFor(mure, 1));
    expect(intervalFor(mure, 3)).toBeGreaterThan(intervalFor(mure, 2));
  });

  /**
   * Le piège exact : « Facile » montait d'un barreau de l'échelle, mais au
   * BOUT de l'échelle ce barreau n'existe plus et l'espacement multiplicatif
   * reprenait — en dessous de ce que « Bien » donnait. « Facile » punissait
   * alors l'étudiant qui savait.
   */
  it('ne passe jamais sous « Bien », même au bout de l’échelle', () => {
    for (let reps = 0; reps <= INTERVAL_STEPS.length + 3; reps += 1) {
      const item = card({ reps, interval: reps === 0 ? 0 : INTERVAL_STEPS[Math.min(reps, INTERVAL_STEPS.length) - 1]! });
      expect(intervalFor(item, 3)).toBeGreaterThanOrEqual(intervalFor(item, 2));
    }
  });

  it('fait toujours revenir une carte ratée dans la session', () => {
    expect(intervalFor(card({ interval: 60, reps: 8 }), 0)).toBe(0);
  });
});

describe('formatDelay — deux délais différents ne s’affichent pas pareil', () => {
  it('garde les jours jusqu’à trois mois', () => {
    const at = NOW.getTime();
    const inDays = (n: number) => new Date(at + n * 86_400_000).toISOString();
    // 46 et 64 jours donnaient « 2 mois » tous les deux.
    expect(formatDelay(at, inDays(46))).not.toBe(formatDelay(at, inDays(64)));
    expect(formatDelay(at, inDays(46))).toBe('46 j');
  });

  it('dit les minutes pour un retour dans la session', () => {
    expect(formatDelay(NOW.getTime(), new Date(NOW.getTime() + 10 * 60_000).toISOString())).toBe('10 min');
  });

  it('passe aux mois puis aux années quand c’est vraiment loin', () => {
    const at = NOW.getTime();
    expect(formatDelay(at, new Date(at + 180 * 86_400_000).toISOString())).toBe('6 mois');
    expect(formatDelay(at, new Date(at + 800 * 86_400_000).toISOString())).toMatch(/an/);
  });
});

describe('previewDelays — l’aperçu ne peut pas mentir', () => {
  it('annonce exactement ce que la planification enregistrera', () => {
    const mure = card({ interval: 14, reps: 5, lastReview: '2026-08-31T10:00:00' });
    const preview = previewDelays(mure, confidenceFor, NOW);

    for (const rating of [0, 1, 2, 3] as Rating[]) {
      const real = scheduleNext(mure, rating, CONFIDENCE, NOW);
      expect(preview[rating]).toBe(formatDelay(NOW.getTime(), real.due));
    }
  });

  it('donne quatre délais dont trois distincts au moins', () => {
    const mure = card({ interval: 14, reps: 5, lastReview: '2026-08-31T10:00:00' });
    const preview = previewDelays(mure, confidenceFor, NOW);
    expect(new Set(Object.values(preview)).size).toBeGreaterThanOrEqual(3);
  });
});
