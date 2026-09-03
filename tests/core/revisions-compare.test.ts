import { describe, expect, it } from 'vitest';
import { compareAttempt } from '@/core/revisions/compareAttempt';

describe('compareAttempt', () => {
  it('renvoie null pour une réponse vide (rien à comparer)', () => {
    expect(compareAttempt('', 'Le nerf trijumeau.')).toBeNull();
    expect(compareAttempt('   ', 'Le nerf trijumeau.')).toBeNull();
  });

  it('reconnaît une correspondance exacte, insensible à la casse et aux accents', () => {
    expect(compareAttempt('Le nerf trijumeau', 'le nerf trijumeau')).toBe('close');
    expect(compareAttempt('LE NERF TRIJUMEAU', 'Le Nerf Trijumeau')).toBe('close');
    expect(compareAttempt('le nerf trijumeau', 'le nérf trïjûmeau')).toBe('close');
  });

  it('reconnaît une réponse proche malgré une formulation différente', () => {
    expect(
      compareAttempt(
        'Le nerf trijumeau innerve le muscle masséter',
        'Le nerf trijumeau (V3) innerve notamment le muscle masséter.',
      ),
    ).toBe('close');
  });

  it('détecte une réponse seulement partiellement correcte', () => {
    expect(compareAttempt('le nerf trijumeau', 'Le nerf trijumeau (V3) innerve le muscle masséter.')).toBe(
      'partial',
    );
  });

  it('détecte une réponse très différente sans se prononcer sur son exactitude', () => {
    expect(compareAttempt('Douze paires de nerfs crâniens.', 'Le nerf trijumeau innerve le masséter.')).toBe(
      'different',
    );
  });

  it('reste un indice approximatif : ne renvoie jamais autre chose que les 3 catégories ou null', () => {
    const result = compareAttempt('une réponse quelconque', 'une autre réponse');
    expect(result === null || ['close', 'partial', 'different'].includes(result)).toBe(true);
  });
});
