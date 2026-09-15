import { describe, it, expect } from 'vitest';
import { structuresInSubregion, summarizeSubregions, subregionMeta } from '@/services/anatomy/regions';
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

describe('subregionMeta', () => {
  it('retrouve le libellé réel d’une sous-région connue', () => {
    expect(subregionMeta('machoire')?.label).toBe('Mâchoire et bouche');
  });
  it('renvoie null pour une sous-région inconnue ou absente — jamais inventée', () => {
    expect(subregionMeta('inexistante')).toBeNull();
    expect(subregionMeta(null)).toBeNull();
  });
});

describe('structuresInSubregion', () => {
  it('filtre et trie par nom', () => {
    const list = [
      structure({ id: 'b', name: 'Bêta', subregion: 'crane' }),
      structure({ id: 'a', name: 'Alpha', subregion: 'crane' }),
      structure({ id: 'c', name: 'Gamma', subregion: 'cou' }),
    ];
    expect(structuresInSubregion(list, 'crane').map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('summarizeSubregions', () => {
  it('ne compte que les sous-régions réellement peuplées, avec le vrai nombre de structures avec/sans maillage', () => {
    const list = [
      structure({ id: 'a', subregion: 'crane', model3dRef: 'a' }),
      structure({ id: 'b', subregion: 'crane', model3dRef: null }),
    ];
    const summary = summarizeSubregions(list);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.id).toBe('crane');
    expect(summary[0]!.structureCount).toBe(2);
    expect(summary[0]!.meshCount).toBe(1);
  });

  it('n’affiche aucune sous-région vide', () => {
    expect(summarizeSubregions([])).toEqual([]);
  });
});
