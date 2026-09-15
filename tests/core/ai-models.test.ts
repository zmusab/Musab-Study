import { afterEach, describe, it, expect } from 'vitest';
import {
  PROVIDER_MODELS,
  defaultModelFor,
  getModelFor,
  isKnownModel,
  modelStatusFor,
  setModelFor,
} from '@/services/ai/models';
import type { ProviderId } from '@/services/ai/types';

/**
 * Chaque fournisseur a SES modèles. Un identifiant de modèle n'a de sens que
 * chez celui qui le publie : envoyer un modèle Anthropic à Gemini ne pouvait
 * produire qu'un refus — c'est l'un des bugs observés en production.
 */

const ALL: ProviderId[] = ['anthropic', 'openai', 'gemini'];

afterEach(() => {
  localStorage.clear();
});

describe('catalogue de modèles par fournisseur', () => {
  it('chaque fournisseur propose au moins un modèle', () => {
    for (const provider of ALL) expect(PROVIDER_MODELS[provider].length).toBeGreaterThan(0);
  });

  it('aucun modèle n’est rangé sous un fournisseur qui ne le publie pas', () => {
    const familles: Record<ProviderId, RegExp> = {
      anthropic: /^claude-/,
      openai: /^(gpt|o\d)/,
      gemini: /^gemini-/,
    };
    for (const provider of ALL) {
      for (const model of PROVIDER_MODELS[provider]) {
        expect(model.id, `${provider} → ${model.id}`).toMatch(familles[provider]);
      }
    }
  });

  it('aucun identifiant n’apparaît chez deux fournisseurs', () => {
    const tous = ALL.flatMap((provider) => PROVIDER_MODELS[provider].map((model) => model.id));
    expect(new Set(tous).size).toBe(tous.length);
  });

  it('isKnownModel ne reconnaît un modèle que chez SON fournisseur', () => {
    expect(isKnownModel('anthropic', 'claude-opus-5')).toBe(true);
    expect(isKnownModel('gemini', 'claude-opus-5')).toBe(false);
    expect(isKnownModel('openai', 'gemini-3.7-flash')).toBe(false);
  });

  it('conserve le modèle choisi, par fournisseur et indépendamment', () => {
    setModelFor('gemini', 'gemini-3.6-flash');
    setModelFor('anthropic', 'claude-sonnet-5');

    expect(getModelFor('gemini')).toBe('gemini-3.6-flash');
    expect(getModelFor('anthropic')).toBe('claude-sonnet-5');
    // Un fournisseur jamais réglé garde son défaut, sans hériter d'un autre.
    expect(getModelFor('openai')).toBe(defaultModelFor('openai'));
  });

  it('un modèle enregistré qui a disparu du catalogue est signalé, jamais envoyé en silence', () => {
    localStorage.setItem('musab-study:model:gemini', 'gemini-modele-retire');

    const status = modelStatusFor('gemini');
    expect(status.unavailable).toBe('gemini-modele-retire');
    expect(status.effective).toBe(defaultModelFor('gemini'));
    // Et la requête part avec un modèle réellement disponible.
    expect(getModelFor('gemini')).toBe(defaultModelFor('gemini'));
  });

  it('reprend l’ancien réglage Anthropic d’un appareil déjà configuré', () => {
    localStorage.setItem('musab-study:anthropic-model', 'claude-haiku-4-5');
    expect(getModelFor('anthropic')).toBe('claude-haiku-4-5');
  });

  it('un modèle valide enregistré n’est jamais annoncé comme indisponible', () => {
    setModelFor('openai', PROVIDER_MODELS.openai[0]!.id);
    expect(modelStatusFor('openai').unavailable).toBeNull();
  });
});
