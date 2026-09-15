import { describe, expect, it } from 'vitest';
import { pickRepresentative } from '@/services/anatomy/representative';
import type { AnatomyStructure } from '@/types';

const make = (id: string, name: string, mesh: boolean, category = 'squelette'): AnatomyStructure => ({
  id,
  name,
  latinName: '',
  category: category as AnatomyStructure['category'],
  subjectId: null,
  model3dRef: mesh ? `mesh_${id}` : null,
  region: 'tete-et-cou',
  subregion: 'crane',
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('choix de la vignette représentative d’un groupe', () => {
  it('ne choisit jamais une structure sans maillage', () => {
    const only = [make('a', 'Palais osseux', false)];
    expect(pickRepresentative(only, () => true)).toBeNull();
  });

  it('préfère une structure sans latéralité', () => {
    const list = [make('a', 'Os frontal droit', true), make('b', 'Vomer profond', true)];
    expect(pickRepresentative(list, () => true)?.id).toBe('b');
  });

  it('préfère le nom le plus court à latéralité égale', () => {
    const list = [make('a', 'Os occipital', true), make('b', 'Vomer', true)];
    expect(pickRepresentative(list, () => true)?.id).toBe('b');
  });

  it('départage deux noms de même longueur alphabétiquement, donc de façon stable', () => {
    const list = [make('a', 'Sphénoïde', true), make('b', 'Ethmoïdes', true)];
    expect(pickRepresentative(list, () => true)?.id).toBe('b');
    expect(pickRepresentative([...list].reverse(), () => true)?.id).toBe('b');
  });

  it('respecte le filtre du groupe', () => {
    const list = [make('a', 'Vomer', true, 'squelette'), make('b', 'Masséter', true, 'muscles')];
    expect(pickRepresentative(list, (s) => s.category === 'muscles')?.id).toBe('b');
  });

  it('renvoie null pour un groupe vide plutôt que d’inventer une vignette', () => {
    expect(pickRepresentative([], () => true)).toBeNull();
  });
});
