import Anthropic from '@anthropic-ai/sdk';
import { getApiKey, getModel, getWorkspaceId } from '../settings';
import { MissingApiKeyError, AiRequestError } from '../types';
import type { AIProvider, AIProviderCapabilities, ProviderAskOptions, QualityTier } from '../types';

/**
 * Le fournisseur Anthropic — porté tel quel depuis l'ancien `client.ts`,
 * comportement inchangé. C'est le SEUL fichier de toute la couche IA qui
 * importe `@anthropic-ai/sdk` : `grep -rn "@anthropic-ai/sdk" src/` ne doit
 * jamais renvoyer autre chose que ce fichier.
 *
 * `dangerouslyAllowBrowser` est requis : le SDK refuse par défaut de tourner
 * côté navigateur pour éviter d'exposer une clé. Ici c'est un choix assumé —
 * l'application est hébergée en statique, sans serveur où cacher un secret, et
 * la clé appartient à l'utilisateur, sur son propre appareil. L'écran
 * Paramètres l'explique explicitement.
 */

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Niveau générique → réglage propre à Anthropic. Un fournisseur qui ne distingue pas les niveaux ferait autrement. */
const TIER_TO_EFFORT: Record<QualityTier, Effort> = {
  fast: 'low',
  balanced: 'medium',
  deep: 'high',
};

/**
 * Modèles qui refusent le paramètre `effort` (erreur, pas une dégradation
 * silencieuse). Haiku 4.5 appartient à la génération de modèles antérieure à
 * l'introduction de ce réglage — le lui envoyer ferait échouer la requête.
 */
const EFFORT_UNSUPPORTED_MODELS = new Set(['claude-haiku-4-5']);

/** Exporté pour les tests : construit le fragment de requête `output_config`, ou rien. */
export function effortParams(
  model: string,
  tier: QualityTier | undefined,
): { output_config: { effort: Effort } } | Record<string, never> {
  if (!tier || EFFORT_UNSUPPORTED_MODELS.has(model)) return {};
  return { output_config: { effort: TIER_TO_EFFORT[tier] } };
}

function createClient(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  const workspaceId = getWorkspaceId();
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    // Requis uniquement par les clés « liées à une identité », qui
    // n'appartiennent à aucun espace de travail — voir `getWorkspaceId`.
    // Absent quand l'utilisateur n'a rien saisi : une clé rattachée à un
    // espace de travail fonctionne sans cet en-tête, comme avant.
    ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
  });
}

/** Traduit une erreur du SDK Anthropic en message actionnable, en français. */
function describeAnthropicError(error: unknown): string {
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
        // Cas repéré en production : une clé « liée à une identité » exige
        // que la requête nomme son espace de travail. Le message brut de
        // l'API est en anglais et parle d'un en-tête HTTP — inexploitable
        // tel quel pour savoir quoi faire. On dit où le régler.
        if (error.message.includes('anthropic-workspace-id')) {
          return getWorkspaceId() === null
            ? 'Ta clé Anthropic est liée à une identité : elle exige un espace de travail. Renseigne « Workspace ID » dans Paramètres → Assistant IA (Console Anthropic → Settings → Workspaces, identifiant en wrkspc_…).'
            : "L'espace de travail renseigné est refusé par Anthropic. Vérifie le « Workspace ID » dans Paramètres → Assistant IA.";
        }
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

/**
 * Capacités réelles connues de la famille Claude — utilisées par le routeur
 * pour décider, pas pour l'affichage. `approxCost*` sont indicatifs
 * (tarifs publics au moment de l'écriture, à revérifier avant tout calcul
 * budgétaire réel).
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
  approxCostPerMTokIn: 3,
  approxCostPerMTokOut: 15,
};

async function ask(options: ProviderAskOptions): Promise<string> {
  const client = createClient();
  const model = options.preferredModel ?? getModel();
  const maxTokens = options.maxTokens ?? 4096;
  const tuning = effortParams(model, options.tier);

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
    throw new AiRequestError(describeAnthropicError(error), error);
  }
}

export const anthropicProvider: AIProvider = {
  id: 'anthropic',
  label: 'Claude (Anthropic)',
  capabilities: CAPABILITIES,
  isAvailable: () => getApiKey() !== null,
  ask,
};

/** Exporté séparément : `orchestrator.ts` en a besoin même pour une erreur qui n'a jamais atteint un provider (ex. aucun provider disponible du tout). */
export { describeAnthropicError };
