import { AiRequestError, MissingApiKeyError } from './types';
import type { ProviderId } from './types';

/**
 * SANTÉ DES FOURNISSEURS — suivi EN MÉMOIRE (le temps de la session, jamais
 * persisté : un redémarrage repart en confiance) des échecs consécutifs par
 * fournisseur, pour éviter qu'en mode Automatique l'orchestrateur retente
 * pendant plusieurs minutes un fournisseur qui vient d'échouer deux fois de
 * suite.
 *
 * RÈGLE ABSOLUE, jamais transgressée : ce module ne filtre QUE la liste des
 * candidats du mode Automatique (`orchestrator.ts`, quand
 * `choice.providerId === null`). Un fournisseur choisi explicitement reste
 * toujours essayé, quel que soit son état de santé — sinon un « degré de
 * santé » calculé en coulisses reviendrait à un repli silencieux déguisé,
 * exactement ce que ce chantier a corrigé.
 */
export type ProviderHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'rate_limited'
  | 'billing_error'
  | 'auth_error'
  | 'model_error'
  | 'offline';

interface HealthState {
  consecutiveFailures: number;
  cooldownUntil: number;
  status: ProviderHealthStatus;
}

const FAILURE_THRESHOLD = 2;
const COOLDOWN_MS = 60_000;

const state = new Map<ProviderId, HealthState>();

function classify(error: unknown): ProviderHealthStatus {
  if (error instanceof MissingApiKeyError) return 'offline';
  if (!(error instanceof AiRequestError)) return 'degraded';
  const message = error.message;
  if (/refusée|liée à une identité|Vérifie le « Workspace/.test(message)) return 'auth_error';
  if (/[Cc]rédit|[Ff]acturation épuisé|Crédit API/.test(message)) return 'billing_error';
  if (/Limite de débit/.test(message)) return 'rate_limited';
  if (/modèle|ne connaît pas le modèle/i.test(message)) return 'model_error';
  if (/[Cc]onnexion impossible|[Ii]mpossible de joindre|n'a pas répondu à temps|interrompu par l'hébergeur/.test(message)) {
    return 'offline';
  }
  return 'degraded';
}

/** À appeler après CHAQUE tentative réelle — succès (`error: null`) ou échec. */
export function recordProviderOutcome(providerId: ProviderId, error: unknown | null): void {
  if (error === null) {
    state.set(providerId, { consecutiveFailures: 0, cooldownUntil: 0, status: 'healthy' });
    return;
  }
  const current = state.get(providerId) ?? { consecutiveFailures: 0, cooldownUntil: 0, status: 'healthy' as const };
  const consecutiveFailures = current.consecutiveFailures + 1;
  const status = classify(error);
  const cooldownUntil = consecutiveFailures >= FAILURE_THRESHOLD ? Date.now() + COOLDOWN_MS : current.cooldownUntil;
  state.set(providerId, { consecutiveFailures, cooldownUntil, status });
}

export function isProviderInCooldown(providerId: ProviderId): boolean {
  const current = state.get(providerId);
  return current !== undefined && Date.now() < current.cooldownUntil;
}

/** Pour l'affichage éventuel (diagnostic) — jamais consulté pour refuser un choix explicite. */
export function getProviderHealth(providerId: ProviderId): ProviderHealthStatus {
  const current = state.get(providerId);
  if (!current) return 'healthy';
  if (Date.now() < current.cooldownUntil) return current.status;
  return current.consecutiveFailures === 0 ? 'healthy' : current.status;
}

/** Réservé aux tests : purge tout état entre deux scénarios. */
export function resetProviderHealthForTests(): void {
  state.clear();
}
