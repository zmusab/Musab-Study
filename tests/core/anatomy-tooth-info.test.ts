import { describe, expect, it } from 'vitest';
import { toothInfo, structureProvenance } from '@/services/anatomy/toothInfo';
import { BODY_CATALOG } from '@/data/repositories/anatomy';

const teeth = BODY_CATALOG.filter((e) => typeof e.fdi === 'number');

describe('fiche dentaire dérivée du numéro FDI', () => {
  it('décrit chaque dent réellement présente au catalogue', () => {
    expect(teeth.length).toBeGreaterThan(0);
    for (const tooth of teeth) {
      const info = toothInfo(tooth.id);
      expect(info, tooth.id).not.toBeNull();
      expect(info!.fdi).toBe(tooth.fdi);
    }
  });

  it('place les quadrants 1 et 2 au maxillaire, 3 et 4 à la mandibule', () => {
    for (const tooth of teeth) {
      const info = toothInfo(tooth.id)!;
      const expected = info.quadrant <= 2 ? 'Maxillaire (supérieure)' : 'Mandibulaire (inférieure)';
      expect(info.arcade, `dent ${info.fdi}`).toBe(expected);
    }
  });

  it('met les quadrants 1 et 4 à droite, 2 et 3 à gauche', () => {
    for (const tooth of teeth) {
      const info = toothInfo(tooth.id)!;
      const expected = info.quadrant === 1 || info.quadrant === 4 ? 'Droite' : 'Gauche';
      expect(info.side, `dent ${info.fdi}`).toBe(expected);
    }
  });

  it('nomme le type d’après le rang sur l’arcade', () => {
    const byFdi = new Map(teeth.map((t) => [t.fdi as number, toothInfo(t.id)!]));
    expect(byFdi.get(11)?.type).toBe('Incisive centrale');
    expect(byFdi.get(13)?.type).toBe('Canine');
    expect(byFdi.get(36)?.type).toBe('Première molaire');
    expect(byFdi.get(47)?.type).toBe('Deuxième molaire');
  });

  it('ne fabrique pas de fiche dentaire pour une structure qui n’est pas une dent', () => {
    expect(toothInfo('mandibule')).toBeNull();
    expect(toothInfo('structure-inexistante')).toBeNull();
  });
});

describe('provenance d’une structure', () => {
  it('rend le libellé source et la géométrie réelle de toute structure maillée', () => {
    const meshed = BODY_CATALOG.filter((e) => e.hasMesh).slice(0, 50);
    for (const entry of meshed) {
      const provenance = structureProvenance(entry.id)!;
      expect(provenance.sourceLabel, entry.id).toBeTruthy();
      expect(provenance.triangles, entry.id).toBeGreaterThan(0);
      expect(provenance.hasMesh).toBe(true);
    }
  });

  it('n’attribue aucune géométrie à une structure « cours »', () => {
    for (const entry of BODY_CATALOG.filter((e) => !e.hasMesh)) {
      const provenance = structureProvenance(entry.id)!;
      expect(provenance.triangles, entry.id).toBe(0);
      expect(provenance.hasMesh).toBe(false);
    }
  });

  it('renvoie null pour un identifiant inconnu plutôt qu’une provenance inventée', () => {
    expect(structureProvenance('nimporte-quoi')).toBeNull();
  });
});
