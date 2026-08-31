import { describe, it, expect } from 'vitest';
import { createOrchestrator } from '@/services/ai/orchestrator';
import { AiRequestError, MissingApiKeyError } from '@/services/ai/types';
import type { AIProvider, AIProviderCapabilities, ProviderAskOptions } from '@/services/ai/types';

/**
 * L'orchestrateur est testé avec de faux providers — aucun réseau, aucune
 * clé réelle. Ce qui est vérifié ici, c'est le MÉCANISME : repli sur un
 * autre provider en cas d'échec, erreur claire sans aucun provider
 * disponible, journal alimenté à chaque tentative.
 */

const CAPABILITIES: AIProviderCapabilities = {
  reasoning: 'excellent',
  contextWindowTokens: 200_000,
  structuredOutput: true,
  vision: true,
  fileInput: true,
  toolUse: true,
  webSearch: true,
  speed: 'medium',
  reliability: 'stable',
};

function makeProvider(
  id: AIProvider['id'],
  behavior: { available?: boolean; ask?: (options: ProviderAskOptions) => Promise<string> } = {},
): AIProvider {
  return {
    id,
    label: id,
    capabilities: CAPABILITIES,
    isAvailable: () => behavior.available ?? true,
    ask: behavior.ask ?? (async () => `réponse de ${id}`),
  };
}

const BASE_OPTIONS = { system: 'système', prompt: 'question', task: 'chat-course' as const };

describe('createOrchestrator', () => {
  it('délègue au provider disponible', async () => {
    const orchestrator = createOrchestrator([makeProvider('anthropic')]);
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse de anthropic');
  });

  it('lève une erreur claire quand aucun provider n’est disponible', async () => {
    const orchestrator = createOrchestrator([makeProvider('anthropic', { available: false })]);
    await expect(orchestrator.ask(BASE_OPTIONS)).rejects.toThrow(MissingApiKeyError);
  });

  it('bascule sur le provider suivant quand le premier échoue', async () => {
    const failing = makeProvider('anthropic', {
      ask: async () => {
        throw new AiRequestError('panne simulée');
      },
    });
    const working = makeProvider('openai');
    const orchestrator = createOrchestrator([failing, working]);
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse de openai');
  });

  it('propage l’erreur du dernier provider quand tous échouent', async () => {
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          throw new AiRequestError('échec anthropic');
        },
      }),
      makeProvider('openai', {
        ask: async () => {
          throw new AiRequestError('échec openai');
        },
      }),
    ]);
    await expect(orchestrator.ask(BASE_OPTIONS)).rejects.toThrow('échec openai');
  });

  it('ne bascule jamais sur un autre provider après une annulation demandée par l’utilisateur', async () => {
    const controller = new AbortController();
    const aborting = makeProvider('anthropic', {
      ask: async () => {
        controller.abort();
        throw new AiRequestError('annulé');
      },
    });
    const shouldNeverRun = makeProvider('openai', {
      ask: async () => {
        throw new Error('ne devrait jamais être appelé');
      },
    });
    const orchestrator = createOrchestrator([aborting, shouldNeverRun]);
    await expect(orchestrator.ask({ ...BASE_OPTIONS, signal: controller.signal })).rejects.toThrow('annulé');
  });

  it('consigne chaque tentative dans le journal, succès et échec', async () => {
    const failing = makeProvider('anthropic', {
      ask: async () => {
        throw new AiRequestError('panne simulée');
      },
    });
    const working = makeProvider('openai');
    const orchestrator = createOrchestrator([failing, working]);

    await orchestrator.ask(BASE_OPTIONS);

    const log = orchestrator.getRecentLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ providerId: 'anthropic', success: false, task: 'chat-course' });
    expect(log[1]).toMatchObject({ providerId: 'openai', success: true, task: 'chat-course' });
  });

  it('hasAvailableProvider reflète la disponibilité réelle', () => {
    expect(createOrchestrator([makeProvider('anthropic', { available: false })]).hasAvailableProvider()).toBe(false);
    expect(createOrchestrator([makeProvider('anthropic', { available: true })]).hasAvailableProvider()).toBe(true);
  });

  it('describeAiError traduit les erreurs connues et retombe sur un message générique sinon', () => {
    const orchestrator = createOrchestrator([]);
    expect(orchestrator.describeAiError(new MissingApiKeyError())).toContain('clé API');
    expect(orchestrator.describeAiError(new AiRequestError('détail précis'))).toBe('détail précis');
    expect(orchestrator.describeAiError(new Error('inconnu'))).toBe("L'IA n'a pas pu répondre. Réessaie.");
  });
});
