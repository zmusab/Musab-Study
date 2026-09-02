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
const DEFAULT_MODEL = 'gpt-5.1';

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
      return errorResponse('upstream_quota', 'Limite de débit OpenAI atteinte. Réessaie plus tard.', 429);
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
