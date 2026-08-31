import Anthropic from '@anthropic-ai/sdk';
import { getApiKey, getModel } from './settings';

/**
 * Client Anthropic exécuté dans le navigateur.
 *
 * `dangerouslyAllowBrowser` est requis : le SDK refuse par défaut de tourner
 * côté navigateur pour éviter d'exposer une clé. Ici c'est un choix assumé —
 * l'application est hébergée en statique, sans serveur où cacher un secret, et
 * la clé appartient à l'utilisateur, sur son propre appareil. L'écran
 * Paramètres l'explique explicitement.
 */

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "Aucune clé API n'est configurée. Ouvre Paramètres → Assistant IA pour en ajouter une.",
    );
    this.name = 'MissingApiKeyError';
  }
}

export class AiRequestError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AiRequestError';
  }
}

function createClient(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/** Traduit une erreur du SDK en message actionnable, en français. */
export function describeAiError(error: unknown): string {
  if (error instanceof MissingApiKeyError) return error.message;

  if (error instanceof Anthropic.APIError) {
    switch (error.status) {
      case 401:
        return 'Clé API refusée. Vérifie-la dans Paramètres → Assistant IA.';
      case 403:
        return "Cette clé n'a pas accès à ce modèle. Essaie un autre modèle dans Paramètres.";
      case 429:
        return 'Limite de débit atteinte. Attends quelques secondes et réessaie.';
      case 400:
        return `Requête refusée : ${error.message}`;
      default:
        if (error.status && error.status >= 500) {
          return 'Le service est momentanément indisponible. Réessaie dans un instant.';
        }
        return `Erreur de l'IA : ${error.message}`;
    }
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return 'Connexion impossible. Vérifie ta connexion internet.';
  }

  return "L'IA n'a pas pu répondre. Réessaie.";
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Modèles qui refusent le paramètre `effort` (erreur, pas une dégradation
 * silencieuse). Haiku 4.5 appartient à la génération de modèles antérieure à
 * l'introduction de ce réglage — le lui envoyer ferait échouer la requête.
 */
const EFFORT_UNSUPPORTED_MODELS = new Set(['claude-haiku-4-5']);

/** Exporté pour les tests : construit le fragment de requête `output_config`, ou rien. */
export function effortParams(
  model: string,
  effort: Effort | undefined,
): { output_config: { effort: Effort } } | Record<string, never> {
  if (!effort || EFFORT_UNSUPPORTED_MODELS.has(model)) return {};
  return { output_config: { effort } };
}

export interface AskOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Autorise la recherche internet — jamais activé en mode « cours ». */
  webSearch?: boolean;
  signal?: AbortSignal;
  /** Appelé au fil de la génération. Ignoré quand la recherche web est active. */
  onText?: (delta: string) => void;
  /**
   * Profondeur de réflexion demandée au modèle — le premier levier de
   * vitesse : un niveau plus bas répond plus vite et consomme moins de jetons,
   * pour un coût en qualité qui ne se voit que sur les tâches vraiment
   * difficiles. Omis = comportement par défaut du modèle (« high »).
   * Ignoré sans erreur sur les modèles qui ne le prennent pas en charge.
   */
  effort?: Effort;
  /**
   * Modèle à utiliser pour CET appel, à la place du modèle choisi dans les
   * Paramètres. Sert à confier les tâches mécaniques (sélection, extraction)
   * à un modèle plus rapide sans changer le modèle utilisé pour le contenu
   * réellement lu par l'utilisateur — voir services/podcast/pipeline.ts.
   */
  model?: string;
}

/**
 * Envoie une requête au modèle et renvoie le texte produit.
 *
 * En mode « cours » la réponse est diffusée au fil de l'eau : sur une
 * explication longue, voir le texte arriver vaut mieux qu'un indicateur figé.
 * En mode « internet », l'outil de recherche impose plusieurs allers-retours,
 * on attend donc la réponse complète.
 */
export async function ask(options: AskOptions): Promise<string> {
  const client = createClient();
  const model = options.model ?? getModel();
  const maxTokens = options.maxTokens ?? 4096;
  const tuning = effortParams(model, options.effort);

  try {
    if (options.webSearch) {
      const response = await client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system: options.system,
          messages: [{ role: 'user', content: options.prompt }],
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
          ...tuning,
        },
        { signal: options.signal },
      );
      return response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
    }

    const stream = client.messages.stream(
      {
        model,
        max_tokens: maxTokens,
        system: options.system,
        messages: [{ role: 'user', content: options.prompt }],
        ...tuning,
      },
      { signal: options.signal },
    );

    if (options.onText) stream.on('text', options.onText);

    const message = await stream.finalMessage();
    return message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
  } catch (error) {
    if (error instanceof MissingApiKeyError) throw error;
    throw new AiRequestError(describeAiError(error), error);
  }
}

/**
 * Extrait un tableau JSON d'une réponse, même entourée de texte ou de balises
 * de code. Les modèles ajoutent parfois une phrase d'introduction malgré la
 * consigne ; refuser la réponse pour cette seule raison serait fragile.
 */
export function extractJsonArray<T>(raw: string): T[] {
  const withoutFences = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('[');
  const end = withoutFences.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new AiRequestError("La réponse de l'IA n'était pas au format attendu.");
  }
  try {
    const parsed: unknown = JSON.parse(withoutFences.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error('pas un tableau');
    return parsed as T[];
  } catch (cause) {
    throw new AiRequestError("La réponse de l'IA n'a pas pu être interprétée.", cause);
  }
}
