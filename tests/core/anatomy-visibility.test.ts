import { describe, it, expect } from 'vitest';
import { computeVisibility, countActiveSystems, HIDDEN_OPACITY, DIMMED_OPACITY, FULL_OPACITY } from '@/services/anatomy/visibility';

/**
 * Logique pure de visibilité — la combinatoire systèmes/sélection/isolation
 * demandée par le cahier des charges (§2-4, §17), testable sans WebGL.
 */
describe('computeVisibility', () => {
  const masseter = { id: 'masseter', category: 'muscles' as const };
  const mandibule = { id: 'mandibule', category: 'squelette' as const };

  it('masque une structure dont le système est désactivé, quel que soit le reste', () => {
    const state = { activeSystems: { muscles: false }, selectedId: null, isolated: false };
    expect(computeVisibility(masseter, state).opacity).toBe(HIDDEN_OPACITY);
  });

  it('affiche à pleine opacité quand le système est actif et rien n’est sélectionné', () => {
    const state = { activeSystems: { muscles: true }, selectedId: null, isolated: false };
    expect(computeVisibility(masseter, state)).toEqual({ opacity: FULL_OPACITY, highlighted: false });
  });

  it('permet plusieurs systèmes actifs simultanément (squelette + nerfs, exemple du cahier des charges)', () => {
    const state = { activeSystems: { squelette: true, nerfs: true, muscles: false }, selectedId: null, isolated: false };
    expect(computeVisibility(mandibule, state).opacity).toBe(FULL_OPACITY);
    expect(computeVisibility(masseter, state).opacity).toBe(HIDDEN_OPACITY);
  });

  it('met en évidence la structure sélectionnée et atténue les autres structures visibles', () => {
    const state = { activeSystems: { muscles: true, squelette: true }, selectedId: 'masseter', isolated: false };
    expect(computeVisibility(masseter, state)).toEqual({ opacity: FULL_OPACITY, highlighted: true });
    expect(computeVisibility(mandibule, state)).toEqual({ opacity: DIMMED_OPACITY, highlighted: false });
  });

  it('en isolation, seule la structure sélectionnée reste visible', () => {
    const state = { activeSystems: { muscles: true, squelette: true }, selectedId: 'masseter', isolated: true };
    expect(computeVisibility(masseter, state).opacity).toBe(FULL_OPACITY);
    expect(computeVisibility(mandibule, state).opacity).toBe(HIDDEN_OPACITY);
  });

  it('l’isolation ne montre rien si le système de la structure isolée est lui-même désactivé', () => {
    const state = { activeSystems: { muscles: false }, selectedId: 'masseter', isolated: true };
    expect(computeVisibility(masseter, state).opacity).toBe(HIDDEN_OPACITY);
  });
});

describe('countActiveSystems', () => {
  it('compte 0, 1 ou tous les systèmes activés', () => {
    expect(countActiveSystems({})).toBe(0);
    expect(countActiveSystems({ muscles: true, squelette: false })).toBe(1);
    expect(countActiveSystems({ muscles: true, squelette: true, nerfs: true, vaisseaux: true, organes: true })).toBe(5);
  });
});
