import { describe, expect, it } from 'vitest';
import { layoutMarkers, spreadPositions, type MarkerAnchor } from '@/services/anatomy/markerLayout';

const anchor = (id: string, x: number, y: number, priority = 1, onScreen = true): MarkerAnchor => ({
  id,
  x,
  y,
  onScreen,
  priority,
});

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

describe('layoutMarkers', () => {
  const opts = { width: 500, height: 400, maxLabels: 8 };

  it('ignore les ancres hors écran', () => {
    const { placed } = layoutMarkers([anchor('a', 100, 100), anchor('b', 100, 100, 1, false)], opts);
    expect(placed.map((p) => p.id)).toEqual(['a']);
  });

  it('range les ancres à gauche et à droite du centre', () => {
    const { placed } = layoutMarkers([anchor('gauche', 100, 200), anchor('droite', 400, 200)], opts);
    expect(placed.find((p) => p.id === 'gauche')!.side).toBe('left');
    expect(placed.find((p) => p.id === 'droite')!.side).toBe('right');
  });

  it('conserve la position réelle de l’ancre pour tracer la ligne de rappel', () => {
    const { placed } = layoutMarkers([anchor('a', 120, 210)], opts);
    expect(placed[0]!.anchorX).toBe(120);
    expect(placed[0]!.anchorY).toBe(210);
  });

  it('n’affiche jamais plus que maxLabels et signale les masquées', () => {
    const many = Array.from({ length: 20 }, (_, i) => anchor(`s${i}`, 100, i * 5, i));
    const { placed, hiddenIds } = layoutMarkers(many, { ...opts, maxLabels: 6 });
    expect(placed).toHaveLength(6);
    expect(hiddenIds).toHaveLength(14);
  });

  it('garde toujours la structure sélectionnée, même de faible priorité', () => {
    const many = Array.from({ length: 20 }, (_, i) => anchor(`s${i}`, 100, i * 5, i));
    const { placed, hiddenIds } = layoutMarkers(many, { ...opts, maxLabels: 3, pinnedId: 's0' });
    expect(placed.map((p) => p.id)).toContain('s0');
    expect(hiddenIds).not.toContain('s0');
  });

  it('n’empile jamais deux étiquettes du même côté', () => {
    const stacked = Array.from({ length: 8 }, (_, i) => anchor(`s${i}`, 100, 200 + i, 8 - i));
    const { placed } = layoutMarkers(stacked, { ...opts, maxLabels: 8, spacing: 26 });
    const ys = placed.filter((p) => p.side === 'left').map((p) => p.labelY).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(26 - 0.001);
  });

  it('est déterministe à priorité égale', () => {
    const same = [anchor('b', 100, 100, 5), anchor('a', 100, 100, 5), anchor('c', 100, 100, 5)];
    const first = layoutMarkers(same, { ...opts, maxLabels: 2 }).placed.map((p) => p.id);
    const second = layoutMarkers(same, { ...opts, maxLabels: 2 }).placed.map((p) => p.id);
    expect(first).toEqual(second);
  });

  it('place les étiquettes dans les marges du viewport', () => {
    const many = Array.from({ length: 6 }, (_, i) => anchor(`s${i}`, 100, i * 60));
    const { placed } = layoutMarkers(many, { ...opts, margin: 8 });
    for (const p of placed) {
      expect(p.labelX).toBeGreaterThanOrEqual(0);
      expect(p.labelX).toBeLessThanOrEqual(opts.width);
      expect(p.labelY).toBeGreaterThanOrEqual(0);
    }
  });
});
