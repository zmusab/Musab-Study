import { describe, expect, it } from 'vitest';
import palette from '@/data/anatomy/systemPalette.json';
import catalog from '@/data/anatomy/bodyCatalog.json';
import {
  SYSTEM_ORDER,
  groupBySystem,
  systemIdentity,
  systemKeyOf,
  systemOf,
  vesselType,
} from '@/services/anatomy/systemColors';
import type { AnatomyCategory } from '@/types';

/** Encodage sRGB standard — la conversion que fait le GPU en affichant un glTF. */
const encodeSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toHex = (linear: number[]) =>
  `#${linear.map((c) => Math.round(encodeSrgb(c) * 255).toString(16).padStart(2, '0').toUpperCase()).join('')}`;

interface CatalogEntry {
  id: string;
  name: string;
  category: AnatomyCategory;
  subregion: string | null;
  hasMesh: boolean;
}
const entries = catalog as CatalogEntry[];

describe('palette des systèmes', () => {
  it('le hex de chaque système est bien l’encodage sRGB de son triplet linéaire', () => {
    // C'est ce qui garantit que la pastille du DOM et le maillage du .glb
    // affichent la MÊME couleur : si quelqu'un touche l'un sans l'autre, ce
    // test tombe.
    for (const [key, entry] of Object.entries(palette.systems)) {
      expect(entry.hex, key).toBe(toHex(entry.linear));
    }
  });

  it('couvre tous les systèmes affichés, sans clé orpheline', () => {
    for (const key of SYSTEM_ORDER) expect(Object.keys(palette.systems)).toContain(key);
    expect(Object.keys(palette.systems).sort()).toEqual([...SYSTEM_ORDER].sort());
  });

  it('respecte la convention d’atlas : os ivoire, artère rouge, veine bleue', () => {
    const channel = (key: string, i: number) => (palette.systems as Record<string, { linear: number[] }>)[key]!.linear[i]!;
    expect(channel('os', 0)).toBeGreaterThan(channel('os', 2)); // ivoire : chaud
    expect(channel('os', 1)).toBeGreaterThan(0.5);
    expect(channel('arteres', 0)).toBeGreaterThan(channel('arteres', 2)); // rouge dominant
    expect(channel('veines', 2)).toBeGreaterThan(channel('veines', 0)); // bleu dominant
  });
});

describe('vesselType', () => {
  it('classe artères et veines d’après le nom réel', () => {
    expect(vesselType('Artère carotide interne droite')).toBe('artery');
    expect(vesselType('Veine jugulaire interne gauche')).toBe('vein');
    expect(vesselType('Aorte ascendante')).toBe('artery');
  });

  it('range le sinus coronaire parmi les veines malgré le mot « coronaire »', () => {
    // Piège réel du jeu de données : c'est le collecteur veineux du cœur.
    expect(vesselType('Sinus coronaire')).toBe('vein');
    expect(vesselType('Branches septales (coronaire droite) (ensemble)')).toBe('artery');
  });

  it('ne devine pas pour une structure qui n’est ni l’un ni l’autre', () => {
    expect(vesselType('Masséter')).toBeNull();
  });

  it('classe RÉELLEMENT tous les vaisseaux du catalogue, sans reste', () => {
    const vessels = entries.filter((e) => e.category === 'vaisseaux');
    expect(vessels.length).toBeGreaterThan(0);
    const unclassified = vessels.filter((e) => vesselType(e.name) === null);
    expect(unclassified.map((e) => e.name)).toEqual([]);
  });
});

describe('systemKeyOf', () => {
  it('sort les dents du squelette', () => {
    expect(systemKeyOf({ name: 'Dent 36', category: 'squelette', subregion: 'dents' })).toBe('dents');
    expect(systemKeyOf({ name: 'Mandibule', category: 'squelette', subregion: 'machoire' })).toBe('os');
  });

  it('scinde les vaisseaux en artères et veines', () => {
    expect(systemKeyOf({ name: 'Artère carotide commune droite', category: 'vaisseaux', subregion: 'cou' })).toBe('arteres');
    expect(systemKeyOf({ name: 'Veine jugulaire interne droite', category: 'vaisseaux', subregion: 'cou' })).toBe('veines');
  });

  it('donne à chaque structure du catalogue une identité connue', () => {
    for (const entry of entries) {
      const identity = systemOf(entry);
      expect(SYSTEM_ORDER, entry.name).toContain(identity.key);
      expect(identity.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(identity.label.length).toBeGreaterThan(1);
    }
  });

  it('donne la même teinte à une dent et à un os — même matériau source', () => {
    expect(systemIdentity('dents').hex).toBe(systemIdentity('os').hex);
  });
});

describe('groupBySystem', () => {
  const sample = [
    { name: 'Masséter', category: 'muscles' as const, subregion: 'machoire' },
    { name: 'Mandibule', category: 'squelette' as const, subregion: 'machoire' },
    { name: 'Dent 36', category: 'squelette' as const, subregion: 'dents' },
    { name: 'Veine jugulaire interne droite', category: 'vaisseaux' as const, subregion: 'cou' },
  ];

  it('respecte l’ordre de lecture et n’émet aucun groupe vide', () => {
    const groups = groupBySystem(sample);
    expect(groups.map((g) => g.system.key)).toEqual(['os', 'dents', 'muscles', 'veines']);
    for (const group of groups) expect(group.structures.length).toBeGreaterThan(0);
  });

  it('ne perd aucune structure', () => {
    const groups = groupBySystem(sample);
    expect(groups.reduce((n, g) => n + g.structures.length, 0)).toBe(sample.length);
  });
});
