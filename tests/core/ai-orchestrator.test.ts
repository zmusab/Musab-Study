import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createOrchestrator, resolveProviderChoice } from '@/services/ai/orchestrator';
import { getPreferredProvider, setPreferredProvider } from '@/services/ai/settings';
import { setTaskProviderPreference } from '@/services/ai/taskPreferences';
import { AiRequestError, MissingApiKeyError } from '@/services/ai/types';
import type { AIProvider, AIProviderCapabilities, ProviderAskOptions } from '@/services/ai/types';
import { db } from '@/data/db';
import { resetProviderHealthForTests } from '@/services/ai/providerHealth';
import { clearInFlightForTests } from '@/services/ai/inflight';

/**
 * L'orchestrateur est testé avec de faux providers — aucun réseau, aucune
 * clé réelle. Ce qui est vérifié ici, c'est le MÉCANISME : repli sur un
 * autre provider en cas d'échec, erreur claire sans aucun provider
 * disponible, journal alimenté à chaque tentative.
 *
 * Le cache (`aiCache`, IndexedDB) et la santé des fournisseurs (mémoire,
 * partagée entre tous les tests de ce fichier) sont repris à zéro avant
 * CHAQUE test : sans cela, un test antérieur qui simule un échec, ou qui
 * répond à la même question, fausserait un test suivant qui attend un
 * comportement différent pour cette même requête.
 */
beforeEach(async () => {
  await db.aiCache.clear();
  resetProviderHealthForTests();
  clearInFlightForTests();
});

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
  behavior: {
    available?: boolean;
    ask?: (options: ProviderAskOptions) => Promise<string>;
    capabilities?: Partial<AIProviderCapabilities>;
  } = {},
): AIProvider {
  return {
    id,
    label: id,
    capabilities: { ...CAPABILITIES, ...behavior.capabilities },
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

describe('createOrchestrator — sélection du fournisseur (HUB)', () => {
  afterEach(() => {
    // Les préférences vivent dans localStorage (jsdom) : jamais de fuite d'un test à l'autre.
    setPreferredProvider('auto');
    setTaskProviderPreference('chat-course', 'auto');
    setTaskProviderPreference('course-notions', 'auto');
  });

  it('en mode « auto » par défaut (aucun réglage touché), l’ordre reste exactement celui d’enregistrement', async () => {
    expect(getPreferredProvider()).toBe('auto');
    const order: string[] = [];
    const record = (id: string) => makeProvider(id as AIProvider['id'], { ask: async () => { order.push(id); return `réponse de ${id}`; } });
    const orchestrator = createOrchestrator([record('anthropic'), record('openai')]);
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse de anthropic');
    expect(order).toEqual(['anthropic']);
  });

  it('un fournisseur préféré (réglage général) est essayé en premier', async () => {
    setPreferredProvider('openai');
    const orchestrator = createOrchestrator([makeProvider('anthropic'), makeProvider('openai')]);
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse de openai');
  });

  it('une préférence PAR TÂCHE l’emporte sur la préférence générale', async () => {
    setPreferredProvider('openai');
    setTaskProviderPreference('chat-course', 'anthropic');
    const orchestrator = createOrchestrator([makeProvider('anthropic'), makeProvider('openai')]);
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse de anthropic');
    // Une autre tâche, sans préférence propre, retombe sur la préférence générale.
    expect(await orchestrator.ask({ ...BASE_OPTIONS, task: 'course-notions' })).toBe('réponse de openai');
  });

  /**
   * RÈGLE ABSOLUE (corrige le bug observé en production : « ChatGPT
   * sélectionné, mais c'est Gemini qui répond »). Un fournisseur choisi
   * explicitement est le SEUL essayé — ni repli, ni substitution
   * silencieuse. Le repli automatique n'existe plus que dans le mode
   * « Automatique ». Ces deux tests remplacent deux tests antérieurs qui
   * décrivaient — et donc verrouillaient — exactement le comportement
   * fautif.
   */
  it('un fournisseur choisi mais NON CONFIGURÉ échoue franchement, sans jamais basculer sur un autre', async () => {
    setPreferredProvider('gemini');
    const anthropic = makeProvider('anthropic');
    const orchestrator = createOrchestrator([anthropic, makeProvider('gemini', { available: false })]);

    await expect(orchestrator.ask(BASE_OPTIONS)).rejects.toThrow(MissingApiKeyError);
    await expect(orchestrator.ask(BASE_OPTIONS)).rejects.toThrow(/gemini/i);
  });

  it('un fournisseur choisi qui échoue propage SON erreur, sans jamais tenter un autre fournisseur', async () => {
    setPreferredProvider('openai');
    const jamais = vi.fn(async () => 'réponse de anthropic');
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', { ask: jamais }),
      makeProvider('openai', {
        ask: async () => {
          throw new AiRequestError('panne openai');
        },
      }),
    ]);

    await expect(orchestrator.ask(BASE_OPTIONS)).rejects.toThrow('panne openai');
    expect(jamais).not.toHaveBeenCalled();
  });
});

