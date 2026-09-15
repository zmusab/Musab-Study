import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { isProxyProviderAvailable, proxyProviderStatus, refreshProviderStatus } from '@/services/ai/providerStatus';

/**
 * `isAvailable()` doit toujours refléter un fait constaté côté serveur —
 * jamais une supposition. Avant toute vérification, ou si `/api/ai/status`
 * est injoignable (hébergement statique pur, sans fonctions serverless),
 * le statut reste FAUX : jamais un « disponible » optimiste par défaut.
 */

const originalFetch = global.fetch;

beforeEach(() => {
  // Chaque test repart d'un cache "unknown" — le module est un singleton,
  // donc un test précédent pourrait sinon laisser un résidu.
  vi.resetModules();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('providerStatus — jamais optimiste sans preuve serveur', () => {
  it('avant toute vérification, les deux fournisseurs relayés sont indisponibles', async () => {
    vi.resetModules();
    const fresh = await import('@/services/ai/providerStatus');
    expect(fresh.isProxyProviderAvailable('openai')).toBe(false);
    expect(fresh.isProxyProviderAvailable('gemini')).toBe(false);
    expect(fresh.proxyProviderStatus('openai')).toBe('unknown');
  });

  it('un statut serveur { openai: true, gemini: false } se reflète exactement', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ openai: true, gemini: false }),
    }) as unknown as typeof fetch;

    await refreshProviderStatus();

    expect(isProxyProviderAvailable('openai')).toBe(true);
    expect(isProxyProviderAvailable('gemini')).toBe(false);
    expect(proxyProviderStatus('gemini')).toBe('not-configured');
  });

  it('un /api/ai/status injoignable (hébergement statique pur) laisse les deux fournisseurs indisponibles, sans planter', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    await refreshProviderStatus();

    expect(isProxyProviderAvailable('openai')).toBe(false);
    expect(isProxyProviderAvailable('gemini')).toBe(false);
    expect(proxyProviderStatus('openai')).toBe('unreachable');
  });

  it('une réponse HTTP non-ok est traitée comme injoignable, jamais comme "configuré" par défaut', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;

    await refreshProviderStatus();

    expect(isProxyProviderAvailable('openai')).toBe(false);
    expect(proxyProviderStatus('openai')).toBe('unreachable');
  });

  it('des appels concurrents partagent la même vérification (une seule requête réseau)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ openai: true, gemini: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await Promise.all([refreshProviderStatus(), refreshProviderStatus(), refreshProviderStatus()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
