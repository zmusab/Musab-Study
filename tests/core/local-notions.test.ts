import { describe, it, expect } from 'vitest';
import { generateLocalNotions, toNotion, localNotionsToNotions } from '@/services/local/localNotions';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk } from '@/types';

/**
 * `localNotions.ts` — notions de chapitre sans IA. `LocalNotion` est un type
 * propre (contrainte obligatoire) : ces tests vérifient d'abord le moteur en
 * lui-même, SANS jamais référencer `Notion`, puis séparément
 * l'adaptateur `toNotion`/`localNotionsToNotions`, appelé
 * seulement au moment de la persistance.
 */

function makeChunk(text: string, id = 'chk-1'): DocumentChunk {
  return {
    id,
    documentId: 'doc-1',
    chapterId: 'ch-1',
    subjectId: 'sub-1',
    index: 0,
    text,
    charStart: 0,
    charEnd: text.length,
    pageStart: 7,
    pageEnd: 7,
    termFreq: {},
    tokenCount: text.split(/\s+/).length,
    embedding: null,
  };
}

const LOOKUP: ContextLookup = {
  subjects: new Map([['sub-1', { id: 'sub-1', name: 'Histologie', color: '#000', createdAt: '', position: 0 }]]),
  chapters: new Map([['ch-1', { id: 'ch-1', subjectId: 'sub-1', name: 'Tissus durs', createdAt: '', position: 0 }]]),
  documents: new Map([['doc-1', { id: 'doc-1', name: 'Cours.pdf' }]]),
};

describe('generateLocalNotions', () => {
  it("produit une notion avec sa définition, sans dépendre d'aucune forme IA", () => {
    const chunk = makeChunk("L'émail dentaire est le tissu le plus minéralisé de l'organisme.");
    const notions = generateLocalNotions({ chunks: [chunk], count: 10 });
    expect(notions).toHaveLength(1);
    expect(notions[0]!.label).toBe("L'émail dentaire");
    expect(notions[0]!.definition).toContain('minéralisé');
    expect(notions[0]!.importance).toBe(3); // une définition explicite = notion importante
  });

  it('regroupe les faits qui portent sur le même sujet en une seule notion', () => {
    const chunk = makeChunk(
      "L'émail dentaire est le tissu le plus minéralisé de l'organisme. " +
        "L'émail dentaire se situe à la surface de la couronne.",
    );
    const notions = generateLocalNotions({ chunks: [chunk], count: 10 });
    expect(notions.filter((n) => n.label.toLowerCase().includes('émail'))).toHaveLength(1);
  });

  it('détecte un piège signalé dans une phrase séparée qui mentionne la même notion', () => {
    const chunk = makeChunk(
      'La deuxième prémolaire mandibulaire possède deux cuspides. ' +
        'Attention à ne pas confondre la deuxième prémolaire mandibulaire avec la première molaire.',
    );
    const notions = generateLocalNotions({ chunks: [chunk], count: 10 });
    const notion = notions.find((n) => n.label.toLowerCase().includes('prémolaire'));
    expect(notion).toBeDefined();
    expect(notion!.isPitfall).toBe(true);
  });

  it('ne marque pas une notion sans rapport comme un piège', () => {
    const chunk = makeChunk(
      "L'émail dentaire est le tissu le plus minéralisé de l'organisme. " +
        'Attention à ne pas confondre la deuxième prémolaire avec la première molaire.',
    );
    const notions = generateLocalNotions({ chunks: [chunk], count: 10 });
    const emailNotion = notions.find((n) => n.label.toLowerCase().includes('émail'));
    expect(emailNotion).toBeDefined();
    expect(emailNotion!.isPitfall).toBe(false);
  });

  it("ne produit aucune notion depuis une phrase à exception ou négation ambiguë", () => {
    const chunk = makeChunk('Tous les nerfs crâniens sont pairs, sauf le nerf trochléaire dans certaines classifications.');
    expect(generateLocalNotions({ chunks: [chunk], count: 10 })).toHaveLength(0);
  });

  it('respecte la limite demandée, en priorisant les notions les plus importantes', () => {
    const chunk = makeChunk(
      "L'émail est un tissu. La dentine est un tissu. La pulpe est un tissu. Le cément est un tissu.",
    );
    const notions = generateLocalNotions({ chunks: [chunk], count: 2 });
    expect(notions.length).toBeLessThanOrEqual(2);
  });

  it('renvoie un tableau vide sur un texte sans motif exploitable', () => {
    const chunk = makeChunk('Un patient se présente pour une consultation de routine.');
    expect(generateLocalNotions({ chunks: [chunk], count: 10 })).toHaveLength(0);
  });
});

describe('toNotion / localNotionsToNotions — adaptateur, appelé seulement à la persistance', () => {
  it('convertit une notion locale en Notion avec une citation vérifiable', () => {
    const chunk = makeChunk("L'émail dentaire est le tissu le plus minéralisé de l'organisme.");
    const [notion] = generateLocalNotions({ chunks: [chunk], count: 10 });
    const concept = toNotion(notion!, chunk, LOOKUP);

    expect(concept.label).toBe(notion!.label);
    expect(concept.importance).toBe(notion!.importance);
    expect(concept.citations).toHaveLength(1);
    expect(chunk.text.includes(concept.citations[0]!.excerpt)).toBe(true);
    expect(concept.id).toMatch(/^cpt/);
  });

  it('localNotionsToNotions retrouve le bon chunk source par id, même avec plusieurs chunks', () => {
    const chunkA = makeChunk("L'émail dentaire est le tissu le plus minéralisé de l'organisme.", 'chk-a');
    const chunkB = makeChunk('La dentine se compose de tubules dentinaires et de collagène.', 'chk-b');
    const notions = generateLocalNotions({ chunks: [chunkA, chunkB], count: 10 });

    const concepts = localNotionsToNotions(notions, [chunkA, chunkB], LOOKUP);
    expect(concepts).toHaveLength(notions.length);
    for (const concept of concepts) {
      expect(concept.citations[0]!.chunkId === 'chk-a' || concept.citations[0]!.chunkId === 'chk-b').toBe(true);
    }
  });

  it('ignore silencieusement une notion dont le chunk source est introuvable (défensif)', () => {
    const chunk = makeChunk("L'émail dentaire est le tissu le plus minéralisé de l'organisme.");
    const [notion] = generateLocalNotions({ chunks: [chunk], count: 10 });
    const concepts = localNotionsToNotions([notion!], [], LOOKUP);
    expect(concepts).toHaveLength(0);
  });
});
