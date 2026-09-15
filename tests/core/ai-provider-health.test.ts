import { afterEach, describe, expect, it } from 'vitest';
import {
  getProviderHealth,
  isProviderInCooldown,
  recordProviderOutcome,
  resetProviderHealthForTests,
} from '@/services/ai/providerHealth';
import { AiRequestError, MissingApiKeyError } from '@/services/ai/types';

/**
 * Suivi de santé isolé (voir `ai-orchestrator.test.ts` pour son branchement
 * réel dans `ask()`, où seul le mode Automatique le consulte).
 */
describe('providerHealth', () => {
  afterEach(() => resetProviderHealthForTests());

  it('un fournisseur jamais vu est sain, jamais en repos', () => {
    expect(getProviderHealth('anthropic')).toBe('healthy');
    expect(isProviderInCooldown('anthropic')).toBe(false);
  });

  it('un seul échec ne suffit pas à mettre en repos', () => {
    recordProviderOutcome('anthropic', new AiRequestError('Clé API refusée.'));
    expect(isProviderInCooldown('anthropic')).toBe(false);
  });

  it('deux échecs consécutifs mettent en repos', () => {
    recordProviderOutcome('anthropic', new AiRequestError('Clé API refusée.'));
    recordProviderOutcome('anthropic', new AiRequestError('Clé API refusée.'));
    expect(isProviderInCooldown('anthropic')).toBe(true);
    expect(getProviderHealth('anthropic')).toBe('auth_error');
  });

  it('un succès entre-temps remet le compteur d’échecs consécutifs à zéro — il faut de nouveau DEUX échecs pour un repos', () => {
    recordProviderOutcome('anthropic', new AiRequestError('Clé API refusée.'));
    recordProviderOutcome('anthropic', null);
    expect(getProviderHealth('anthropic')).toBe('healthy');

    // Un seul échec après le succès ne suffit toujours pas à mettre en repos.
    recordProviderOutcome('anthropic', new AiRequestError('Clé API refusée.'));
    expect(isProviderInCooldown('anthropic')).toBe(false);
  });

  it('classe chaque famille d’erreur distinctement', () => {
    recordProviderOutcome('openai', new MissingApiKeyError());
    recordProviderOutcome('openai', new MissingApiKeyError());
    expect(getProviderHealth('openai')).toBe('offline');

    resetProviderHealthForTests();
    recordProviderOutcome('gemini', new AiRequestError('Crédit API OpenAI épuisé. Un abonnement ChatGPT...'));
    recordProviderOutcome('gemini', new AiRequestError('Crédit API OpenAI épuisé. Un abonnement ChatGPT...'));
    expect(getProviderHealth('gemini')).toBe('billing_error');

    resetProviderHealthForTests();
    recordProviderOutcome('gemini', new AiRequestError('Limite de débit Gemini atteinte. Réessaie plus tard.'));
    recordProviderOutcome('gemini', new AiRequestError('Limite de débit Gemini atteinte. Réessaie plus tard.'));
    expect(getProviderHealth('gemini')).toBe('rate_limited');

    resetProviderHealthForTests();
    recordProviderOutcome('gemini', new AiRequestError('Gemini ne connaît pas le modèle demandé (404).'));
    recordProviderOutcome('gemini', new AiRequestError('Gemini ne connaît pas le modèle demandé (404).'));
    expect(getProviderHealth('gemini')).toBe('model_error');

    resetProviderHealthForTests();
    recordProviderOutcome('gemini', new AiRequestError('Impossible de joindre le relais Gemini.'));
    recordProviderOutcome('gemini', new AiRequestError('Impossible de joindre le relais Gemini.'));
    expect(getProviderHealth('gemini')).toBe('offline');
  });
});
