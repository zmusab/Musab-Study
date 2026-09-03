import { anthropicProvider } from './providers/anthropic';
import { openaiProvider } from './providers/openai';
import { geminiProvider } from './providers/gemini';
import { missingRequirements, selectProviderCandidates, TASK_ROUTES } from './taskRouter';
import { getPreferredProvider } from './settings';
import { getTaskProviderPreference } from './taskPreferences';
import { AiRequestError, MissingApiKeyError, ProviderNotConfiguredError } from './types';
import type { AIProvider, AITask, AskOptions, ProviderId } from './types';

/**
 * Point d'entrée UNIQUE de la couche IA — le HUB. Aucune fonctionnalité
 * (chat, flashcards, podcast, panneau IA du lecteur PDF) n'appelle plus un
 * fournisseur directement — tout passe par `ask()` ici, qui consulte le
 * routeur de tâches puis applique la préférence de l'utilisateur.
 *
 * DEUX RÉGIMES, jamais mélangés :
 *  - un fournisseur CHOISI explicitement (préférence par tâche, sinon
 *    préférence générale) est le SEUL essayé. S'il n'est pas configuré, ou
 *    s'il ne sait pas faire ce que la tâche exige, la demande échoue avec un
 *    message qui le dit — jamais une bascule silencieuse vers un autre ;
 *  - en mode « Automatique » seulement, l'orchestrateur essaie les candidats
 *    disponibles dans l'ordre, avec repli réel si l'un échoue.
 *
 * `anthropicProvider` appelle directement api.anthropic.com depuis le
 * navigateur (Anthropic l'autorise). `openaiProvider`/`geminiProvider`
 * passent par un relais serveur (`api/ai/openai`, `api/ai/gemini`) — ni
 * OpenAI ni Gemini n'autorisent l'appel direct navigateur (CORS refusé,
 * vérifié). Sans ce relais configuré (hébergement statique pur, ou clés
 * serveur absentes), `isAvailable()` reste honnêtement faux pour ces deux
 * — Musab Study continue de fonctionner avec Claude seul, exactement comme
 * avant ce chantier.
 */

/** D'où vient le fournisseur retenu — sert au diagnostic et aux messages d'erreur. */
export type ProviderChoiceSource = 'task' | 'general' | 'auto';

export interface ProviderChoice {
  /** `null` = mode automatique : c'est l'orchestrateur qui décide. */
  providerId: ProviderId | null;
  source: ProviderChoiceSource;
}

/**
 * Le fournisseur RÉELLEMENT retenu pour une tâche, et pourquoi : la
 * préférence par tâche l'emporte sur la préférence générale, elle-même
 * prioritaire sur le mode automatique. Exportée pour que l'interface puisse
 * afficher exactement ce que l'orchestrateur va faire — aucun réglage caché.
 */
export function resolveProviderChoice(task: AITask): ProviderChoice {
  const taskPreference = getTaskProviderPreference(task);
  if (taskPreference !== 'auto') return { providerId: taskPreference, source: 'task' };

  const generalPreference = getPreferredProvider();
  if (generalPreference !== 'auto') return { providerId: generalPreference, source: 'general' };

  return { providerId: null, source: 'auto' };
}

/**
 * Résultat d'un test de connexion. `message` est destiné à l'utilisateur —
 * une phrase compréhensible ; `detail` est le brut, réservé à la section
 * « Détails techniques » et jamais affiché d'emblée.
 */
export interface ProviderTestResult {
  ok: boolean;
  message: string;
  detail?: string;
}

export interface AiCallLogEntry {
  task: AITask;
  providerId: ProviderId;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
  at: string;
}

const MAX_LOG_ENTRIES = 50;

