import { describe, it, expect } from 'vitest';
import { validateConcepts, validateSegments, hasSubstantiveContent } from '@/services/podcast/validate';
import type { RetrievedContext } from '@/services/rag/retrieval';

const CONTEXT: RetrievedContext = {
  text: '[S1] …\n\n---\n\n[S2] …',
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
    },
  ],
};

describe('validateConcepts', () => {
  it('accepte une notion correctement sourcée', () => {
    const concepts = validateConcepts(
      [{ label: 'Innervation du masséter', importance: 3, pitfall: false, refs: ['S1'] }],
      CONTEXT,
      5,
    );
    expect(concepts).toHaveLength(1);
    expect(concepts[0]!.citations).toHaveLength(1);
    expect(concepts[0]!.importance).toBe(3);
  });

  it('rejette une notion sans la moindre référence valide', () => {
    // Le cas critique : le modèle propose une notion plausible mais ne peut
    // la rattacher à aucun extrait réellement transmis.
    const concepts = validateConcepts(
      [{ label: 'Notion inventée', importance: 2, pitfall: false, refs: ['S9'] }],
      CONTEXT,
      5,
    );
    expect(concepts).toHaveLength(0);
  });

  it('rejette une notion sans aucune référence', () => {
    const concepts = validateConcepts([{ label: 'Sans source', refs: [] }], CONTEXT, 5);
    expect(concepts).toHaveLength(0);
  });

  it('ignore les entrées sans libellé exploitable', () => {
    const concepts = validateConcepts([{ label: '', refs: ['S1'] }, { refs: ['S1'] }], CONTEXT, 5);
    expect(concepts).toHaveLength(0);
  });

  it('respecte la limite demandée', () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({
      label: `Notion ${i}`,
      refs: ['S1'],
    }));
    expect(validateConcepts(raw, CONTEXT, 3)).toHaveLength(3);
  });

  it('ramène une importance hors bornes à la valeur neutre', () => {
    const concepts = validateConcepts([{ label: 'X', importance: 99, refs: ['S1'] }], CONTEXT, 5);
    expect(concepts[0]!.importance).toBe(2);
  });
});

describe('validateSegments', () => {
  it('accepte une réplique de cours correctement sourcée', () => {
    const segments = validateSegments(
      [{ speaker: 'B', type: 'concept', source: 'cours', text: 'Il est innervé par le V3 [S1].' }],
      CONTEXT,
      false,
    );
    expect(segments[0]!.provenance).toBe('course');
    expect(segments[0]!.citations).toHaveLength(1);
  });

  it('marque « insuffisant » une réplique factuelle sans source valide', () => {
    // Le cas dangereux : une affirmation posée avec assurance mais invérifiable.
    const segments = validateSegments(
      [{ speaker: 'B', type: 'explanation', source: 'cours', text: 'Il est innervé par le nerf facial.' }],
      CONTEXT,
      false,
    );
    expect(segments[0]!.provenance).toBe('insufficient');
    expect(segments[0]!.citations).toEqual([]);
  });

  it('n’exige pas de source pour une introduction ou un exemple fictif', () => {
    const segments = validateSegments(
      [
        { speaker: 'A', type: 'intro', source: 'none', text: 'Aujourd’hui on parle du masséter.' },
        { speaker: 'B', type: 'example', source: 'none', text: 'Imagine un patient qui serre les dents.' },
      ],
      CONTEXT,
      false,
    );
    expect(segments.every((s) => s.provenance === null)).toBe(true);
  });

  it('rétrograde une réplique internet quand le mode internet n’est pas activé', () => {
    // Ne jamais faire confiance à la seule déclaration du modèle pour la
    // provenance : le drapeau applicatif fait autorité, pas le JSON reçu.
    const segments = validateSegments(
      [{ speaker: 'B', type: 'explanation', source: 'internet', text: 'Un point complémentaire.' }],
      CONTEXT,
      false,
    );
    expect(segments[0]!.provenance).toBe('insufficient');
  });

  it('accepte une réplique internet quand le mode est activé', () => {
    const segments = validateSegments(
      [{ speaker: 'B', type: 'explanation', source: 'internet', text: 'Un point complémentaire.' }],
      CONTEXT,
      true,
    );
    expect(segments[0]!.provenance).toBe('internet');
  });

  it('retire les références inventées du texte affiché', () => {
    const segments = validateSegments(
      [{ speaker: 'A', type: 'concept', source: 'cours', text: 'Vrai [S1], et ceci [S7].' }],
      CONTEXT,
      false,
    );
    expect(segments[0]!.text).not.toContain('[S7]');
    expect(segments[0]!.text).toContain('[S1]');
    expect(segments[0]!.provenance).toBe('course');
  });

  it('ignore les répliques sans texte ou sans locuteur reconnu', () => {
    const segments = validateSegments(
      [
        { speaker: 'C', type: 'concept', text: 'Locuteur invalide.' },
        { speaker: 'A', type: 'concept', text: '' },
      ],
      CONTEXT,
      false,
    );
    expect(segments).toHaveLength(0);
  });

  it('retombe sur un type par défaut si le type est absent ou invalide', () => {
    const segments = validateSegments(
      [{ speaker: 'A', type: 'blabla', source: 'none', text: 'Texte quelconque.' }],
      CONTEXT,
      false,
    );
    expect(segments[0]!.type).toBe('explanation');
  });

  it('calcule une durée estimée positive pour chaque réplique', () => {
    const segments = validateSegments(
      [{ speaker: 'A', type: 'intro', source: 'none', text: 'Bonjour et bienvenue.' }],
      CONTEXT,
      false,
    );
    expect(segments[0]!.estimatedDurationSec).toBeGreaterThan(0);
  });
});

describe('hasSubstantiveContent', () => {
  it('est faux si aucune réplique n’est sourcée par le cours', () => {
    const segments = validateSegments(
      [{ speaker: 'A', type: 'intro', source: 'none', text: 'Bonjour.' }],
      CONTEXT,
      false,
    );
    expect(hasSubstantiveContent(segments)).toBe(false);
  });

  it('est vrai dès qu’une réplique de contenu est sourcée', () => {
    const segments = validateSegments(
      [{ speaker: 'B', type: 'concept', source: 'cours', text: 'Fait vérifiable [S1].' }],
      CONTEXT,
      false,
    );
    expect(hasSubstantiveContent(segments)).toBe(true);
  });
});
