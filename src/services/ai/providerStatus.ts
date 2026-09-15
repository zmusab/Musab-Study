/**
 * Statut des fournisseurs relayés par le serveur (OpenAI, Gemini — voir
 * `api/ai/*`). `AIProvider.isAvailable()` doit être SYNCHRONE ; ce module
 * tient donc un petit cache, rempli par un appel réseau à `/api/ai/status`
 * déclenché au démarrage de l'application (`App.tsx`) et rejouable à la
 * demande (bouton « Vérifier » dans Paramètres).
 *
 * Avant toute réponse du serveur, ou si `/api/ai/status` est inatteignable
 * (hébergement statique pur, sans fonctions serverless — GitHub Pages,
 * aperçu local), le statut reste `false` : jamais un « disponible » supposé
 * par optimisme. Sur GitHub Pages ou en local, OpenAI et Gemini restent
 * donc honnêtement indisponibles, exactement comme avant ce chantier.
 */

export type ProxyProviderId = 'openai' | 'gemini';
type CachedStatus = 'unknown' | 'configured' | 'not-configured' | 'unreachable';

const cache: Record<ProxyProviderId, CachedStatus> = {
  openai: 'unknown',
  gemini: 'unknown',
};

let inFlight: Promise<void> | null = null;

/** Lecture synchrone — c'est tout ce que `AIProvider.isAvailable()` peut consulter. */
export function isProxyProviderAvailable(id: ProxyProviderId): boolean {
  if (id === 'gemini') return false;
  return cache[id] === 'configured';
}

/** Statut détaillé, pour l'affichage (Paramètres) — distingue « pas encore vérifié » de « vérifié, absent ». */
export function proxyProviderStatus(id: ProxyProviderId): CachedStatus {
  return cache[id];
}

/** Relance la vérification serveur. Les appels concurrents partagent la même requête en vol. */
export async function refreshProviderStatus(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // `no-store` des deux côtés (voir aussi `api/ai/_shared.ts`) : ce
      // statut doit toujours refléter le déploiement RÉEL au moment de la
      // vérification, jamais une réponse mise en cache par le navigateur.
      const response = await fetch('/api/ai/status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const data: unknown = await response.json();
      const record = data as { openai?: unknown; gemini?: unknown };
      cache.openai = record.openai === true ? 'configured' : 'not-configured';
      cache.gemini = 'not-configured';
    } catch {
      // Pas de fonctions serverless disponibles (statique pur) ou panne
      // réseau : ni l'un ni l'autre n'est une preuve d'indisponibilité
      // DÉFINITIVE, mais dans le doute, `isAvailable()` doit rester faux.
      cache.openai = 'unreachable';
      cache.gemini = 'unreachable';
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
