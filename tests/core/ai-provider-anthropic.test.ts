import { describe, it, expect } from 'vitest';
import { effortParams } from '@/services/ai/providers/anthropic';

/**
 * `effortParams` est le garde-fou qui empêche d'envoyer `output_config.effort`
 * à un modèle qui le refuse. Haiku 4.5 renvoie une erreur (pas une dégradation
 * silencieuse) si ce paramètre est présent — c'est ce que ce test protège.
 *
 * Anciennement `ai-client.test.ts` : la logique vit désormais dans le
 * provider Anthropic, plus dans un `client.ts` générique, mais le
 * comportement testé est identique (elle prend un niveau générique
 * `QualityTier`, plus un `effort` propre à Anthropic, mais le traduit en
 * interne exactement comme avant).
 */
describe('effortParams', () => {
  it("ajoute l'effort correspondant au niveau demandé pour un modèle qui le prend en charge", () => {
    expect(effortParams('claude-opus-5', 'balanced')).toEqual({ output_config: { effort: 'medium' } });
    expect(effortParams('claude-sonnet-5', 'fast')).toEqual({ output_config: { effort: 'low' } });
    expect(effortParams('claude-sonnet-5', 'deep')).toEqual({ output_config: { effort: 'high' } });
  });

  it("omet le paramètre pour Haiku 4.5, qui le refuse", () => {
    expect(effortParams('claude-haiku-4-5', 'balanced')).toEqual({});
  });

  it("n'ajoute rien quand aucun niveau n'est demandé", () => {
    expect(effortParams('claude-opus-5', undefined)).toEqual({});
  });
});
