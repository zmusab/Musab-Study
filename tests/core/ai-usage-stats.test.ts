import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { dayKey } from '@/lib/date';
import { getTodayUsage, recordAiError, recordApiCall, recordCacheHit } from '@/services/ai/usageStats';

describe('usageStats', () => {
  beforeEach(async () => {
    await db.aiUsage.clear();
  });

  it('un jour sans activité renvoie des compteurs à zéro, sans créer de ligne', async () => {
    const usage = await getTodayUsage();
    expect(usage).toMatchObject({ apiCalls: 0, cacheHits: 0, errors: 0 });
    expect(await db.aiUsage.count()).toBe(0);
  });

  it('additionne les appels API, les hits de cache et les erreurs du jour', async () => {
    await recordApiCall();
    await recordApiCall();
    await recordCacheHit();
    await recordAiError();

    const usage = await getTodayUsage();
    expect(usage).toMatchObject({ apiCalls: 2, cacheHits: 1, errors: 1 });
  });

  it('un seul enregistrement existe par jour civil', async () => {
    await recordApiCall();
    await recordApiCall();
    expect(await db.aiUsage.count()).toBe(1);
  });

  it('un jour différent tient son propre compteur, sans mélanger avec la veille', async () => {
    // Un jour passé, semé directement (sans dépendre de fausses horloges,
    // qui perturbent les transactions Dexie/fake-indexeddb) : simule une
    // activité d'hier, jamais touchée par l'activité d'aujourd'hui.
    const yesterdayKey = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    await db.aiUsage.put({ day: yesterdayKey, apiCalls: 1, cacheHits: 0, errors: 0 });

    await recordApiCall();
    await recordApiCall();

    const today = await getTodayUsage();
    expect(today).toMatchObject({ day: dayKey(), apiCalls: 2 });

    const yesterday = await db.aiUsage.get(yesterdayKey);
    expect(yesterday).toMatchObject({ apiCalls: 1 });
    expect(await db.aiUsage.count()).toBe(2);
  });
});
