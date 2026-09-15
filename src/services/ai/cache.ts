import { db } from '@/data/db';
import { nowISO } from '@/lib/date';
import type { AITask, ProviderId } from './types';

/**
 * CACHE DE RÉPONSES IA — persistant (Dexie/IndexedDB), consulté et alimenté
 * par le SEUL point d'entrée de la couche IA (`orchestrator.ts` → `ask()`).
 * Aucune fonctionnalité n'a besoin de le connaître : demander deux fois la
 * même chose (même tâche, même fournisseur, même modèle, même texte) répond
 * instantanément la deuxième fois, sans quitter l'appareil — c'est ce qui
 * fait paraître l'usage quasi illimité sans jamais prétendre que les quotas
 * le sont.
 *
 * Ce que le cache NE fait PAS : il ne sait rien d'un fournisseur choisi
 * explicitement par l'utilisateur ni ne le contourne — la clé (voir
 * `cacheKey.ts`) inclut le fournisseur et le modèle, donc changer l'un ou
 * l'autre change la clé et ignore toute entrée existante. Une réponse mise
 * en cache a donc TOUJOURS été produite par le fournisseur qu'on interroge
 * maintenant, jamais par un autre.
 */

export interface AiCacheHit {
  response: string;
  providerId: ProviderId;
  model: string;
}

export async function getCachedResponse(key: string): Promise<AiCacheHit | undefined> {
  const entry = await db.aiCache.get(key);
  if (!entry) return undefined;
  // Écriture arrière discrète : sert au nettoyage éventuel des entrées les
  // moins consultées, jamais à décider si la réponse est encore valide (une
  // clé identique implique déjà une requête identique).
  void db.aiCache.update(key, { lastUsedAt: nowISO(), hitCount: entry.hitCount + 1 });
  return { response: entry.response, providerId: entry.providerId as ProviderId, model: entry.model };
}

export async function setCachedResponse(
  key: string,
  entry: { task: AITask; providerId: ProviderId; model: string; response: string },
): Promise<void> {
  const at = nowISO();
  await db.aiCache.put({
    key,
    task: entry.task,
    providerId: entry.providerId,
    model: entry.model,
    response: entry.response,
    createdAt: at,
    lastUsedAt: at,
    hitCount: 0,
  });
}

/** Vide entièrement le cache — bouton explicite dans Réglages, jamais automatique. */
export async function clearAiCache(): Promise<void> {
  await db.aiCache.clear();
}

export async function countCacheEntries(): Promise<number> {
  return db.aiCache.count();
}
