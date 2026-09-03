import { errorResponse, fetchWithTimeout, hasEnvValue, isAbortError, jsonResponse, parseAskBody, type ProxyAskBody } from './_shared';

export const config = { runtime: 'edge' };

/**
 * RELAIS GEMINI.
 *
 * Clé lue UNIQUEMENT depuis la variable d'environnement serveur
 * `GEMINI_API_KEY` — jamais depuis le corps de la requête, jamais renvoyée
 * au client.
 *
 * Identifiant de modèle à vérifier périodiquement, comme pour OpenAI.
 * Surchageable par requête (`preferredModel`).
 *
 * « Gemini Education » n'a pas d'API distincte pour une intégration tierce
 * (vérifié : c'est une offre de licence/produit — Workspace for Education,
 * Gemini Advanced pour les étudiants — pas un point d'accès développeur
 * séparé). Ce relais, sur l'API Gemini standard, EST donc la façon
 * technique correcte d'exploiter Gemini depuis Musab Study, quel que soit
 * le nom commercial de l'offre visée.
 */
/**
 * Vérifié sur ai.google.dev/gemini-api/docs/models (septembre 2026).
 *
 * (Rectification d'un diagnostic antérieur : `gemini-3.5-flash`, la valeur
 * précédente, EXISTE bien pour generateContent — la gamme « 3.5 » comprend
 * aussi `gemini-3.5-transcribe`, mais les deux coexistent. Ce n'était donc
 * pas la cause des échecs ; voir `MIN_OUTPUT_TOKENS` ci-dessous pour la
 * vraie cause. On garde néanmoins un modèle courant et documenté.)
 * À revérifier périodiquement : le catalogue Google change plus vite que ce
 * fichier.
 */
const DEFAULT_MODEL = 'gemini-3.7-flash';

/**
 * Budget de sortie minimal — LA cause des réponses vides et des blocages
 * observés en production.
 *
 * Les modèles Gemini 3.x réfléchissent par défaut, et ces jetons de réflexion
 * sont DÉCOMPTÉS de `maxOutputTokens`. Un budget serré (le test de connexion
 * en demandait 16) part donc intégralement en réflexion : la réponse revient
 * sans la moindre partie de texte — voire n'aboutit pas du tout. Le plancher
 * ci-dessous garantit qu'il reste toujours de quoi RÉPONDRE après avoir
 * réfléchi. Il n'augmente jamais un budget déjà suffisant : il ne fait que
 * relever ceux qui seraient inutilisables.
 */
const MIN_OUTPUT_TOKENS = 2048;

async function callGemini(apiKey: string, model: string, body: ProxyAskBody): Promise<Response> {
  return fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: body.system }] },
        contents: [{ role: 'user', parts: [{ text: body.prompt }] }],
        generationConfig: {
          maxOutputTokens: Math.max(MIN_OUTPUT_TOKENS, body.maxTokens ?? 4096),
        },
      }),
    },
  );
}

/**
 * Code de raison structuré d'une erreur Google (`error.details[].reason`,
 * ex. `API_KEY_INVALID`), ou `null`. Seul ce code — un identifiant court et
 * public, jamais un texte libre ni une valeur de clé — est extrait : le
 * corps de l'erreur n'est ni renvoyé au client, ni journalisé.
 */
async function readErrorReason(response: Response): Promise<string | null> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const details = (payload as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    const reason = (detail as { reason?: unknown } | null)?.reason;
    if (typeof reason === 'string' && reason.length > 0) return reason;
  }
  return null;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('invalid_request', 'Méthode non autorisée.', 405);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!hasEnvValue(apiKey)) {
    return errorResponse('not_configured', "La clé Gemini n'est pas configurée côté serveur.", 503);
  }

  const body = await parseAskBody(request);
  if (!body) return errorResponse('invalid_request', 'Requête invalide : `system` et `prompt` sont requis.', 400);

  let upstream: Response;
  try {
    upstream = await callGemini(apiKey.trim(), body.preferredModel ?? DEFAULT_MODEL, body);
  } catch (cause) {
    if (isAbortError(cause)) {
      return errorResponse('upstream_timeout', "Gemini n'a pas répondu à temps.", 504);
    }
    return errorResponse('upstream_unavailable', 'Impossible de joindre Gemini (réseau).', 502);
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) {
      return errorResponse('upstream_auth', 'La clé Gemini configurée côté serveur est refusée.', 502);
    }
    if (upstream.status === 429) {
      return errorResponse('upstream_rate_limit', 'Limite de débit Gemini atteinte. Réessaie plus tard.', 429);
    }
    if (upstream.status >= 500) {
      return errorResponse('upstream_unavailable', 'Gemini est momentanément indisponible.', 502);
    }

    // Google, contrairement à la plupart des API, répond 400 (et NON 401)
    // quand la clé est invalide — avec `reason: "API_KEY_INVALID"` dans le
    // corps. Sans cette lecture, le message se réduisait à « Gemini a refusé
    // la requête (400) », impossible à interpréter : c'est exactement le
    // message observé en production. Seul le CODE de raison est lu, jamais
    // le corps brut, qui n'est ni renvoyé ni journalisé.
    const reason = await readErrorReason(upstream);
    if (upstream.status === 400 && reason === 'API_KEY_INVALID') {
      return errorResponse(
        'upstream_auth',
        'La clé Gemini configurée côté serveur est refusée par Google (clé invalide). Vérifie GEMINI_API_KEY dans les variables d’environnement du déploiement.',
        502,
      );
    }
    if (upstream.status === 404) {
      return errorResponse('upstream_error', `Gemini ne connaît pas le modèle demandé (${upstream.status}).`, 502);
    }
    return errorResponse('upstream_error', `Gemini a refusé la requête (${upstream.status}).`, 502);
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    return errorResponse('invalid_response', 'Réponse Gemini illisible.', 502);
  }

  const candidates = (data as {
    candidates?: { finishReason?: unknown; content?: { parts?: { text?: unknown }[] } }[];
  })?.candidates;
  const text = candidates?.[0]?.content?.parts?.map((part) => part.text).filter((t): t is string => typeof t === 'string').join('');
  if (!text || text.trim().length === 0) {
    // Distinguer les deux causes possibles d'une réponse sans texte : le
    // modèle a réfléchi jusqu'à épuiser son budget (`MAX_TOKENS`, cas le plus
    // fréquent sur les modèles Gemini 3.x — voir MIN_OUTPUT_TOKENS), ou la
    // réponse a une forme inattendue. Le premier cas se règle en demandant
    // plus de jetons, le second non : les confondre envoyait l'utilisateur
    // chercher au mauvais endroit.
    if (candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      return errorResponse(
        'invalid_response',
        'Gemini a épuisé son budget de réponse en réflexion, sans rien rédiger. Réessaie : la demande était trop serrée pour ce modèle.',
        502,
      );
    }
    return errorResponse('invalid_response', 'Réponse Gemini vide ou dans un format inattendu.', 502);
  }

  return jsonResponse({ text: text.trim() });
}
