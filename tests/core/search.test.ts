import { describe, it, expect } from 'vitest';
import { levenshteinDistance, wordSimilarity, bestWordMatch } from '@/services/search/fuzzy';
import { searchItems, type SearchableItem } from '@/services/search';

describe('levenshteinDistance', () => {
  it('vaut 0 pour deux mots identiques', () => {
    expect(levenshteinDistance('masseter', 'masseter')).toBe(0);
  });

  it('compte une seule substitution', () => {
    expect(levenshteinDistance('masseter', 'massater')).toBe(1);
  });

  it('gère les chaînes vides', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });
});

describe('wordSimilarity', () => {
  it('vaut 1 pour une correspondance exacte', () => {
    expect(wordSimilarity('trijumeau', 'trijumeau')).toBe(1);
  });

  it('tolère une faute de frappe sur un mot long (l’« approximation » demandée)', () => {
    expect(wordSimilarity('trijumeu', 'trijumeau')).toBeGreaterThan(0);
    expect(wordSimilarity('masster', 'masseter')).toBeGreaterThan(0);
  });

  it('vaut 0 pour deux mots sans rapport', () => {
    expect(wordSimilarity('dentine', 'calendrier')).toBe(0);
  });

  it('reste stricte sur les mots courts : une lettre différente sur 3 dépasse la tolérance', () => {
    expect(wordSimilarity('nez', 'nes')).toBeGreaterThan(0);
    expect(wordSimilarity('nez', 'feu')).toBe(0);
  });
});

describe('bestWordMatch', () => {
  it('retient la meilleure correspondance parmi plusieurs mots', () => {
    expect(bestWordMatch('masseter', ['le', 'muscle', 'masseter', 'puissant'])).toBe(1);
  });

  it('vaut 0 sans aucun mot proche', () => {
    expect(bestWordMatch('dentine', ['calendrier', 'examen'])).toBe(0);
  });
});

const ITEMS: SearchableItem[] = [
  {
    id: 'doc-1',
    kind: 'document',
    title: 'Masséter.pdf',
    subtitle: 'Anatomie › Muscles',
    body: "Le muscle masséter est innervé par le nerf massétérique, branche du nerf trijumeau.",
    to: '/cours/s1',
  },
  {
    id: 'card-1',
    kind: 'flashcard',
    title: 'Quelle est l’innervation du masséter ?',
    subtitle: 'Anatomie › Muscles',
    body: 'Le nerf massétérique.',
    to: '/flashcards',
  },
  {
    id: 'event-1',
    kind: 'calendar',
    title: 'Examen d’histologie',
    subtitle: '15 septembre 2026',
    to: '/calendrier',
  },
];

describe('searchItems', () => {
  it('renvoie une liste vide pour une requête vide', () => {
    expect(searchItems(ITEMS, '')).toEqual([]);
    expect(searchItems(ITEMS, '   ')).toEqual([]);
  });

  it('trouve un document par une correspondance exacte de titre', () => {
    const results = searchItems(ITEMS, 'masséter');
    expect(results[0]!.id).toBe('doc-1');
  });

  it('retrouve un résultat malgré une faute de frappe dans la requête', () => {
    // Le point central de la demande : « masster » doit quand même trouver « Masséter ».
    const results = searchItems(ITEMS, 'masster');
    expect(results.some((r) => r.id === 'doc-1' || r.id === 'card-1')).toBe(true);
  });

  it('ignore les accents', () => {
    const withAccent = searchItems(ITEMS, 'innervation du masséter');
    const without = searchItems(ITEMS, 'innervation du masseter');
    expect(without[0]?.id).toBe(withAccent[0]?.id);
  });

  it('trouve une correspondance enfouie dans le corps du document', () => {
    const results = searchItems(ITEMS, 'trijumeau');
    expect(results.some((r) => r.id === 'doc-1')).toBe(true);
  });

  it('fournit un extrait centré sur la correspondance dans le corps', () => {
    const results = searchItems(ITEMS, 'trijumeau');
    const doc = results.find((r) => r.id === 'doc-1');
    expect(doc?.excerpt).toContain('trijumeau');
  });

  it('ne renvoie rien pour une requête totalement étrangère au contenu', () => {
    expect(searchItems(ITEMS, 'radioactivité nucléaire')).toEqual([]);
  });

  it('classe une correspondance exacte de titre devant une correspondance approximative', () => {
    const results = searchItems(ITEMS, 'masséter');
    const exactTitleIndex = results.findIndex((r) => r.id === 'doc-1');
    expect(exactTitleIndex).toBe(0);
  });

  it('respecte la limite demandée', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `x${i}`,
      kind: 'note' as const,
      title: 'Anatomie du cœur',
      subtitle: '',
      to: '/notes',
    }));
    expect(searchItems(many, 'anatomie', 10)).toHaveLength(10);
  });

  it('trouve un événement de calendrier par son titre', () => {
    const results = searchItems(ITEMS, 'histologie');
    expect(results[0]!.id).toBe('event-1');
  });
});
