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

  describe('pagination', () => {
    it('sans pageOffsets, les fragments ne portent aucun numéro de page', () => {
      for (const chunk of chunkDocument('Une phrase. '.repeat(300))) {
        expect(chunk.pageStart).toBeNull();
        expect(chunk.pageEnd).toBeNull();
      }
    });

    it('attribue à chaque fragment la page du PDF où il commence', () => {
      // Trois pages, chacune un paragraphe distinct — comme le produit
      // extractPdfText avec un pageOffsets aligné sur les sauts "\n\n".
      const page1 = 'Introduction au nerf trijumeau et à ses trois branches. '.repeat(3);
      const page2 = 'La branche ophtalmique V1 traverse la fissure orbitaire supérieure. '.repeat(3);
      const page3 = 'La branche mandibulaire V3 est la seule à porter des fibres motrices. '.repeat(3);
      const text = [page1, page2, page3].join('\n\n');
      const pageOffsets = [0, page1.length + 2, page1.length + 2 + page2.length + 2];

      const chunks = chunkDocument(text, pageOffsets);
      expect(chunks.length).toBeGreaterThan(0);

      const page1Chunks = chunks.filter((c) => c.charStart < pageOffsets[1]!);
      const page3Chunks = chunks.filter((c) => c.charStart >= pageOffsets[2]!);
      expect(page1Chunks.every((c) => c.pageStart === 1)).toBe(true);
      expect(page3Chunks.every((c) => c.pageStart === 3)).toBe(true);
    });
  });
});
