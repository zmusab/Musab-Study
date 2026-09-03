import type { AITask, ProviderId, QualityTier } from './types';

/**
 * Clé de cache pour une requête IA — voir `cache.ts`.
 *
 * Hash NON cryptographique (deux passes FNV-1a-like à 32 bits, seeds
 * différentes, concaténées en 128 bits) : ce n'est pas une frontière de
 * sécurité, seulement une clé d'adressage interne au cache local. Éviter
 * `crypto.subtle.digest` reste un choix délibéré : synchrone, sans dépendance
 * à une API dont la disponibilité varie selon l'environnement (tests,
 * navigateurs anciens), largement suffisant pour éviter les collisions dans
 * un cache personnel à quelques milliers d'entrées au plus.
 */
export interface CacheKeyInput {
  task: AITask;
  providerId: ProviderId;
  model: string;
  system: string;
  prompt: string;
  tier?: QualityTier;
  maxTokens?: number;
}

function hash32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 2654435761);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

const SEEDS = [0x811c9dc5, 0x1000193, 0x9e3779b9, 0x85ebca6b];

/**
 * Deux requêtes identiques (même tâche, même fournisseur, même modèle, même
 * texte) produisent toujours la même clé — et deux requêtes qui diffèrent
 * sur N'IMPORTE lequel de ces éléments produisent des clés différentes :
 * changer de fournisseur ou de modèle ne peut jamais servir la réponse d'un
 * autre.
 */
export function computeAiCacheKey(input: CacheKeyInput): string {
  const canonical = JSON.stringify({
    task: input.task,
    providerId: input.providerId,
    model: input.model,
    tier: input.tier ?? null,
    maxTokens: input.maxTokens ?? null,
    system: input.system.trim(),
    prompt: input.prompt.trim(),
  });
  return SEEDS.map((seed) => hash32(canonical, seed).toString(16).padStart(8, '0')).join('');
}
