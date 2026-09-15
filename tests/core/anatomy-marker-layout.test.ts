import { describe, expect, it } from 'vitest';
import { spreadPositions } from '@/services/anatomy/markerLayout';

/**
 * Répartition sur un axe — utilisée par le schéma anatomique pour écarter
 * des points d'accroche trop serrés. Le placement des points du modèle 3D
 * est testé à part, dans `anatomy-dot-layout.test.ts`.
 */
describe('spreadPositions', () => {
  it('laisse inchangées des positions déjà assez espacées', () => {
    expect(spreadPositions([10, 50, 90], 20, 0, 200)).toEqual([10, 50, 90]);
  });

  it('écarte les positions qui se chevauchent', () => {
    const out = spreadPositions([10, 12, 14], 20, 0, 200);
    for (let i = 1; i < out.length; i++) expect(out[i]! - out[i - 1]!).toBeGreaterThanOrEqual(20);
  });

  it('ramène l’ensemble dans les bornes quand il déborde en bas', () => {
    const out = spreadPositions([180, 185, 190], 20, 0, 200);
    expect(Math.max(...out)).toBeLessThanOrEqual(200);
    for (let i = 1; i < out.length; i++) expect(out[i]! - out[i - 1]!).toBeGreaterThanOrEqual(20);
  });

  it('ne remonte jamais au-dessus de la borne haute', () => {
    const out = spreadPositions([0, 1, 2, 3], 30, 10, 200);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(10);
  });

  it('accepte une liste vide', () => {
    expect(spreadPositions([], 20, 0, 100)).toEqual([]);
  });
});
