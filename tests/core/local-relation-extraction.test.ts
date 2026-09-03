import { describe, it, expect } from 'vitest';
import { extractFacts } from '@/services/local/relationExtraction';
import type { DocumentChunk } from '@/types';

/**
 * `relationExtraction.ts` — cœur du moteur pédagogique local. Chaque test
 * vérifie deux choses : (1) le motif attendu est bien détecté avec le bon
 * sujet/objet, et (2) `sourceExcerpt` reste TOUJOURS un sous-extrait exact
 * du texte source — la garantie de vérifiabilité qui remplace la
 * vérification par citation `[Sn]` du chemin IA.
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
    pageStart: 3,
    pageEnd: 3,
    termFreq: {},
    tokenCount: text.split(/\s+/).length,
    embedding: null,
  };
}

/** Chaque fait extrait doit être un sous-extrait exact du texte source — jamais reformulé. */
function expectExactExcerpt(chunk: DocumentChunk, excerpt: string) {
  expect(chunk.text.includes(excerpt)).toBe(true);
}

describe('extractFacts — motifs positifs', () => {
  it("détecte une possession avec énumération et compte explicite (exemple du trijumeau)", () => {
    const chunk = makeChunk(
      'Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.',
    );
    const facts = extractFacts(chunk);
    const fact = facts.find((f) => f.predicate === 'possession');
    expect(fact).toBeDefined();
    expect(fact!.subject).toBe('Le nerf trijumeau');
    expect(fact!.items).toEqual(['ophtalmique', 'maxillaire', 'mandibulaire']);
    expect(fact!.countWord).toBe('trois');
    expect(fact!.countNoun).toBe('branches');
    expect(fact!.confidence).not.toBe('low');
    expectExactExcerpt(chunk, fact!.sourceExcerpt);
  });

  it('détecte une définition', () => {
    const chunk = makeChunk("L'émail dentaire est le tissu le plus minéralisé de l'organisme.");
    const facts = extractFacts(chunk);
    const fact = facts.find((f) => f.predicate === 'definition');
    expect(fact).toBeDefined();
    expect(fact!.subject).toBe("L'émail dentaire");
    expect(fact!.object).toContain('tissu le plus minéralisé');
    expectExactExcerpt(chunk, fact!.sourceExcerpt);
  });

  it('détecte une composition', () => {
    const chunk = makeChunk('La dent se compose de trois tissus : émail, dentine et pulpe.');
    const facts = extractFacts(chunk);
    const fact = facts.find((f) => f.predicate === 'composition');
    expect(fact).toBeDefined();
    expect(fact!.subject).toBe('La dent');
    expect(fact!.items).toEqual(['émail', 'dentine', 'pulpe']);
    expectExactExcerpt(chunk, fact!.sourceExcerpt);
  });

  it('détecte une fonction', () => {
    const chunk = makeChunk('La glande parotide produit une grande partie de la salive.');
    const facts = extractFacts(chunk);
    const fact = facts.find((f) => f.predicate === 'function');
    expect(fact).toBeDefined();
    expect(fact!.subject).toBe('La glande parotide');
    expectExactExcerpt(chunk, fact!.sourceExcerpt);
  });

  it('détecte une localisation', () => {
    const chunk = makeChunk('Le foramen ovale se situe dans la grande aile du sphénoïde.');
    const facts = extractFacts(chunk);
    const fact = facts.find((f) => f.predicate === 'location');
    expect(fact).toBeDefined();
    expect(fact!.subject).toBe('Le foramen ovale');
    expectExactExcerpt(chunk, fact!.sourceExcerpt);
  });

  it('détecte une classification numérotée', () => {
    const chunk = makeChunk(
      'Il existe trois types de dentine : primaire, secondaire et tertiaire.',
    );
    const facts = extractFacts(chunk);
    const fact = facts.find((f) => f.predicate === 'classification');
    expect(fact).toBeDefined();
    expect(fact!.items).toEqual(['primaire', 'secondaire', 'tertiaire']);
    expectExactExcerpt(chunk, fact!.sourceExcerpt);
  });

  it('détecte une liste inline sans verbe reconnu (dernier recours)', () => {
    const chunk = makeChunk('Les muscles masticateurs : masséter, temporal, ptérygoïdien médial et ptérygoïdien latéral.');
    const facts = extractFacts(chunk);
    const fact = facts.find((f) => f.items && f.items.length === 4);
    expect(fact).toBeDefined();
    expect(fact!.confidence).toBe('medium');
    expectExactExcerpt(chunk, fact!.sourceExcerpt);
  });

  it('détecte une énumération à puces avec sa ligne d’introduction', () => {
    const chunk = makeChunk(
      'Les os de la face comprennent :\n- le maxillaire\n- la mandibule\n- les os nasaux',
    );
    const facts = extractFacts(chunk);
    const fact = facts.find((f) => f.items?.includes('la mandibule'));
    expect(fact).toBeDefined();
    expect(fact!.items).toEqual(['le maxillaire', 'la mandibule', 'les os nasaux']);
  });
});

