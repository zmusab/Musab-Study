import { describe, it, expect } from 'vitest';
import { joinTextItems } from '@/services/pdf/extract';

/**
 * `extractPdfText` lui-même a besoin d'un vrai PDF et du worker pdf.js — pas
 * testable en unitaire. `joinTextItems`, en revanche, est une fonction pure :
 * elle reçoit exactement ce que pdf.js renvoie (des fragments positionnés) et
 * décide où placer les sauts de ligne. C'est ELLE qui décide si un cours à
 * deux colonnes (fréquent sur des diapositives exportées en PDF) produit un
 * texte lisible ou un fragment incohérent — pas une OCR, qui n'existe nulle
 * part dans ce projet : l'extraction est TOUJOURS le texte natif du PDF.
 */

function item(str: string, x: number, y: number, hasEOL = false) {
  return { str, hasEOL, transform: [1, 0, 0, 1, x, y] };
}

describe('joinTextItems', () => {
  it('joint deux fragments de la même ligne par un espace', () => {
    const out = joinTextItems([item('Le nerf', 50, 700), item('trijumeau', 100, 700)]);
    expect(out).toBe('Le nerf trijumeau');
  });

  it('insère un simple saut de ligne pour un léger décalage vertical', () => {
    const out = joinTextItems([item('Première ligne', 50, 700), item('Deuxième ligne', 50, 688)]);
    expect(out).toBe('Première ligne\nDeuxième ligne');
  });

  it('insère un saut de paragraphe pour un grand décalage vertical', () => {
    const out = joinTextItems([item('Un titre', 50, 700), item('Un nouveau paragraphe', 50, 640)]);
    expect(out).toBe('Un titre\n\nUn nouveau paragraphe');
  });

  /**
   * LE cas réel visé : deux colonnes côte à côte, à la MÊME hauteur — le
   * profil exact d'une diapositive PDF à deux zones de texte. Sans détection
   * du recul horizontal, l'ancien code les collait avec un simple espace :
   * « …fin de la colonne de droite début de la colonne de gauche… », un seul
   * fragment incohérent, invérifiable, qui ressemble à s'y méprendre à une
   * mauvaise OCR alors qu'il n'y en a aucune ici.
   */
  it('détecte un changement de colonne (recul horizontal à hauteur constante) et sépare plutôt que coller', () => {
    const out = joinTextItems([
      item('Colonne de droite : fin de phrase.', 320, 700),
      item('Colonne de gauche : début de phrase.', 50, 700),
    ]);
    expect(out).toBe('Colonne de droite : fin de phrase.\nColonne de gauche : début de phrase.');
    expect(out).not.toContain('phrase. Colonne de gauche');
  });

  it('un léger recul horizontal (fin de ligne normale, justification) n’est PAS traité comme un changement de colonne', () => {
    // Un recul de quelques points est courant en fin de ligne justifiée —
    // seul un recul important, au-delà du seuil, doit déclencher une coupure.
    const out = joinTextItems([item('mot', 400, 700), item('suivant', 390, 700)]);
    expect(out).toBe('mot suivant');
  });

  it('respecte hasEOL en plus des sauts détectés par position', () => {
    const out = joinTextItems([item('Fin de ligne explicite', 50, 700, true), item('Suite', 50, 700)]);
    expect(out).toBe('Fin de ligne explicite\nSuite');
  });
});