/**
 * Les cas explicitement demandés : chaque sélection doit envoyer la requête
 * au fournisseur choisi, et à lui seul. Le test central est le dernier —
 * « OpenAI sélectionné ne peut JAMAIS appeler Gemini » — c'est exactement ce
 * qui se produisait en production.
 */
describe('createOrchestrator — la sélection de l’utilisateur est strictement respectée', () => {
  afterEach(() => {
    setPreferredProvider('auto');
    setTaskProviderPreference('chat-course', 'auto');
  });

  /** Fabrique les trois fournisseurs, chacun traçant ses appels réels. */
  function makeTrio() {
    const calls: string[] = [];
    const trace = (id: AIProvider['id']) =>
      makeProvider(id, {
        ask: async () => {
          calls.push(id);
          return `réponse de ${id}`;
        },
      });
    return { calls, providers: [trace('anthropic'), trace('openai'), trace('gemini')] };
  }

  it('sélection OpenAI → OpenAI appelé, et personne d’autre', async () => {
    setPreferredProvider('openai');
    const { calls, providers } = makeTrio();
    expect(await createOrchestrator(providers).ask(BASE_OPTIONS)).toBe('réponse de openai');
    expect(calls).toEqual(['openai']);
  });

  it('sélection Gemini → Gemini appelé, et personne d’autre', async () => {
    setPreferredProvider('gemini');
    const { calls, providers } = makeTrio();
    expect(await createOrchestrator(providers).ask(BASE_OPTIONS)).toBe('réponse de gemini');
    expect(calls).toEqual(['gemini']);
  });

  it('sélection Claude → Claude appelé, et personne d’autre', async () => {
    setPreferredProvider('anthropic');
    const { calls, providers } = makeTrio();
    expect(await createOrchestrator(providers).ask(BASE_OPTIONS)).toBe('réponse de anthropic');
    expect(calls).toEqual(['anthropic']);
  });

  it('mode Automatique → routage automatique, avec repli réel si le premier échoue', async () => {
    setPreferredProvider('auto');
    const calls: string[] = [];
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          calls.push('anthropic');
          throw new AiRequestError('panne anthropic');
        },
      }),
      makeProvider('openai', {
        ask: async () => {
          calls.push('openai');
          return 'réponse de openai';
        },
      }),
    ]);
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse de openai');
    expect(calls).toEqual(['anthropic', 'openai']);
  });

  it('OpenAI sélectionné ne peut JAMAIS finir chez Gemini, même si le relais OpenAI tombe', async () => {
    setPreferredProvider('openai');
    const gemini = vi.fn(async () => 'réponse de gemini');
    const orchestrator = createOrchestrator([
      makeProvider('anthropic'),
      makeProvider('openai', {
        ask: async () => {
          throw new AiRequestError('relais OpenAI injoignable');
        },
      }),
      makeProvider('gemini', { ask: gemini }),
    ]);

    await expect(orchestrator.ask(BASE_OPTIONS)).rejects.toThrow('relais OpenAI injoignable');
    expect(gemini).not.toHaveBeenCalled();
  });

  it('une préférence PAR TÂCHE périmée reste strictement appliquée, jamais mélangée au choix général', async () => {
    // Cas réel possible : « Gemini » réglé autrefois sur une tâche, puis
    // « ChatGPT » choisi en général. La tâche réglée garde son fournisseur —
    // et ne peut pas non plus retomber ailleurs en silence.
    setPreferredProvider('openai');
    setTaskProviderPreference('chat-course', 'gemini');
    const { calls, providers } = makeTrio();

    expect(await createOrchestrator(providers).ask(BASE_OPTIONS)).toBe('réponse de gemini');
    expect(calls).toEqual(['gemini']);
    // Une tâche SANS réglage propre suit bien, elle, le choix général.
    expect(await createOrchestrator(providers).ask({ ...BASE_OPTIONS, task: 'course-notions' })).toBe('réponse de openai');
  });

  it('resolveProviderChoice dit exactement quel fournisseur sera utilisé, et d’où vient ce choix', () => {
    expect(resolveProviderChoice('chat-course')).toEqual({ providerId: null, source: 'auto' });

    setPreferredProvider('openai');
    expect(resolveProviderChoice('chat-course')).toEqual({ providerId: 'openai', source: 'general' });

    setTaskProviderPreference('chat-course', 'gemini');
    expect(resolveProviderChoice('chat-course')).toEqual({ providerId: 'gemini', source: 'task' });
  });

  it('un fournisseur choisi qui ne sait pas faire la tâche le dit clairement, sans substitution', async () => {
    // Mode internet : la recherche web est requise. OpenAI ne la câble pas.
    setPreferredProvider('openai');
    const anthropic = vi.fn(async () => 'réponse de anthropic');
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', { ask: anthropic }),
      makeProvider('openai', { capabilities: { webSearch: false } }),
    ]);

    await expect(orchestrator.ask({ ...BASE_OPTIONS, task: 'chat-internet' })).rejects.toThrow(/recherche web/);
    expect(anthropic).not.toHaveBeenCalled();
  });
});

