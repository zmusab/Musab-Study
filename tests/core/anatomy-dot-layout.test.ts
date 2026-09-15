import { describe, expect, it } from 'vitest';
import { layoutDots, placeDotLabel, type DotAnchor } from '@/services/anatomy/dotLayout';

const anchor = (id: string, x: number, y: number, priority = 1, onScreen = true): DotAnchor => ({
  id,
  x,
  y,
  onScreen,
  priority,
});
const view = { width: 800, height: 600 };

describe('layoutDots — points interactifs sur le modèle', () => {
  it('pose un point par structure quand elles sont bien séparées', () => {
    const dots = layoutDots([anchor('a', 100, 100), anchor('b', 400, 400)], view);
    expect(dots.map((d) => d.id).sort()).toEqual(['a', 'b']);
    expect(dots.every((d) => d.merged.length === 0)).toBe(true);
  });

  it('place chaque point à la position réelle de sa structure', () => {
    const [dot] = layoutDots([anchor('a', 123, 456)], view);
    expect(dot).toMatchObject({ x: 123, y: 456 });
  });

  it('ignore les structures hors champ plutôt que de les coller au bord', () => {
    const dots = layoutDots([anchor('a', 100, 100), anchor('b', 400, 400, 1, false)], view);
    expect(dots.map((d) => d.id)).toEqual(['a']);
  });

  it('regroupe les points trop proches sans perdre aucune structure', () => {
    const dots = layoutDots(
      [anchor('grand', 200, 200, 10), anchor('petit1', 205, 202, 1), anchor('petit2', 198, 207, 1)],
      { ...view, minDistance: 30 },
    );
    expect(dots).toHaveLength(1);
    expect(dots[0]!.id).toBe('grand');
    expect(dots[0]!.merged.sort()).toEqual(['petit1', 'petit2']);
  });

  it('donne le point du groupe à la structure la plus grande', () => {
    const dots = layoutDots([anchor('petit', 200, 200, 1), anchor('grand', 210, 205, 50)], {
      ...view,
      minDistance: 40,
    });
    expect(dots[0]!.id).toBe('grand');
    expect(dots[0]!.merged).toEqual(['petit']);
  });

  it('donne son point à la structure sélectionnée, même minuscule à côté d’une grande', () => {
    // Sans épinglage, « grand » emporterait le point du groupe et la
    // sélection disparaîtrait du modèle : c'est exactement ce qu'il faut
    // éviter. Ici la sélection porte le point, et sa voisine y est fondue.
    const dots = layoutDots([anchor('grand', 200, 200, 99), anchor('choisi', 202, 201, 1)], {
      ...view,
      minDistance: 40,
      pinnedIds: ['choisi'],
    });
    expect(dots.map((d) => d.id)).toEqual(['choisi']);
    expect(dots[0]!.merged).toEqual(['grand']);
  });

  it('sépare la sélection d’un voisin assez éloigné', () => {
    const dots = layoutDots([anchor('grand', 200, 200, 99), anchor('choisi', 400, 400, 1)], {
      ...view,
      minDistance: 40,
      pinnedIds: ['choisi'],
    });
    expect(dots.map((d) => d.id).sort()).toEqual(['choisi', 'grand']);
  });

  it('protège PLUSIEURS points à la fois — la correction montre la bonne réponse et l’erreur', () => {
    const dots = layoutDots(
      [anchor('grand', 200, 200, 99), anchor('bonne', 202, 201, 1), anchor('erreur', 204, 203, 1)],
      { ...view, minDistance: 40, pinnedIds: ['bonne', 'erreur'] },
    );
    expect(dots.map((d) => d.id).sort()).toEqual(['bonne', 'erreur']);
    // La grosse structure voisine est fondue, pas perdue.
    expect(dots.flatMap((d) => d.merged)).toContain('grand');
  });

  it('respecte le plafond de points en fusionnant le surplus, jamais en le supprimant', () => {
    const many = Array.from({ length: 30 }, (_, i) => anchor(`s${i}`, i * 60, 300, 30 - i));
    const dots = layoutDots(many, { ...view, minDistance: 10, maxDots: 5 });
    expect(dots).toHaveLength(5);
    const total = dots.length + dots.reduce((n, d) => n + d.merged.length, 0);
    expect(total).toBe(30);
  });

  it('est stable : le même jeu d’ancres donne toujours le même placement', () => {
    const anchors = [anchor('b', 100, 100, 5), anchor('a', 105, 103, 5), anchor('c', 400, 400, 5)];
    const first = layoutDots(anchors, { ...view, minDistance: 30 });
    const second = layoutDots([...anchors].reverse(), { ...view, minDistance: 30 });
    expect(second.map((d) => d.id)).toEqual(first.map((d) => d.id));
  });
});

describe('placeDotLabel — nom du point sélectionné', () => {
  const size = { labelWidth: 160, labelHeight: 32 };

  it('place l’étiquette à droite quand la place suffit', () => {
    const placement = placeDotLabel({ x: 100, y: 300 }, { ...view, ...size });
    expect(placement.side).toBe('right');
    expect(placement.x).toBeGreaterThan(100);
  });

  it('bascule à gauche près du bord droit', () => {
    const placement = placeDotLabel({ x: 780, y: 300 }, { ...view, ...size });
    expect(placement.side).toBe('left');
    expect(placement.x + size.labelWidth).toBeLessThanOrEqual(view.width);
  });

  it('garde l’étiquette dans le cadre en haut et en bas', () => {
    expect(placeDotLabel({ x: 100, y: -50 }, { ...view, ...size }).y).toBeGreaterThanOrEqual(0);
    expect(placeDotLabel({ x: 100, y: 999 }, { ...view, ...size }).y).toBeLessThanOrEqual(view.height);
  });
});
