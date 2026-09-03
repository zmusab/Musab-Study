import { db } from '@/data/db';
import { dayKey } from '@/lib/date';
import type { AiUsageDay } from '@/types';

/**
 * STATISTIQUES D'USAGE — un seul enregistrement PAR JOUR (jour civil local,
 * comme le reste de l'application — voir `lib/date.ts`), incrémenté depuis
 * le seul point d'entrée de la couche IA (`orchestrator.ts`). Sert
 * uniquement à l'affichage simple dans Réglages IA : combien d'appels ont
 * réellement quitté l'appareil aujourd'hui, combien le cache en a évités.
 * Pas un tableau de bord détaillé, pas d'historique par tâche ou par
 * fournisseur — le besoin exprimé est une phrase, pas un rapport.
 */

type Kind = 'apiCall' | 'cacheHit' | 'error';

async function bump(kind: Kind): Promise<void> {
  const day = dayKey();
  await db.transaction('rw', db.aiUsage, async () => {
    const current = await db.aiUsage.get(day);
    const next: AiUsageDay = current ?? { day, apiCalls: 0, cacheHits: 0, errors: 0 };
    if (kind === 'apiCall') next.apiCalls += 1;
    else if (kind === 'cacheHit') next.cacheHits += 1;
    else next.errors += 1;
    await db.aiUsage.put(next);
  });
}

export function recordApiCall(): Promise<void> {
  return bump('apiCall');
}

export function recordCacheHit(): Promise<void> {
  return bump('cacheHit');
}

export function recordAiError(): Promise<void> {
  return bump('error');
}

export async function getTodayUsage(): Promise<AiUsageDay> {
  const day = dayKey();
  return (await db.aiUsage.get(day)) ?? { day, apiCalls: 0, cacheHits: 0, errors: 0 };
}