/**
 * Test de connexion RÉEL : `isAvailable()` dit seulement qu'une clé est
 * configurée, jamais qu'elle est acceptée. `testProvider` envoie une vraie
 * requête minimale au fournisseur DÉSIGNÉ — sans tenir compte des
 * préférences — et rapporte ce qui s'est réellement passé.
 */
describe('createOrchestrator — testProvider', () => {
  afterEach(() => {
    setPreferredProvider('auto');
  });

  it('teste le fournisseur DÉSIGNÉ, jamais celui que la préférence choisirait', async () => {
    setPreferredProvider('anthropic');
    const openaiAsk = vi.fn(async () => 'OK');
    const anthropicAsk = vi.fn(async () => 'OK');
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', { ask: anthropicAsk }),
      makeProvider('openai', { ask: openaiAsk }),
    ]);

    const result = await orchestrator.testProvider('openai');
    expect(result.ok).toBe(true);
    expect(openaiAsk).toHaveBeenCalledTimes(1);
    expect(anthropicAsk).not.toHaveBeenCalled();
  });

  it('rapporte l’échec réel du fournisseur, sans jamais le maquiller en succès', async () => {
    const orchestrator = createOrchestrator([
      makeProvider('gemini', {
        ask: async () => {
          throw new AiRequestError('Gemini ne connaît pas le modèle demandé (404).');
        },
      }),
    ]);

    const result = await orchestrator.testProvider('gemini');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('404');
  });

  it('un fournisseur non configuré est annoncé comme tel, sans requête envoyée', async () => {
    const ask = vi.fn(async () => 'OK');
    const orchestrator = createOrchestrator([makeProvider('openai', { available: false, ask })]);

    const result = await orchestrator.testProvider('openai');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/pas configuré/);
    expect(ask).not.toHaveBeenCalled();
  });

  it('consigne le test dans le journal, comme n’importe quel appel', async () => {
    const orchestrator = createOrchestrator([makeProvider('anthropic')]);
    await orchestrator.testProvider('anthropic');
    expect(orchestrator.getRecentLog()).toHaveLength(1);
  });
});

