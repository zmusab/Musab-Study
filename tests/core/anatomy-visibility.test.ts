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
    expect(computeVisibility(masseter, state)).toEqual({ opacity: FULL_OPACITY, highlighted: false, feedback: null });
  });

  it('permet plusieurs systèmes actifs simultanément (squelette + nerfs, exemple du cahier des charges)', () => {
    const state = { activeSystems: { squelette: true, nerfs: true, muscles: false }, selectedId: null, isolated: false };
    expect(computeVisibility(mandibule, state).opacity).toBe(FULL_OPACITY);
    expect(computeVisibility(masseter, state).opacity).toBe(HIDDEN_OPACITY);
  });

  it('met en évidence la structure sélectionnée et atténue les autres structures visibles', () => {
    const state = { activeSystems: { muscles: true, squelette: true }, selectedId: 'masseter', isolated: false };
    expect(computeVisibility(masseter, state)).toEqual({ opacity: FULL_OPACITY, highlighted: true, feedback: null });
    expect(computeVisibility(mandibule, state)).toEqual({ opacity: DIMMED_OPACITY, highlighted: false, feedback: null });
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

/**
 * Mode apprentissage : la correction doit être lisible SUR le modèle, pas
 * seulement dans un texte. Ces cas verrouillent le comportement attendu —
 * rien n'est révélé avant la réponse, et après une erreur les DEUX
 * structures (la cliquée et la bonne) restent visibles en même temps.
 */
describe('computeVisibility — correction du mode apprentissage', () => {
  const masseter = { id: 'masseter', category: 'muscles' as const };
  const mandibule = { id: 'mandibule', category: 'squelette' as const };
  const base = { activeSystems: { muscles: true, squelette: true }, selectedId: null, isolated: false };

  it('ne révèle jamais la cible avant la réponse', () => {
    const state = { ...base, learning: { targetId: 'masseter', answeredId: null } };
    expect(computeVisibility(masseter, state).feedback).toBeNull();
    expect(computeVisibility(masseter, state).highlighted).toBe(false);
  });

  it('passe la bonne structure en « correct » après une bonne réponse', () => {
    const state = { ...base, selectedId: 'masseter', learning: { targetId: 'masseter', answeredId: 'masseter' } };
    expect(computeVisibility(masseter, state)).toEqual({
      opacity: FULL_OPACITY,
      highlighted: true,
      feedback: 'correct',
    });
  });

  it('montre simultanément la réponse fausse et la bonne structure', () => {
    const state = { ...base, selectedId: 'masseter', learning: { targetId: 'masseter', answeredId: 'mandibule' } };
    expect(computeVisibility(mandibule, state)).toEqual({
      opacity: FULL_OPACITY,
      highlighted: true,
      feedback: 'incorrect',
    });
    expect(computeVisibility(masseter, state)).toEqual({
      opacity: FULL_OPACITY,
      highlighted: true,
      feedback: 'correct',
    });
  });

  it('n’applique aucune correction à une structure dont le système est masqué', () => {
    const state = {
      activeSystems: { muscles: false, squelette: true },
      selectedId: null,
      isolated: false,
      learning: { targetId: 'masseter', answeredId: 'mandibule' },
    };
    expect(computeVisibility(masseter, state)).toEqual({
      opacity: HIDDEN_OPACITY,
      highlighted: false,
      feedback: null,
    });
  });
});
