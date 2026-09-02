import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import openaiHandler from '../../api/ai/openai';
import geminiHandler from '../../api/ai/gemini';
import statusHandler from '../../api/ai/status';

/**
 * Les fonctions serverless `api/ai/*` sont de simples `(Request) =>
 * Promise<Response>` (runtime Edge, standard Web) — directement
 * invocables ici, sans déploiement Vercel réel. `fetch` est simulé pour
 * chaque appel SORTANT (vers OpenAI/Gemini) : aucun réseau réel, aucune
 * vraie clé. Ce qui est vérifié : la clé ne quitte jamais ce fichier vers
 * autre chose que l'appel sortant légitime, et chaque panne (quota,
 * timeout, réseau, réponse invalide, service indisponible) produit une
 * erreur exploitable — jamais une fausse réponse.
 */

const originalFetch = global.fetch;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
});

function askRequest(body: unknown): Request {
  return new Request('http://localhost/api/ai/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.each([
  { name: 'OpenAI', handler: openaiHandler, envVar: 'OPENAI_API_KEY', upstreamHost: 'api.openai.com' },
  { name: 'Gemini', handler: geminiHandler, envVar: 'GEMINI_API_KEY', upstreamHost: 'generativelanguage.googleapis.com' },
])('api/ai/$name — relais serveur', ({ handler, envVar, upstreamHost }) => {
  it('refuse une méthode autre que POST', async () => {
    const response = await handler(new Request('http://localhost/api/ai/x', { method: 'GET' }));
    expect(response.status).toBe(405);
  });

  it('répond honnêtement 503 quand la clé serveur est absente — jamais un plantage ni une fausse réponse', async () => {
    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe('not_configured');
  });

  it('rejette un corps invalide (system/prompt manquants)', async () => {
    process.env[envVar] = 'test-key-never-real';
    const response = await handler(askRequest({ prompt: 'seulement un prompt' }));
    expect(response.status).toBe(400);
  });

  it('relaie une réponse réussie du fournisseur', async () => {
    process.env[envVar] = 'test-key-never-real';
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      expect(url).toContain(upstreamHost);
      const body = url.includes('openai')
        ? { choices: [{ message: { content: '  Réponse réelle openai  ' } }] }
        : { candidates: [{ content: { parts: [{ text: '  Réponse réelle gemini  ' }] } }] };
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.text).toContain('Réponse réelle');
  });

  it('la clé configurée part bien dans l’appel sortant, mais ne revient jamais dans la réponse au client', async () => {
    process.env[envVar] = 'sk-secret-value-should-never-leak';
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const sentKey = headers.Authorization ?? headers['x-goog-api-key'];
      expect(sentKey).toContain('sk-secret-value-should-never-leak');
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }], candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
      } as Response);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    const responseText = JSON.stringify(await response.clone().json());
    expect(responseText).not.toContain('sk-secret-value-should-never-leak');
  });

  it('401/403 du fournisseur devient une erreur d’authentification claire, sans la clé', async () => {
    process.env[envVar] = 'test-key-never-real';
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as unknown as typeof fetch;
    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('upstream_auth');
    expect(JSON.stringify(body)).not.toContain('test-key-never-real');
  });

  it('429 du fournisseur devient une erreur de quota', async () => {
    process.env[envVar] = 'test-key-never-real';
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }) as unknown as typeof fetch;
    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe('upstream_quota');
  });

  it('5xx du fournisseur devient "service indisponible", jamais une fausse réponse', async () => {
    process.env[envVar] = 'test-key-never-real';
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }) as unknown as typeof fetch;
    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('upstream_unavailable');
  });

  it('une panne réseau vers le fournisseur devient une erreur claire', async () => {
    process.env[envVar] = 'test-key-never-real';
    global.fetch = vi.fn().mockRejectedValue(new TypeError('network down')) as unknown as typeof fetch;
    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('upstream_unavailable');
  });

  it('un timeout (AbortError) est distingué d’une panne réseau ordinaire', async () => {
    process.env[envVar] = 'test-key-never-real';
    global.fetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')) as unknown as typeof fetch;
    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.error).toBe('upstream_timeout');
  });

  it('une réponse illisible (JSON invalide) du fournisseur est rejetée proprement', async () => {
    process.env[envVar] = 'test-key-never-real';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('invalid json');
      },
    }) as unknown as typeof fetch;
    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('invalid_response');
  });

  it('une réponse sans texte exploitable (format inattendu) est rejetée, jamais inventée', async () => {
    process.env[envVar] = 'test-key-never-real';
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }) as unknown as typeof fetch;
    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('invalid_response');
  });

  /**
   * Diagnostic « Hub IA affiche clé absente malgré une variable Vercel
   * enregistrée » — une valeur collée par erreur avec uniquement des espaces
   * ou un retour à la ligne (copier-coller depuis un fichier .env, par
   * exemple) ne doit jamais être traitée comme une clé exploitable : ni ici
   * (503 honnête plutôt qu'un appel voué à l'échec), ni dans `status.ts`
   * (voir plus bas) — les deux doivent s'accorder, exactement.
   */
  it('une valeur ne contenant que des espaces est traitée comme absente, jamais envoyée au fournisseur', async () => {
    process.env[envVar] = '   \n  ';
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('les espaces superflus autour d’une clé par ailleurs valide sont retirés avant l’appel sortant', async () => {
    process.env[envVar] = '  test-key-never-real  \n';
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const sentKey = headers.Authorization ?? headers['x-goog-api-key'];
      expect(sentKey).not.toMatch(/^\s|\s$/);
      expect(sentKey).toContain('test-key-never-real');
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }], candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
      } as Response);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.status).toBe(200);
  });

  it('la réponse n’est jamais mise en cache (en-tête Cache-Control: no-store)', async () => {
    delete process.env[envVar];
    const response = await handler(askRequest({ system: 's', prompt: 'p' }));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('api/ai/status — ne révèle jamais une valeur de clé', () => {
  it('reflète fidèlement la présence/absence de chaque clé', async () => {
    process.env.OPENAI_API_KEY = 'sk-should-not-appear';
    delete process.env.GEMINI_API_KEY;

    const response = await statusHandler();
    const body = await response.json();

    expect(body).toEqual({ openai: true, gemini: false });
    expect(JSON.stringify(body)).not.toContain('sk-should-not-appear');
  });

  it('les deux à false quand aucune clé n’est configurée', async () => {
    const response = await statusHandler();
    expect(await response.json()).toEqual({ openai: false, gemini: false });
  });

  /**
   * Même garde-fou que les relais eux-mêmes (voir ci-dessus) : une variable
   * D'ENVIRONNEMENT réellement définie mais réduite à des espaces reste
   * annoncée absente — jamais un faux « configuré » qui masquerait le vrai
   * problème (ex. une valeur collée par erreur avec un retour à la ligne).
   */
  it('une clé ne contenant que des espaces est annoncée absente, pas configurée', async () => {
    process.env.OPENAI_API_KEY = '   ';
    process.env.GEMINI_API_KEY = '\n';
    const response = await statusHandler();
    expect(await response.json()).toEqual({ openai: false, gemini: false });
  });

  /**
   * Diagnostic « /api/ai/status répond 200 mais reste périmé » : la réponse
   * ne doit jamais pouvoir être mise en cache par un intermédiaire
   * (navigateur, CDN, extension) — sans quoi une clé tout juste ajoutée sur
   * un nouveau déploiement pourrait continuer d'apparaître absente le temps
   * qu'un cache expire.
   */
  it('la réponse n’est jamais mise en cache (en-tête Cache-Control: no-store)', async () => {
    const response = await statusHandler();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
