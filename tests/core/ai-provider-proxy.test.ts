import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { openaiProvider } from '@/services/ai/providers/openai';
import { geminiProvider } from '@/services/ai/providers/gemini';
import { AiRequestError, MissingApiKeyError } from '@/services/ai/types';
import { refreshProviderStatus } from '@/services/ai/providerStatus';

const sourceOf = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf-8');

/**
 * OpenAI et Gemini ne peuvent pas être appelés directement depuis le
 * navigateur (CORS refusé par ces deux fournisseurs — vérifié avant ce
 * chantier) : `providers/openai.ts` et `providers/gemini.ts` passent donc
 * par un relais serveur (`/api/ai/openai`, `/api/ai/gemini`). Ici, `fetch`
 * est simulé — aucun réseau réel, aucune clé réelle — pour vérifier que CE
 * client traduit correctement chaque cas du relais, y compris ses pannes.
 */

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const ASK_OPTIONS = { system: 'système', prompt: 'question' };

describe.each([
  { provider: openaiProvider, label: 'OpenAI', path: '/api/ai/openai' },
  { provider: geminiProvider, label: 'Gemini', path: '/api/ai/gemini' },
])('$label provider — via relais serveur', ({ provider, path }) => {
  it('appelle le bon relais avec le system/prompt fournis', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: 'réponse réelle du relais' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await provider.ask(ASK_OPTIONS);

    expect(result).toBe('réponse réelle du relais');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(path);
    const body = JSON.parse((calledInit as RequestInit).body as string);
    expect(body).toMatchObject({ system: 'système', prompt: 'question' });
  });

  it('une clé absente côté serveur (503) devient une MissingApiKeyError claire', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'not_configured', message: 'pas de clé' }),
    }) as unknown as typeof fetch;

    await expect(provider.ask(ASK_OPTIONS)).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it('un quota atteint (429) devient une erreur exploitable, jamais une fausse réponse', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'upstream_quota', message: 'Limite de débit atteinte. Réessaie plus tard.' }),
    }) as unknown as typeof fetch;

    await expect(provider.ask(ASK_OPTIONS)).rejects.toThrow(/débit/);
  });

  it('une panne réseau vers le relais devient une AiRequestError, jamais un plantage silencieux', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    await expect(provider.ask(ASK_OPTIONS)).rejects.toBeInstanceOf(AiRequestError);
  });

  it('un timeout (AbortError) est distingué d’une simple panne réseau', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    global.fetch = vi.fn().mockRejectedValue(abortError) as unknown as typeof fetch;

    await expect(provider.ask(ASK_OPTIONS)).rejects.toThrow(/temps/);
  });

  it('une réponse sans texte exploitable (format inattendu) est rejetée, jamais acceptée telle quelle', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nimportequoi: true }),
    }) as unknown as typeof fetch;

    await expect(provider.ask(ASK_OPTIONS)).rejects.toBeInstanceOf(AiRequestError);
  });

  it('un service amont indisponible (502/504) reste une erreur, jamais une réponse inventée', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'upstream_unavailable', message: 'momentanément indisponible' }),
    }) as unknown as typeof fetch;

    await expect(provider.ask(ASK_OPTIONS)).rejects.toThrow(/indisponible/);
  });
});

describe('isAvailable() reflète l’état réel du relais, jamais une supposition', () => {
  afterEach(() => vi.restoreAllMocks());

  it('devient vrai seulement après confirmation serveur explicite', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ openai: true, gemini: false }),
    }) as unknown as typeof fetch;

    await refreshProviderStatus();

    expect(openaiProvider.isAvailable()).toBe(true);
    expect(geminiProvider.isAvailable()).toBe(false);
  });
});

describe('aucune clé OpenAI/Gemini ne peut fuir depuis le code frontend', () => {
  it('le fournisseur OpenAI ne lit ni localStorage ni une variable d’environnement pour une clé', () => {
    // Structurel : aucune clé n'existe côté client pour ces deux fournisseurs
    // — la seule source de vérité est /api/ai/status (voir providerStatus.ts).
    // On le vérifie en relisant le code source lui-même, pas seulement son
    // comportement à l'exécution.
    const source = sourceOf('../../src/services/ai/providers/openai.ts');
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/process\.env/);
    // `MissingApiKeyError` (le type d'erreur) est légitime à référencer ;
    // seule une VALEUR de clé (lecture/écriture) ne doit jamais apparaître.
    expect(source).not.toMatch(/getApiKey|setApiKey|\.apiKey\b/);
  });

  it('le fournisseur Gemini ne lit ni localStorage ni une variable d’environnement pour une clé', () => {
    const source = sourceOf('../../src/services/ai/providers/gemini.ts');
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/process\.env/);
    // `MissingApiKeyError` (le type d'erreur) est légitime à référencer ;
    // seule une VALEUR de clé (lecture/écriture) ne doit jamais apparaître.
    expect(source).not.toMatch(/getApiKey|setApiKey|\.apiKey\b/);
  });

  it('le relais partagé (proxyClient) ne lit lui non plus aucune clé côté client', () => {
    const source = sourceOf('../../src/services/ai/providers/proxyClient.ts');
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/process\.env/);
    // `MissingApiKeyError` (le type d'erreur) est légitime à référencer ;
    // seule une VALEUR de clé (lecture/écriture) ne doit jamais apparaître.
    expect(source).not.toMatch(/getApiKey|setApiKey|\.apiKey\b/);
  });
});
