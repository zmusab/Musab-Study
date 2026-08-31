import { describe, it, expect } from 'vitest';
import { pickLearningTarget, evaluateGuess } from '@/services/anatomy/learning';
import type { AnatomyStructure } from '@/types';

function structure(overrides: Partial<AnatomyStructure> = {}): AnatomyStructure {
  return {
    id: 'x',
    name: 'X',
    latinName: '',
    category: 'squelette',
    subjectId: null,
    model3dRef: 'x',
    region: 'tete-et-cou',
    subregion: 'crane',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('pickLearningTarget', () => {
  it('ne tire jamais une structure sans maillage 3D — on ne peut pas la cliquer dans la scène', () => {
    const list = [structure({ id: 'a', model3dRef: null }), structure({ id: 'b', model3dRef: null })];
    expect(pickLearningTarget(list)).toBeNull();
  });

  it('tire uniquement parmi les structures avec maillage', () => {
    const withMesh = structure({ id: 'a', model3dRef: 'a' });
    const withoutMesh = structure({ id: 'b', model3dRef: null });
    const result = pickLearningTarget([withMesh, withoutMesh], null, () => 0.99);
    expect(result!.id).toBe('a');
  });

  it('exclut la dernière cible pour ne pas répéter deux fois de suite', () => {
    const a = structure({ id: 'a' });
    const b = structure({ id: 'b' });
    const result = pickLearningTarget([a, b], 'a', () => 0);
    expect(result!.id).toBe('b');
  });

  it('renvoie null si aucun candidat après exclusion', () => {
    const a = structure({ id: 'a' });
    expect(pickLearningTarget([a], 'a')).toBeNull();
  });
});

describe('evaluateGuess', () => {
  it('correct si l’identifiant cliqué correspond exactement à la cible', () => {
    expect(evaluateGuess('masseter', 'masseter')).toBe('correct');
  });
  it('faux sinon', () => {
    expect(evaluateGuess('masseter', 'mandibule')).toBe('wrong');
  });
});