describe('createOrchestrator — le modèle imposé ne traverse jamais vers un autre fournisseur', () => {
  afterEach(() => {
    setPreferredProvider('auto');
    setTaskProviderPreference('course-notions', 'auto');
  });

  /*
   * Le test jumeau — « le modèle imposé arrive bien au bon fournisseur » —
   * a été retiré avec le podcast : `podcast-analysis` était la seule tâche à
   * imposer un modèle. La capacité reste offerte par le routeur
   * (`TaskRoute.preferredModel`), simplement plus aucune tâche ne s'en sert
   * aujourd'hui. La garantie qui compte, elle, est toujours vérifiée
   * ci-dessous : aucun identifiant de modèle ne doit FUITER vers un
   * fournisseur qui ne le publie pas.
   */

  it('Gemini ne reçoit AUCUN identifiant de modèle Anthropic — la cause du « Gemini a refusé la requête (400) »', async () => {
    setTaskProviderPreference('course-notions', 'gemini');
    let received: string | undefined = 'jamais renseigné';
    const orchestrator = createOrchestrator([
      makeProvider('gemini', {
        ask: async (options) => {
          received = options.preferredModel;
          return 'ok';
        },
      }),
    ]);
    await orchestrator.ask({ ...BASE_OPTIONS, task: 'course-notions' });
    expect(received).toBeUndefined();
  });
});

/**
 * CACHE — le SEUL point d'entrée de la couche IA (`ask()`) évite un appel
 * réseau quand la requête est strictement identique à une déjà obtenue :
 * même tâche, même fournisseur, même modèle, même texte.
 */
describe('createOrchestrator — cache des réponses', () => {
  afterEach(() => setPreferredProvider('auto'));

  it('une deuxième question strictement identique répond depuis le cache, sans rappeler le fournisseur', async () => {
    let calls = 0;
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          calls++;
          return 'réponse unique';
        },
      }),
    ]);
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse unique');
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse unique');
    expect(calls).toBe(1);
  });

  it('changer de fournisseur ignore le cache de l’ancien — jamais la réponse d’un autre fournisseur', async () => {
    setPreferredProvider('anthropic');
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', { ask: async () => 'réponse anthropic' }),
      makeProvider('openai', { ask: async () => 'réponse openai' }),
    ]);
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse anthropic');
    setPreferredProvider('openai');
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse openai');
  });

  it('un prompt différent produit une clé différente, jamais de collision', async () => {
    let calls = 0;
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async (options) => {
          calls++;
          return `réponse à : ${options.prompt}`;
        },
      }),
    ]);
    expect(await orchestrator.ask({ ...BASE_OPTIONS, prompt: 'question A' })).toBe('réponse à : question A');
    expect(await orchestrator.ask({ ...BASE_OPTIONS, prompt: 'question B' })).toBe('réponse à : question B');
    expect(calls).toBe(2);
  });

  it('une réponse en échec n’est jamais mise en cache', async () => {
    let calls = 0;
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          calls++;
          throw new AiRequestError('Anthropic a refusé la requête (400).');
        },
      }),
    ]);
    await expect(orchestrator.ask(BASE_OPTIONS)).rejects.toThrow();
    await expect(orchestrator.ask(BASE_OPTIONS)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it('une réponse en cache est transmise à onText en un seul fragment, pour un flux qui écoute', async () => {
    const orchestrator = createOrchestrator([makeProvider('anthropic', { ask: async () => 'réponse complète' })]);
    await orchestrator.ask(BASE_OPTIONS);

    const fragments: string[] = [];
    const result = await orchestrator.ask({ ...BASE_OPTIONS, onText: (delta) => fragments.push(delta) });
    expect(result).toBe('réponse complète');
    expect(fragments).toEqual(['réponse complète']);
  });
});

/** DÉDUPLICATION EN VOL — le mécanisme lui-même est testé isolément dans `ai-inflight.test.ts` ; ici, son branchement dans `ask()`. */
describe('createOrchestrator — déduplication des requêtes en vol', () => {
  it('deux appels concurrents strictement identiques partagent la même requête réseau', async () => {
    let calls = 0;
    let resolveAsk: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      resolveAsk = resolve;
    });
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          calls++;
          return pending;
        },
      }),
    ]);

    const first = orchestrator.ask(BASE_OPTIONS);
    // Laisse le premier appel dépasser sa lecture de cache (IndexedDB, donc
    // asynchrone) et s'enregistrer en vol AVANT que le second ne parte —
    // sinon les deux lectures de cache concurrentes ne garantissent aucun
    // ordre entre elles, ce que ce test n'a pas vocation à vérifier (voir
    // `ai-inflight.test.ts` pour le mécanisme lui-même, lui parfaitement
    // déterministe).
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = orchestrator.ask(BASE_OPTIONS);
    // Même chose pour le second : le laisser dépasser SA propre lecture de
    // cache et rejoindre l'appel en vol avant de résoudre la requête — sinon
    // la première pourrait déjà s'être terminée et nettoyée entre-temps,
    // fermant la fenêtre de partage avant que le second n'y arrive (un délai
    // artificiel de ce test, pas une limite réelle : en usage réel, un aller-
    // retour réseau dure infiniment plus longtemps qu'une lecture locale).
    await new Promise((resolve) => setTimeout(resolve, 20));
    resolveAsk('réponse partagée');

    expect(await first).toBe('réponse partagée');
    expect(await second).toBe('réponse partagée');
    expect(calls).toBe(1);
  });
});

