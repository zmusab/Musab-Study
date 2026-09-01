import { describe, expect, it } from 'vitest';
import catalog from '@/data/anatomy/headNeckCatalog.json';
import manifest from '@/data/anatomy/assetManifest.json';
import { assetKey, SUBREGIONS, DEFAULT_LOADED_SUBREGIONS } from '@/services/anatomy/regions';

interface Entry {
  id: string;
  name: string;
  latinName: string | null;
  category: string;
  region: string;
  subregion: string;
  fmaId: string | null;
  hasMesh: boolean;
  triangles: number;
  sourceLabel: string | null;
  fdi?: number;
}
interface Group {
  key: string;
  subregion: string;
  category: string;
  structures: number;
  triangles: number;
}

const entries = catalog as Entry[];
const groups = manifest as Group[];
const meshed = entries.filter((e) => e.hasMesh);
const groupKeys = new Set(groups.map((g) => g.key));

/**
 * Le catalogue et le manifeste sont GÉNÉRÉS depuis les données BodyParts3D.
 * Ces tests vérifient l'invariant qui compte vraiment : rien n'est présenté
 * comme disponible en 3D sans qu'un asset correspondant existe réellement, et
 * inversement rien de réellement disponible n'est perdu en route.
 */
describe('catalogue Anatomie généré depuis BodyParts3D', () => {
  it('ne présente aucune structure comme maillée sans groupe d’assets correspondant', () => {
    const orphans = meshed.filter((e) => !groupKeys.has(assetKey(e.subregion, e.category)));
    expect(orphans.map((o) => `${o.id} → ${assetKey(o.subregion, o.category)}`)).toEqual([]);
  });

  it('ne déclare aucun groupe d’assets vide de structures', () => {
    const counts = new Map<string, number>();
    for (const e of meshed) {
      const key = assetKey(e.subregion, e.category);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const g of groups) expect(counts.get(g.key), `groupe ${g.key}`).toBe(g.structures);
  });

  it('donne un maillage réel et un identifiant FMA à toute structure annoncée en 3D', () => {
    for (const e of meshed) {
      expect(e.fmaId, `${e.id} sans identifiant FMA`).toBeTruthy();
      expect(e.triangles, `${e.id} sans triangles`).toBeGreaterThan(0);
      expect(e.sourceLabel, `${e.id} sans libellé source`).toBeTruthy();
    }
  });

  it('n’attribue ni triangle ni FMA aux structures « cours » (aucune géométrie inventée)', () => {
    for (const e of entries.filter((x) => !x.hasMesh)) {
      expect(e.triangles, `${e.id}`).toBe(0);
      expect(e.fmaId, `${e.id}`).toBeNull();
    }
  });

  it('n’utilise que des sous-régions déclarées', () => {
    const known = new Set(SUBREGIONS.map((s) => s.id));
    for (const e of entries) expect(known.has(e.subregion), `${e.id} → ${e.subregion}`).toBe(true);
  });

  it('exclut l’encéphale du chargement par défaut, mais le garde disponible', () => {
    expect(DEFAULT_LOADED_SUBREGIONS).not.toContain('encephale');
    expect(SUBREGIONS.some((s) => s.id === 'encephale')).toBe(true);
    expect(meshed.some((e) => e.subregion === 'encephale')).toBe(true);
  });

  it('conserve les 28 dents permanentes de la source, numérotées en FDI', () => {
    const teeth = entries.filter((e) => typeof e.fdi === 'number');
    expect(teeth).toHaveLength(28);
    // Les dents de sagesse (x8) sont ABSENTES du jeu de données : elles ne
    // doivent donc jamais apparaître comme disponibles.
    expect(teeth.map((t) => t.fdi).filter((n) => n! % 10 === 8)).toEqual([]);
    for (const t of teeth) expect(t.hasMesh).toBe(true);
  });

  it('exploite nettement plus de géométrie que la version simplifiée précédente', () => {
    const triangles = meshed.reduce((sum, e) => sum + e.triangles, 0);
    // Repère de non-régression : la version d'avant livrait 74 structures et
    // 250 608 triangles après une simplification destructive.
    expect(meshed.length).toBeGreaterThan(200);
    expect(triangles).toBeGreaterThan(4_000_000);
  });

  it('ne contient aucun identifiant en double', () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
