import { describe, expect, it } from 'vitest';
import { computeAiCacheKey } from '@/services/ai/cacheKey';

const BASE = {
  task: 'chat-course' as const,
  providerId: 'anthropic' as const,
  model: 'claude-sonnet-5',
  system: 'système',
  prompt: 'question',
};

describe('computeAiCacheKey', () => {
  it('est déterministe : deux requêtes identiques produisent la même clé', () => {
    expect(computeAiCacheKey(BASE)).toBe(computeAiCacheKey({ ...BASE }));
  });

  it('un prompt différent change la clé', () => {
    expect(computeAiCacheKey(BASE)).not.toBe(computeAiCacheKey({ ...BASE, prompt: 'autre question' }));
  });

  it('un fournisseur différent change la clé — jamais la réponse d’un autre fournisseur', () => {
    expect(computeAiCacheKey(BASE)).not.toBe(computeAiCacheKey({ ...BASE, providerId: 'openai' }));
  });

  it('un modèle différent change la clé', () => {
    expect(computeAiCacheKey(BASE)).not.toBe(computeAiCacheKey({ ...BASE, model: 'claude-haiku-4-5' }));
  });

  it('une tâche différente change la clé', () => {
    expect(computeAiCacheKey(BASE)).not.toBe(computeAiCacheKey({ ...BASE, task: 'chat-internet' }));
  });

  it('les espaces superflus autour du texte ne changent pas la clé', () => {
    expect(computeAiCacheKey(BASE)).toBe(computeAiCacheKey({ ...BASE, prompt: `  ${BASE.prompt}  `, system: `${BASE.system}\n` }));
  });

  it('produit une clé hexadécimale de longueur fixe', () => {
    const key = computeAiCacheKey(BASE);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});
