import { errorResponse, fetchWithTimeout, hasEnvValue, isAbortError, jsonResponse, parseAskBody, type ProxyAskBody } from './_shared';

export const config = { runtime: 'edge' };

/**
 * RELAIS OPENAI.
 *
 * Clé lue UNIQUEMENT depuis la variable d'environnement serveur
 * `OPENAI_API_KEY` (Vercel → Project Settings → Environment Variables) —
 * jamais depuis le corps de la requête, jamais renvoyée au client.
 *
 * Identifiant de modèle à vérifier périodiquement : le catalogue OpenAI
 * change plus vite que ce fichier. Surchageable par requête
 * (`preferredModel`, voir `services/ai/settings.ts` → sélection par tâche).
 */
/**
 * Vérifié sur platform.openai.com/docs/models (septembre 2026) : `gpt-5.2`
 * est exposé tel quel par l'API Chat Completions. `gpt-5.1` — la valeur
 * précédente — n'est plus une entrée courante du catalogue depuis mars 2026.
 */
const DEFAULT_MODEL = 'gpt-5.2';

/**
 * Code court d'erreur OpenAI (`error.code`, à défaut `error.type`), ou
 * `null`. Seul ce code est extrait — jamais le message brut, potentiellement
 * imprévisible — pour distinguer un compte à sec (`insufficient_quota`,
 * n'importe où) d'une limite de DÉBIT (`rate_limit_exceeded`, transitoire).
 * Documenté par OpenAI : platform.openai.com/docs/guides/error-codes.
 */
async function readErrorCode(response: Response): Promise<string | null> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const error = (payload as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  if (typeof error?.code === 'string' && error.code.length > 0) return error.code;
  if (typeof error?.type === 'string' && error.type.length > 0) return error.type;
  return null;
}

async function callOpenAI(apiKey: string, model: string, body: ProxyAskBody): Promise<Response> {
  return fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: body.system },
        { role: 'user', content: body.prompt },
      ],
      max_completion_tokens: body.maxTokens ?? 4096,
    }),
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('invalid_request', 'Méthode non autorisée.', 405);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!hasEnvValue(apiKey)) {
    return errorResponse('not_configured', "La clé OpenAI n'est pas configurée côté serveur.", 503);
  }

  const body = await parseAskBody(request);
  if (!body) return errorResponse('invalid_request', 'Requête invalide : `system` et `prompt` sont requis.', 400);

  let upstream: Response;
  try {
    upstream = await callOpenAI(apiKey.trim(), body.preferredModel ?? DEFAULT_MODEL, body);
  } catch (cause) {
    if (isAbortError(cause)) {
      return errorResponse('upstream_timeout', "OpenAI n'a pas répondu à temps.", 504);
    }
    return errorResponse('upstream_unavailable', 'Impossible de joindre OpenAI (réseau).', 502);
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) {
      return errorResponse('upstream_auth', 'La clé OpenAI configurée côté serveur est refusée.', 502);
    }
    if (upstream.status === 429) {
      // OpenAI renvoie 429 pour DEUX situations à ne jamais confondre : une
      // limite de DÉBIT (transitoire, réessayer suffit) et un CRÉDIT/QUOTA
      // épuisé (definitif tant que rien n'est rechargé — réessayer ne sert à
      // rien). `error.code` les distingue ; sans lui, impossible de savoir
      // laquelle s'est produite. Un abonnement ChatGPT Plus/Pro ne couvre
      // JAMAIS l'API — c'est une facturation séparée, source de confusion
      // déjà rencontrée : le message le dit explicitement.
      const code = await readErrorCode(upstream);
      if (code === 'insufficient_quota') {
        return errorResponse(
          'upstream_billing',
          "Crédit API OpenAI épuisé. Un abonnement ChatGPT (Plus/Pro) ne couvre PAS l'API : ajoute un moyen de paiement sur platform.openai.com → Billing.",
          429,
        );
      }
      return errorResponse('upstream_rate_limit', 'Limite de débit OpenAI atteinte. Réessaie dans quelques secondes.', 429);
    }
    if (upstream.status >= 500) {
      return errorResponse('upstream_unavailable', 'OpenAI est momentanément indisponible.', 502);
    }
    // 4xx restant (ex. modèle inconnu, requête refusée) : message générique,
    // jamais le corps brut d'OpenAI (pourrait contenir des détails imprévus).
    return errorResponse('upstream_error', `OpenAI a refusé la requête (${upstream.status}).`, 502);
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    return errorResponse('invalid_response', 'Réponse OpenAI illisible.', 502);
  }

  const text = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return errorResponse('invalid_response', 'Réponse OpenAI vide ou dans un format inattendu.', 502);
  }

  return jsonResponse({ text: text.trim() });
}
