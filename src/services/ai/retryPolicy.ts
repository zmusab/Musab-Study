import { AiRequestError } from './types';

/**
 * Classe une erreur IA en TRANSITOIRE (réessayer a une chance réelle de
 * réussir : timeout, panne réseau, service momentanément indisponible,
 * limite de DÉBIT) ou DÉFINITIVE (réessayer échouera à l'identique : clé
 * refusée, crédit épuisé, modèle inconnu, requête invalide).
 *
 * Repose sur les messages français produits par CE codebase (jamais un texte
 * brut de fournisseur — voir `providers/anthropic.ts` et `providers/*Proxy*`,
 * qui traduisent systématiquement) : chaque motif ci-dessous correspond à un
 * message précis et stable, pas à une supposition sur ce qu'un fournisseur
 * pourrait un jour renvoyer.
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  /n'a pas répondu à temps/, // timeout (client ou relais)
  /momentanément indisponible/, // 5xx fournisseur
  /Impossible de joindre/, // panne réseau (client → relais, relais → fournisseur)
  /interrompu par l'hébergeur/, // le relais n'a pas eu le temps de répondre
  /Connexion impossible/, // Anthropic APIConnectionError
  /Limite de débit/, // 429 rate-limit — jamais un 429 de facturation, voir upstream_billing
];

export function isTransientError(error: unknown): boolean {
  if (!(error instanceof AiRequestError)) return false;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(error.message));
}

/** Délais avant chaque nouvelle tentative — deux réessais au maximum, jamais une boucle infinie. */
export const RETRY_DELAYS_MS = [600, 1800];

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