/**
 * RÉESSAIS — bornés, et jamais sur une erreur définitive (voir
 * `retryPolicy.ts`) : réessayer une clé refusée ou un crédit épuisé échouerait
 * à l'identique, pour rien.
 */
describe('createOrchestrator — réessais transitoires', () => {
  it('une erreur transitoire (service momentanément indisponible) est réessayée, et peut réussir', async () => {
    let calls = 0;
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          calls++;
          if (calls === 1) throw new AiRequestError('Le service est momentanément indisponible. Réessaie dans un instant.');
          return 'réponse après réessai';
        },
      }),
    ]);
    expect(await orchestrator.ask(BASE_OPTIONS)).toBe('réponse après réessai');
    expect(calls).toBe(2);
  }, 10_000);

  it('une erreur définitive (clé refusée) n’est jamais réessayée', async () => {
    let calls = 0;
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          calls++;
          throw new AiRequestError('Clé API refusée. Vérifie-la dans Paramètres → Assistant IA.');
        },
      }),
    ]);
    await expect(orchestrator.ask(BASE_OPTIONS)).rejects.toThrow(/refusée/);
    expect(calls).toBe(1);
  });

  it('une annulation demandée par l’utilisateur interrompt les réessais', async () => {
    const controller = new AbortController();
    let calls = 0;
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          calls++;
          controller.abort();
          throw new AiRequestError('Le service est momentanément indisponible. Réessaie dans un instant.');
        },
      }),
    ]);
    await expect(orchestrator.ask({ ...BASE_OPTIONS, signal: controller.signal })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

/**
 * SANTÉ DES FOURNISSEURS — filtre UNIQUEMENT la sélection du mode
 * Automatique ; un choix explicite reste toujours essayé (voir
 * `providerHealth.ts`).
 */
describe('createOrchestrator — santé des fournisseurs (mode Automatique seulement)', () => {
  afterEach(() => setPreferredProvider('auto'));

  it('en mode Automatique, un fournisseur en échecs consécutifs est écarté au profit d’un autre disponible', async () => {
    setPreferredProvider('auto');
    let anthropicCalls = 0;
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          anthropicCalls++;
          throw new AiRequestError('Anthropic a refusé la requête (400).');
        },
      }),
      makeProvider('openai'),
    ]);

    await orchestrator.ask({ ...BASE_OPTIONS, prompt: 'question 1' });
    await orchestrator.ask({ ...BASE_OPTIONS, prompt: 'question 2' });
    expect(anthropicCalls).toBe(2);

    // Anthropic est désormais en repos : le troisième appel ne le retente plus.
    await orchestrator.ask({ ...BASE_OPTIONS, prompt: 'question 3' });
    expect(anthropicCalls).toBe(2);
  });

  it('un fournisseur choisi explicitement reste toujours essayé, même après des échecs qui l’auraient mis en repos en mode Automatique', async () => {
    setPreferredProvider('anthropic');
    let calls = 0;
    const orchestrator = createOrchestrator([
      makeProvider('anthropic', {
        ask: async () => {
          calls++;
          throw new AiRequestError('Anthropic a refusé la requête (400).');
        },
      }),
    ]);

    await expect(orchestrator.ask({ ...BASE_OPTIONS, prompt: 'q1' })).rejects.toThrow();
    await expect(orchestrator.ask({ ...BASE_OPTIONS, prompt: 'q2' })).rejects.toThrow();
    await expect(orchestrator.ask({ ...BASE_OPTIONS, prompt: 'q3' })).rejects.toThrow();
    expect(calls).toBe(3);
  });
});
