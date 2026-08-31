import { describe, it, expect } from 'vitest';
import { normalize, tokenize, termFrequencies } from '@/services/rag/tokenize';
import { chunkDocument, TARGET_CHUNK_CHARS } from '@/services/rag/chunking';

describe('normalize', () => {
  it('retire les accents pour que masséter trouve masseter', () => {
    expect(normalize('Masséter')).toBe('masseter');
    expect(normalize('Iași')).toBe('iasi');
    expect(normalize('MÂCHOIRE')).toBe('machoire');
  });
});

describe('tokenize', () => {
  it('écarte les mots outils français', () => {
    expect(tokenize('le muscle de la mâchoire')).toEqual(['muscle', 'machoire']);
  });

  it('conserve les termes courts de nomenclature (régression du prototype)', () => {
    // Le prototype ne gardait que les mots de plus de 3 lettres : « V3 » était perdu.
    expect(tokenize('branche V3 du nerf trijumeau')).toContain('v3');
  });

  it('ignore la ponctuation', () => {
    expect(tokenize('nerf trijumeau (V3), branche mandibulaire.')).toEqual([
      'nerf',
      'trijumeau',
      'v3',
      'branche',
      'mandibulaire',
    ]);
  });

  it('renvoie une liste vide pour du texte vide', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('termFrequencies', () => {
  it('compte les occurrences', () => {
    expect(termFrequencies(['nerf', 'nerf', 'muscle'])).toEqual({ nerf: 2, muscle: 1 });
  });
});

describe('chunkDocument', () => {
  it('ne produit rien pour un document vide', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('   \n  ')).toEqual([]);
  });

  it('garde un texte court en un seul fragment', () => {
    const chunks = chunkDocument('Le muscle masséter élève la mandibule.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain('masséter');
  });

  it('découpe un long document en plusieurs fragments bornés', () => {
    const paragraph = 'Le nerf trijumeau innerve la face et les muscles masticateurs. ';
    const chunks = chunkDocument(paragraph.repeat(200));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(TARGET_CHUNK_CHARS + 400);
    }
  });

  it('numérote les fragments séquentiellement à partir de 0', () => {
    const chunks = chunkDocument('Phrase anatomique. '.repeat(400));
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('pré-calcule les fréquences de termes de chaque fragment', () => {
    const chunks = chunkDocument('Le masséter est un muscle masticateur puissant.');
    expect(chunks[0]!.termFreq['masseter']).toBe(1);
    expect(chunks[0]!.tokenCount).toBeGreaterThan(0);
  });

  it('couvre tout le document : chaque phrase reste retrouvable', () => {
    const text = Array.from(
      { length: 60 },
      (_, i) => `Paragraphe numero ${i} sur la structure anatomique numero ${i}.`,
    ).join('\n\n');
    const joined = chunkDocument(text)
      .map((c) => c.text)
      .join(' ');
    expect(joined).toContain('numero 0');
    expect(joined).toContain('numero 59');
  });

  it('produit des bornes de caractères cohérentes', () => {
    for (const chunk of chunkDocument('Une phrase. '.repeat(300))) {
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
      expect(chunk.charStart).toBeGreaterThanOrEqual(0);
    }
  });
});
