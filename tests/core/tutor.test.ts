import { describe, it, expect } from 'vitest';
import {
  extractReferences,
  verifyCourseAnswer,
  verifyInternetAnswer,
  INSUFFICIENT_MARKER,
} from '@/services/ai/tutor';
import type { RetrievedContext } from '@/services/rag/retrieval';

const CONTEXT: RetrievedContext = {
  text: '[S1] Anatomie › Muscles › Masséter.pdf\nLe masséter est innervé par le nerf massétérique.',
  sources: [
    {
      ref: 'S1',
      chunkId: 'chk-1',
      documentId: 'doc-1',
      documentName: 'Masséter.pdf',
      chapterId: 'ch-1',
      chapterName: 'Muscles',
      subjectName: 'Anatomie',
      excerpt: 'Le masséter est innervé par le nerf massétérique.',
      page: null,
    },
    {
      ref: 'S2',
      chunkId: 'chk-2',
      documentId: 'doc-1',
      documentName: 'Masséter.pdf',
      chapterId: 'ch-1',
      chapterName: 'Muscles',
      subjectName: 'Anatomie',
      excerpt: "Il s'insère sur l'arcade zygomatique.",
      page: null,
    },
  ],
};

const EMPTY: RetrievedContext = { text: '', sources: [] };

describe('extractReferences', () => {
  it('extrait les références citées', () => {
    expect(extractReferences('Réponse [S1] et suite [S2].')).toEqual(['S1', 'S2']);
  });

  it('ne renvoie chaque référence qu’une fois', () => {
    expect(extractReferences('[S1] blabla [S1]')).toEqual(['S1']);
  });

  it('ne renvoie rien sans citation', () => {
    expect(extractReferences('Une réponse sans source.')).toEqual([]);
  });
});

describe('verifyCourseAnswer — le cœur de la garantie', () => {
  it('accepte une réponse correctement sourcée', () => {
    const result = verifyCourseAnswer('Le nerf massétérique, issu du V3 [S1].', CONTEXT);
    expect(result.provenance).toBe('course');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]!.documentName).toBe('Masséter.pdf');
  });

  it('respecte le marqueur d’insuffisance du modèle', () => {
    const result = verifyCourseAnswer(INSUFFICIENT_MARKER, CONTEXT);
    expect(result.provenance).toBe('insufficient');
    expect(result.citations).toEqual([]);
  });

  it('tolère la ponctuation autour du marqueur', () => {
    expect(verifyCourseAnswer('  INSUFFISANT. ', CONTEXT).provenance).toBe('insufficient');
  });

  it('REFUSE une réponse plausible mais sans aucune source', () => {
    // Le scénario le plus dangereux : le modèle répond de mémoire, avec
    // assurance, sans rien citer. Le prototype l'aurait affiché tel quel,
    // présenté comme venant du cours.
    const result = verifyCourseAnswer(
      "Le masséter est innervé par le nerf facial, qui contrôle aussi l'expression.",
      CONTEXT,
    );
    expect(result.provenance).toBe('insufficient');
    expect(result.citations).toEqual([]);
    expect(result.text).not.toContain('nerf facial');
  });

  it('REFUSE une réponse qui n’invoque que des sources inexistantes', () => {
    const result = verifyCourseAnswer('Réponse affirmée [S9].', CONTEXT);
    expect(result.provenance).toBe('insufficient');
    expect(result.invalidReferences).toEqual(['S9']);
  });

  it('conserve les sources valides et retire les inventées', () => {
    const result = verifyCourseAnswer('Vrai [S1], et ceci aussi [S7].', CONTEXT);
    expect(result.provenance).toBe('course');
    expect(result.citations.map((c) => c.chunkId)).toEqual(['chk-1']);
    expect(result.invalidReferences).toEqual(['S7']);
    expect(result.text).not.toContain('[S7]');
    expect(result.text).toContain('[S1]');
  });

  it('refuse toute réponse quand aucun extrait n’a été transmis', () => {
    // Sans contexte, aucune référence ne peut être valide : il est
    // structurellement impossible de faire passer une réponse pour du cours.
    const result = verifyCourseAnswer('Réponse très assurée [S1].', EMPTY);
    expect(result.provenance).toBe('insufficient');
  });

  it('refuse une réponse vide', () => {
    expect(verifyCourseAnswer('   ', CONTEXT).provenance).toBe('insufficient');
  });

  it('produit une citation par référence distincte', () => {
    const result = verifyCourseAnswer('Innervation [S1], insertion [S2].', CONTEXT);
    expect(result.citations.map((c) => c.chunkId)).toEqual(['chk-1', 'chk-2']);
  });
});

describe('verifyInternetAnswer', () => {
  it('marque la réponse comme provenant d’internet', () => {
    const result = verifyInternetAnswer('Ton cours dit [S1].\n\n🌐 Complément internet : …', CONTEXT);
    expect(result.provenance).toBe('internet');
    expect(result.citations).toHaveLength(1);
  });

  it('accepte une réponse sans citation de cours', () => {
    // En mode internet, l'absence de source de cours est légitime — ce qui
    // compte est que rien ne soit faussement attribué au cours.
    const result = verifyInternetAnswer('🌐 Complément internet : …', CONTEXT);
    expect(result.provenance).toBe('internet');
    expect(result.citations).toEqual([]);
  });

  it('retire les références de cours inventées', () => {
    const result = verifyInternetAnswer('Selon ton cours [S5], …', CONTEXT);
    expect(result.text).not.toContain('[S5]');
    expect(result.invalidReferences).toEqual(['S5']);
  });

  it('signale une réponse vide comme une erreur, pas comme une réponse', () => {
    expect(verifyInternetAnswer('  ', CONTEXT).provenance).toBe('error');
  });
});
