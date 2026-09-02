import { AiRequestError, MissingApiKeyError } from '../types';
import type { ProviderAskOptions } from '../types';
import { refreshProviderStatus, type ProxyProviderId } from '../providerStatus';

/**
 * Logique d'appel commune à `providers/openai.ts` et `providers/gemini.ts` :
 * les deux passent par le même relais serveur (`api/ai/<id>`, voir
 * `api/ai/_shared.ts`) pour la même raison — CORS refusé par ces deux
 * fournisseurs pour un appel direct navigateur (vérifié avant ce chantier).
 * Un seul endroit traduit donc les codes d'erreur du relais en erreurs de
 * la couche IA commune (`services/ai/types.ts`), que les fonctionnalités
 * consomment déjà sans connaître le fournisseur — inchangé pour elles.
 */

/** Un peu au-dessus du timeout du relais (20 s, voir `api/ai/_shared.ts`) : c'est lui qui doit trancher en premier, avec son message. */
const REQUEST_TIMEOUT_MS = 30_000;

interface ProxySuccessBody {
  text?: unknown;
}
interface ProxyErrorBody {
  error?: unknown;
  message?: unknown;
}

export async function askViaProxy(providerId: ProxyProviderId, label: string, options: ProviderAskOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`/api/ai/${providerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: options.system,
        prompt: options.prompt,
        maxTokens: options.maxTokens,
        tier: options.tier,
        preferredModel: options.preferredModel,
      }),
      signal: options.signal ?? controller.signal,
    });
  } catch (cause) {
    // `AbortController` déclenche une `DOMException` nommée `AbortError` —
    // qui n'hérite pas forcément de `Error` selon l'environnement (jsdom,
    // notamment) : on regarde `.name`, jamais `instanceof Error` seul.
    const aborted = typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError';
    throw new AiRequestError(
      aborted
        ? `${label} n'a pas répondu à temps.`
        : `Impossible de joindre le relais ${label}. Vérifie ta connexion, ou que l'application tourne bien sur un déploiement qui sert /api (pas un simple hébergement statique).`,
      cause,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 503) {
    // Le relais vient de confirmer l'absence de clé serveur : on rafraîchit
    // le cache local tout de suite, pour qu'isAvailable() reflète la réalité
    // dès le prochain essai plutôt que d'attendre le prochain rafraîchissement.
    void refreshProviderStatus();
    throw new MissingApiKeyError(`La clé ${label} n'est pas configurée côté serveur.`);
  }

  let body: ProxySuccessBody | ProxyErrorBody | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const raw = (body as ProxyErrorBody | null)?.message;
    if (typeof raw === 'string' && raw.length > 0) throw new AiRequestError(raw);

    // Aucun message au format de `api/ai/_shared.ts` : la réponse ne vient
    // donc PAS de notre relais, mais de l'hébergeur lui-même (passerelle).
    // Le dire, plutôt que d'attribuer au fournisseur une erreur qu'il n'a
    // jamais renvoyée — c'est ce que faisait « Gemini a renvoyé une erreur
    // (504) », alors que Gemini n'était pour rien dans ce 504.
    throw new AiRequestError(
      response.status === 504 || response.status === 502
        ? `Le relais ${label} a été interrompu par l'hébergeur avant d'avoir répondu (${response.status}). La requête a probablement pris trop de temps ; réessaie, ou choisis un autre fournisseur.`
        : `Le relais ${label} a répondu ${response.status}, dans un format inattendu.`,
    );
  }

  const text = (body as ProxySuccessBody | null)?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new AiRequestError(`Réponse ${label} invalide ou vide.`);
  }
  return text;
}
