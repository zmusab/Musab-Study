import { describe, it, expect } from 'vitest';
import { comprehendPrompt, COMPREHEND_ACTIONS } from '@/services/assistant/comprehendPrompts';

/**
 * Catégorie « Comprendre » de l'Assistant IA — ces fonctions ne font que
 * rédiger la question envoyée au chat existant. Le principe testé ici :
 * chaque action produit une question complète et cohérente, jamais un texte
 * tronqué ou vide qui déclencherait une réponse hors sujet.
 */

describe('comprehendPrompt', () => {
  it('expliquer une notion', () => {
    expect(comprehendPrompt('explain', 'le nerf trijumeau')).toBe('Explique la notion suivante : le nerf trijumeau.');
  });

  it('simplifier une notion', () => {
    expect(comprehendPrompt('simplify', 'la pulpite')).toContain('simple et accessible');
    expect(comprehendPrompt('simplify', 'la pulpite')).toContain('la pulpite');
  });

  it('donner un exemple', () => {
    expect(comprehendPrompt('example', 'l’occlusion dentaire')).toContain('exemple concret');
  });

  it('comparer deux notions — utilise bien les deux champs', () => {
    const prompt = comprehendPrompt('compare', 'le nerf trijumeau', 'le nerf facial');
    expect(prompt).toContain('le nerf trijumeau');
    expect(prompt).toContain('le nerf facial');
    expect(prompt).toContain('Compare');
  });

  it('ignore les espaces superflus autour de la notion', () => {
    expect(comprehendPrompt('explain', '  la carie  ')).toBe('Explique la notion suivante : la carie.');
  });

  it('expose exactement les quatre actions attendues par le cahier des charges', () => {
    expect(COMPREHEND_ACTIONS.map((a) => a.action)).toEqual(['explain', 'simplify', 'example', 'compare']);
  });
});