describe('extractFacts — abstention sur négations et exceptions (contrainte obligatoire)', () => {
  it('traite une négation propre à une seule clause comme un fait négatif explicite, jamais comme une carte positive', () => {
    const chunk = makeChunk('Le nerf trochléaire ne possède pas de branche sensitive.');
    const facts = extractFacts(chunk);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.object).toContain('ne possède pas');
    expect(facts[0]!.confidence).toBe('medium'); // jamais 'high' pour une négation
    expectExactExcerpt(chunk, facts[0]!.sourceExcerpt);
  });

  it('écarte totalement une phrase à exception ("sauf") — jamais transformée en fait', () => {
    const chunk = makeChunk('Tous les nerfs crâniens sont pairs, sauf le nerf trochléaire dans certaines classifications.');
    const facts = extractFacts(chunk);
    expect(facts).toHaveLength(0);
  });

  it('écarte une phrase avec "contrairement à"', () => {
    const chunk = makeChunk('Contrairement à la canine, la première prémolaire possède deux cuspides.');
    const facts = extractFacts(chunk);
    expect(facts).toHaveLength(0);
  });

  it('écarte une phrase avec "à l’exception de"', () => {
    const chunk = makeChunk('Toutes les molaires possèdent trois racines, à l’exception de la deuxième molaire mandibulaire.');
    const facts = extractFacts(chunk);
    expect(facts).toHaveLength(0);
  });

  it('écarte une négation composée trop incertaine pour un motif propre', () => {
    const chunk = makeChunk(
      "Le nerf facial n'innerve pas directement les muscles masticateurs, ce rôle étant réservé au nerf trijumeau.",
    );
    const facts = extractFacts(chunk);
    expect(facts).toHaveLength(0);
  });

  it('écarte une phrase avec "mais pas"', () => {
    const chunk = makeChunk('Le maxillaire participe à la mastication mais pas à la phonation dans ce modèle simplifié.');
    const facts = extractFacts(chunk);
    expect(facts).toHaveLength(0);
  });

  it('écarte une phrase avec "hormis"', () => {
    const chunk = makeChunk('Toutes les dents temporaires tombent, hormis certains cas de rétention.');
    const facts = extractFacts(chunk);
    expect(facts).toHaveLength(0);
  });
});

describe('extractFacts — confiance dégradée sans rejet (qualificatifs)', () => {
  it('abaisse la confiance sans rejeter pour une phrase qualifiée ("généralement")', () => {
    const chunk = makeChunk('La deuxième molaire mandibulaire présente généralement quatre cuspides.');
    const facts = extractFacts(chunk);
    const fact = facts.find((f) => f.predicate === 'possession');
    expect(fact).toBeDefined();
    expect(fact!.confidence).toBe('medium');
  });
});

describe('extractFacts — robustesse sur texte non structuré', () => {
  it("ne produit rien sur un texte sans motif reconnaissable, plutôt que d'inventer", () => {
    const chunk = makeChunk('Un patient consulte pour une douleur diffuse depuis plusieurs jours.');
    expect(extractFacts(chunk)).toHaveLength(0);
  });

  it('gère un chunk vide sans erreur', () => {
    expect(extractFacts(makeChunk(''))).toHaveLength(0);
  });

  it('chaque excerpt produit sur un texte à plusieurs phrases reste un sous-extrait exact', () => {
    const text =
      "L'émail est le tissu le plus dur de l'organisme. La dentine se compose de tubules dentinaires. " +
      'La pulpe possède des vaisseaux et des nerfs. Le cément se situe au niveau de la racine.';
    const chunk = makeChunk(text);
    const facts = extractFacts(chunk);
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) expectExactExcerpt(chunk, fact.sourceExcerpt);
  });
});
