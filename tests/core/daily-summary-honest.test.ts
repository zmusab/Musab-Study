import { describe, expect, it } from 'vitest';
import { computeDailySummary } from '@/core/dashboard';
import type { ReviewLog } from '@/types';

/**
 * LE RÉSUMÉ DU JOUR NE SE CONTREDIT PAS LUI-MÊME.
 *
 * L'accueil affichait, l'un au-dessus de l'autre :
 *
 *     0 min étudiées
 *     3 cartes révisées
 *
 * Deux chiffres tirés des MÊMES trois réponses, et c'est celui qui dit zéro
 * qu'on croit. `minutesStudied` arrondit à la minute : une séance de quarante
 * secondes vaut donc zéro, alors que le travail a bien eu lieu.
 */
const log = (elapsedMs: number): ReviewLog => ({
  id: `r${elapsedMs}`,
  subjectId: 's',
  chapterId: null,
  itemId: 'c',
  itemKind: 'card',
  at: '2026-09-14T10:00:00.000Z',
  day: '2026-09-14',
  correct: true,
  rating: 2,
  confidence: 'medium',
  elapsedMs,
});

describe('résumé du jour', () => {
  it('garde le temps brut, que l’arrondi à la minute écrasait à zéro', () => {
    const resume = computeDailySummary([log(12_000), log(9_000), log(4_000)], 0);
    expect(resume.cardsReviewed).toBe(3);
    // Vingt-cinq secondes : l'arrondi rend 0 minute…
    expect(resume.minutesStudied).toBe(0);
    // …mais le temps réel n'est pas nul, et c'est lui qui est affiché.
    expect(resume.msStudied).toBe(25_000);
  });

  it('un jour sans révision n’a réellement aucun temps', () => {
    expect(computeDailySummary([], 0).msStudied).toBe(0);
  });

  it('le temps brut reste cohérent avec les minutes quand la séance est longue', () => {
    const resume = computeDailySummary([log(120_000), log(60_000)], 0);
    expect(resume.minutesStudied).toBe(3);
    expect(resume.msStudied).toBe(180_000);
  });
});