export function createOrchestrator(providers: readonly AIProvider[]) {
  // Journal en mémoire uniquement — l'application n'a pas de serveur où
  // persister des logs réels ; il sert au débogage de la session en cours,
  // pas à un historique durable. Aucun contenu de cours n'y est écrit,
  // seulement la tâche, le fournisseur et le résultat.
  const log: AiCallLogEntry[] = [];

  function recordLog(entry: AiCallLogEntry): void {
    log.push(entry);
    if (log.length > MAX_LOG_ENTRIES) log.shift();
  }

  /**
   * Explique, sans jamais y substituer un autre fournisseur, pourquoi CELUI
   * que l'utilisateur a explicitement choisi ne peut pas traiter la tâche.
   */
  function refuseChosenProvider(providerId: ProviderId, task: AITask): never {
    const registered = providers.find((provider) => provider.id === providerId);
    if (!registered) throw new ProviderNotConfiguredError(providerId);

    if (!registered.isAvailable()) {
      throw new MissingApiKeyError(
        `${registered.label} est sélectionné mais n'est pas configuré. Ouvre Paramètres → Hub IA pour vérifier sa configuration, ou choisis un autre fournisseur.`,
      );
    }

    const missing = missingRequirements(registered.capabilities, task);
    throw new AiRequestError(
      missing.length > 0
        ? `${registered.label} est sélectionné mais ne gère pas ${missing.join(' ni ')} — nécessaire pour cette fonctionnalité. Choisis un autre fournisseur dans Paramètres → Hub IA.`
        : `${registered.label} est sélectionné mais ne peut pas traiter cette demande.`,
    );
  }

  async function ask(options: AskOptions): Promise<string> {
    const route = TASK_ROUTES[options.task];
    const usable = selectProviderCandidates(providers, options.task);
    const choice = resolveProviderChoice(options.task);

    /**
     * RÈGLE ABSOLUE : un fournisseur choisi explicitement (par tâche ou en
     * réglage général) est le SEUL essayé. Aucun repli silencieux vers un
     * autre — c'est précisément ce qui faisait qu'une question posée avec
     * « ChatGPT » sélectionné pouvait finir chez Gemini dès que le relais
     * OpenAI échouait, et n'afficher que l'erreur de Gemini. Le repli
     * automatique n'existe donc plus que dans le mode « Automatique », le
     * seul où l'utilisateur délègue effectivement ce choix.
     */
    const candidates = choice.providerId
      ? usable.filter((provider) => provider.id === choice.providerId)
      : [...usable];

    if (candidates.length === 0) {
      if (choice.providerId) refuseChosenProvider(choice.providerId, options.task);
      throw new MissingApiKeyError();
    }

    let lastError: unknown;
    for (const provider of candidates) {
      const startedAt = Date.now();
      try {
        const result = await provider.ask({
          system: options.system,
          prompt: options.prompt,
          maxTokens: options.maxTokens,
          webSearch: options.webSearch,
          signal: options.signal,
          onText: options.onText,
          tier: route.tier,
          // Uniquement le modèle prévu POUR CE fournisseur : un identifiant
          // Anthropic ne doit jamais partir vers le relais OpenAI ou Gemini.
          preferredModel: route.preferredModel?.[provider.id],
        });
        recordLog({
          task: options.task,
          providerId: provider.id,
          durationMs: Date.now() - startedAt,
          success: true,
          at: new Date().toISOString(),
        });
        return result;
      } catch (error) {
        recordLog({
          task: options.task,
          providerId: provider.id,
          durationMs: Date.now() - startedAt,
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        });
        lastError = error;
        // Une annulation demandée par l'utilisateur ne doit jamais se
        // transformer en tentative silencieuse sur un autre fournisseur.
        if (options.signal?.aborted) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new AiRequestError("L'IA n'a pas pu répondre. Réessaie.");
  }

  function describeAiError(error: unknown): string {
    if (
      error instanceof MissingApiKeyError ||
      error instanceof AiRequestError ||
      error instanceof ProviderNotConfiguredError
    ) {
      return error.message;
    }
    return "L'IA n'a pas pu répondre. Réessaie.";
  }

  function hasAvailableProvider(): boolean {
    return providers.some((provider) => provider.isAvailable());
  }

  /**
   * TEST DE CONNEXION RÉEL pour UN fournisseur précis.
   *
   * `isAvailable()` ne dit qu'une chose : « une clé est configurée ». Il ne
   * dit pas si cette clé est acceptée, si le modèle existe, ni si le relais
   * répond — d'où des réglages qui s'annoncent « configurés » alors que la
   * première vraie question échoue. Cette fonction envoie donc une VRAIE
   * requête minimale au fournisseur demandé, et renvoie ce qui s'est
   * réellement passé. Aucune supposition, aucun résultat simulé.
   *
   * Elle ignore volontairement les préférences de fournisseur : on teste
   * celui qu'on désigne, pas celui que l'orchestrateur choisirait.
   */
  async function testProvider(providerId: ProviderId): Promise<ProviderTestResult> {
    const provider = providers.find((entry) => entry.id === providerId);
    if (!provider) return { ok: false, message: `Fournisseur « ${providerId} » inconnu.` };
    if (!provider.isAvailable()) {
      return {
        ok: false,
        message: `${provider.label} n'est pas configuré.`,
        detail: 'Aucune clé détectée pour ce fournisseur.',
      };
    }

    const startedAt = Date.now();
    try {
      const answer = await provider.ask({
        system: 'Réponds exactement « OK », sans rien ajouter.',
        prompt: 'Test de connexion.',
        maxTokens: 16,
      });
      recordLog({
        task: 'chat-course',
        providerId,
        durationMs: Date.now() - startedAt,
        success: true,
        at: new Date().toISOString(),
      });
      return {
        ok: true,
        message: 'Connexion réussie.',
        detail: `${provider.label} · ${Date.now() - startedAt} ms · réponse : « ${answer.trim().slice(0, 40)} »`,
      };
    } catch (error) {
      recordLog({
        task: 'chat-course',
        providerId,
        durationMs: Date.now() - startedAt,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      });
      // Le message reste celui, en français, que le fournisseur a produit ;
      // le détail brut n'apparaît que derrière « Détails techniques », pour
      // ne pas mettre un code d'erreur sous les yeux de quelqu'un qui veut
      // juste savoir si ça marche.
      return {
        ok: false,
        message: describeAiError(error),
        detail: error instanceof Error ? `${error.name} · ${error.message}` : String(error),
      };
    }
  }

  function getRecentLog(): readonly AiCallLogEntry[] {
    return log;
  }

  return { ask, describeAiError, hasAvailableProvider, testProvider, getRecentLog };
}

export const aiOrchestrator = createOrchestrator([anthropicProvider, openaiProvider, geminiProvider]);
