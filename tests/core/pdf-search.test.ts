import { describe, it, expect } from 'vitest';
import { searchDocumentText } from '@/services/pdf/search';
import { pageAtOffset } from '@/services/pdf/pages';

describe('pageAtOffset', () => {
  it('trouve la page contenant un offset donné', () => {
    const offsets = [0, 100, 250];
    expect(pageAtOffset(0, offsets)).toBe(1);
    expect(pageAtOffset(50, offsets)).toBe(1);
    expect(pageAtOffset(100, offsets)).toBe(2);
    expect(pageAtOffset(249, offsets)).toBe(2);
    expect(pageAtOffset(250, offsets)).toBe(3);
    expect(pageAtOffset(9999, offsets)).toBe(3);
  });

  it("renvoie la page 1 pour un document sans pagination", () => {
    expect(pageAtOffset(500, [])).toBe(1);
  });
});

describe('searchDocumentText', () => {
  const page1 = 'Le nerf trijumeau possède trois branches principales.';
  const page2 = 'La branche mandibulaire porte des fibres motrices.';
  const text = [page1, page2].join('\n\n');
  const pageOffsets = [0, page1.length + 2];

  it('renvoie une liste vide pour une requête vide', () => {
    expect(searchDocumentText(text, pageOffsets, '')).toEqual([]);
  });

  it('trouve un terme et sa page', () => {
    const matches = searchDocumentText(text, pageOffsets, 'mandibulaire');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.page).toBe(2);
  });

  it('ignore les accents et la casse', () => {
    const matches = searchDocumentText(text, pageOffsets, 'TRIJUMEAU');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.page).toBe(1);
  });

  it('trouve toutes les occurrences, dans l’ordre du texte', () => {
    const repeated = 'branche '.repeat(3);
    const matches = searchDocumentText(repeated, [0], 'branche');
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.charOffset)).toEqual([0, 8, 16]);
  });

  it('ne trouve rien pour un terme absent', () => {
    expect(searchDocumentText(text, pageOffsets, 'radioactivité')).toEqual([]);
  });

  it('respecte la limite demandée', () => {
    const repeated = 'x '.repeat(100);
    expect(searchDocumentText(repeated, [0], 'x', 5)).toHaveLength(5);
  });
});
