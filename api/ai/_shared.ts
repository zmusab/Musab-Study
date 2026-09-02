/**
 * RELAIS IA — helpers partagés par les fonctions serverless `api/ai/*`.
 *
 * Préfixé `_` : Vercel ignore les fichiers commençant par `_` pour le
 * routage (documenté), ce fichier n'est donc jamais lui-même une route.
 *
 * Rôle de CE dossier, et seulement celui-là : tenir les clés API OpenAI et
 * Gemini côté serveur (variables d'environnement Vercel, jamais lues par le
 * navigateur) et relayer les appels, parce que ni l'API OpenAI ni l'API
 * Gemini n'autorisent un appel direct depuis un navigateur (CORS refusé par
 * ces deux fournisseurs — vérifié avant d'écrire ce fichier). Anthropic,
 * elle, autorise l'appel direct navigateur (`dangerouslyAllowBrowser`) et
 * n'a donc PAS besoin de ce relais — `services/ai/providers/anthropic.ts`
 * continue d'appeler api.anthropic.com directement, inchangé.
 *
 * Règle absolue : aucune fonction de ce dossier ne doit jamais renvoyer,
 * logger ou écrire la valeur d'une clé — seulement l'utiliser dans l'appel
 * sortant vers le fournisseur.
 */

/**
 * Vrai seulement si la variable d'environnement existe ET contient autre
 * chose que des espaces — `Boolean(process.env.X)` seul accepterait une
 * valeur collée par erreur (espace, retour à la ligne isolé) comme
 * « configurée », un faux positif qui ferait ensuite échouer l'appel
 * sortant avec une clé vide. Utilisée IDENTIQUEMENT par `status.ts` (pour
 * annoncer présence/absence) et par `openai.ts`/`gemini.ts` (pour décider
 * d'appeler ou non le fournisseur) — les deux doivent toujours s'accorder.
 *
 * Ne décide jamais qu'une valeur non vide est une clé VALIDE : seule une
 * tentative d'appel réelle peut le dire (voir `upstream_auth` en cas de
 * 401/403 renvoyé par le fournisseur) — cette fonction ne vérifie que la
 * présence, jamais la validité, pour ne jamais fabriquer un diagnostic
 * optimiste ni consommer de quota inutilement.
 */
export function hasEnvValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export interface ProxyAskBody {
  system: string;
  prompt: string;
  maxTokens?: number;
  tier?: 'fast' | 'balanced' | 'deep';
  preferredModel?: string;
}

/** Délai avant abandon de l'appel sortant vers le fournisseur — distingue un timeout d'une vraie erreur réseau. */
export const UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * `no-store` sur les trois routes de ce dossier (status/openai/gemini) :
 * aucune n'a de sens mise en cache — `status` doit toujours refléter l'état
 * RÉEL du déploiement courant (une clé tout juste ajoutée doit apparaître
 * dès la requête suivante, jamais après l'expiration d'un cache), et
 * openai/gemini renvoient une réponse à usage unique. Sans cet en-tête
 * explicite, un intermédiaire (CDN, proxy, extension navigateur) pourrait
 * légitimement choisir de mettre en cache une réponse 200 sans en-tête de
 * cache — ce n'est pas la cause la plus probable d'un statut resté périmé,
 * mais rien ici ne doit pouvoir en dépendre.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Corps de requête minimal attendu : un `system`/`prompt` non vides, le reste est optionnel. */
export async function parseAskBody(request: Request): Promise<ProxyAskBody | null> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.system !== 'string' || typeof record.prompt !== 'string') return null;
  if (record.system.trim().length === 0 || record.prompt.trim().length === 0) return null;

  return {
    system: record.system,
    prompt: record.prompt,
    maxTokens: typeof record.maxTokens === 'number' && record.maxTokens > 0 ? record.maxTokens : undefined,
    tier: record.tier === 'fast' || record.tier === 'balanced' || record.tier === 'deep' ? record.tier : undefined,
    preferredModel: typeof record.preferredModel === 'string' && record.preferredModel.trim().length > 0
      ? record.preferredModel.trim()
      : undefined,
  };
}

/** Code d'erreur STABLE consommé par `services/ai/providers/*` — jamais un message de fournisseur brut, qui pourrait contenir des détails imprévisibles. */
export type ProxyErrorCode = 'not_configured' | 'invalid_request' | 'upstream_auth' | 'upstream_quota' | 'upstream_unavailable' | 'upstream_timeout' | 'upstream_error' | 'invalid_response';

export function errorResponse(code: ProxyErrorCode, message: string, status: number): Response {
  return jsonResponse({ error: code, message }, status);
}

/**
 * `AbortController` déclenche une `DOMException` nommée `AbortError` — qui
 * n'hérite pas forcément de `Error` selon le runtime : on regarde `.name`,
 * jamais `instanceof Error` seul (sinon un timeout se confond avec une
 * panne réseau ordinaire).
 */
export function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError';
}

/** `fetch` avec timeout — combine le signal éventuel de l'appelant avec le nôtre, sans jamais suspendre indéfiniment une fonction serverless. */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
