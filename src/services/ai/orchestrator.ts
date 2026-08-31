import { anthropicProvider } from './providers/anthropic';
import { openaiProvider } from './providers/openai';
import { geminiProvider } from './providers/gemini';
import { selectProviderCandidates, TASK_ROUTES } from './taskRouter';
import { AiRequestError, MissingApiKeyError, ProviderNotConfiguredError } from './types';
import type { AIProvider, AITask, AskOptions, ProviderId } from './types';

/**
 * Point d'entrée UNIQUE de la couche IA. Aucune fonctionnalité (chat,
 * flashcards, podcast, panneau IA du lecteur PDF) n'appelle plus un
 * fournisseur directement — tout passe par `ask()` ici, qui consulte le
 * routeur de tâches puis délègue au(x) provider(s) candidat(s), avec repli
 * réel si plusieurs sont disponibles.
 *
 * Aujourd'hui, un seul provider (`anthropicProvider`) est réellement
 * disponible — `openaiProvider` et `geminiProvider` sont des squelettes dont
 * `isAvailable()` renvoie toujours faux, donc jamais sélectionnés. Le
 * mécanisme de repli est néanmoins réel et actif dès qu'un second provider
 * aura une vraie clé.
 */

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

  async function ask(options: AskOptions): Promise<string> {
    const route = TASK_ROUTES[options.task];
    const candidates = selectProviderCandidates(providers, options.task);

    if (candidates.length === 0) throw new MissingApiKeyError();

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
          preferredModel: route.preferredModel,
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

  function getRecentLog(): readonly AiCallLogEntry[] {
    return log;
  }

  return { ask, describeAiError, hasAvailableProvider, getRecentLog };
}

export const aiOrchestrator = createOrchestrator([anthropicProvider, openaiProvider, geminiProvider]);
