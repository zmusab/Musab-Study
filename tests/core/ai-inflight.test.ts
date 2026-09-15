import { afterEach, describe, expect, it } from 'vitest';
import { clearInFlightForTests, dedupeAsk } from '@/services/ai/inflight';

/**
 * Mécanisme de déduplication en vol, testé isolément (sans orchestrateur ni
 * IndexedDB) : deux appels lancés avant que le premier n'ait répondu, avec
 * la MÊME clé, doivent partager la même exécution — cas réel d'un double
 * clic sur « Générer ». Voir `orchestrator.ts` pour son branchement réel.
 */
describe('dedupeAsk', () => {
  afterEach(() => clearInFlightForTests());

  it('deux appels concurrents avec la même clé partagent la même exécution', async () => {
    let calls = 0;
    let resolveRun: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });
    const run = () => {
      calls++;
      return pending;
    };

    const first = dedupeAsk('k', run);
    const second = dedupeAsk('k', run);
    resolveRun('valeur partagée');

    expect(await first).toBe('valeur partagée');
    expect(await second).toBe('valeur partagée');
    expect(calls).toBe(1);
  });

  it('deux clés différentes déclenchent chacune leur propre exécution', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      return `réponse ${calls}`;
    };
    const [a, b] = await Promise.all([dedupeAsk('a', run), dedupeAsk('b', run)]);
    expect(calls).toBe(2);
    expect(a).not.toBe(b);
  });

  it('une fois l’exécution partagée terminée, un appel ultérieur avec la même clé en relance une vraie', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      return `réponse ${calls}`;
    };
    expect(await dedupeAsk('k', run)).toBe('réponse 1');
    expect(await dedupeAsk('k', run)).toBe('réponse 2');
    expect(calls).toBe(2);
  });

  it('un échec partagé se propage à tous les appelants, et libère la clé pour un nouvel essai', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      if (calls === 1) throw new Error('échec partagé');
      return 'réussite';
    };

    const first = dedupeAsk('k', run);
    const second = dedupeAsk('k', run);
    await expect(first).rejects.toThrow('échec partagé');
    await expect(second).rejects.toThrow('échec partagé');
    expect(calls).toBe(1);

    expect(await dedupeAsk('k', run)).toBe('réussite');
    expect(calls).toBe(2);
  });
});
