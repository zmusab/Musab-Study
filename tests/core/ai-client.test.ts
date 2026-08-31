import { describe, it, expect } from 'vitest';
import { effortParams } from '@/services/ai/client';

/**
 * `effortParams` est le garde-fou qui empêche d'envoyer `output_config.effort`
 * à un modèle qui le refuse. Haiku 4.5 renvoie une erreur (pas une dégradation
 * silencieuse) si ce paramètre est présent — c'est ce que ce test protège.
 */
describe('effortParams', () => {
  it("ajoute l'effort demandé pour un modèle qui le prend en charge", () => {
    expect(effortParams('claude-opus-5', 'medium')).toEqual({ output_config: { effort: 'medium' } });
    expect(effortParams('claude-sonnet-5', 'low')).toEqual({ output_config: { effort: 'low' } });
  });

  it("omet le paramètre pour Haiku 4.5, qui le refuse", () => {
    expect(effortParams('claude-haiku-4-5', 'medium')).toEqual({});
  });

  it("n'ajoute rien quand aucun effort n'est demandé", () => {
    expect(effortParams('claude-opus-5', undefined)).toEqual({});
  });
});
