import { describe, it, expect } from 'vitest';
import { isPlausibleSubject, isPlausibleAnswerText } from '@/services/local/textQuality';
import { extractFacts } from '@/services/local/relationExtraction';
import { generateLocalCardDrafts } from '@/services/local/localFlashcards';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk } from '@/types';

/**
 * Filtre qualité — corrige le signalement utilisateur : des artefacts de
 * mise en page PDF (numérotation de liste, flèches de schéma, repères de
 * figure) devenaient des « sujets » de flashcards (« Qu'est-ce que II ? »).
 * Ces tests couvrent exactement les exemples signalés, PLUS le chemin
 * complet `extractFacts`/`generateLocalCardDrafts` pour prouver qu'aucune
 * carte inutilisable n'en sort — pas seulement le validateur isolé.
 */

describe('isPlausibleSubject — rejette les artefacts signalés', () => {
  it.each(['II', 'III', 'IV', 'IX', '→', "C'", 'A', '1', '12', '→ C\'', '', '   '])(
    'rejette « %s »',
    (subject) => {
      expect(isPlausibleSubject(subject)).toBe(false);
    },
  );

  it('rejette un sujet trop long (capture ratée, pas un vrai terme)', () => {
    expect(isPlausibleSubject('a'.repeat(90))).toBe(false);
  });

  it('rejette un sujet majoritairement fait de chiffres/symboles', () => {
    expect(isPlausibleSubject('12.3.4 §')).toBe(false);
  });
});

describe('isPlausibleSubject — accepte les vrais sujets anatomiques', () => {
  it.each([
    'Le nerf trijumeau',
    'La dent',
    'Le muscle masséter',
    "L'émail dentaire",
    'Le nerf V3',
    'La glande parotide',
  ])('accepte « %s »', (subject) => {
    expect(isPlausibleSubject(subject)).toBe(true);
  });

  it('rejette un code isolé sans terme réel qui l’accompagne (« V3 » seul) — même logique que « II » seul', () => {
    // Une extraction réelle capture toujours le terme qui accompagne le code
    // ("le nerf V3"), jamais le code seul — ce cas confirme que le
    // validateur reste cohérent avec « II », « A », « 1 » plutôt que de
    // faire une exception fragile pour les codes alphanumériques.
    expect(isPlausibleSubject('V3')).toBe(false);
  });
});

describe('isPlausibleAnswerText', () => {
  it('rejette une réponse réduite à un symbole ou un chiffre', () => {
    expect(isPlausibleAnswerText('→')).toBe(false);
    expect(isPlausibleAnswerText('2')).toBe(false);
    expect(isPlausibleAnswerText('')).toBe(false);
  });

  it('accepte une réponse réellement exploitable', () => {
    expect(isPlausibleAnswerText('trois branches principales')).toBe(true);
  });
});

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
    pageStart: 5,
    pageEnd: 5,
    termFreq: {},
    tokenCount: text.split(/\s+/).length,
    embedding: null,
  };
}

const LOOKUP: ContextLookup = {
  subjects: new Map([['sub-1', { id: 'sub-1', name: 'Anatomie', color: '#000', createdAt: '', position: 0 }]]),
  chapters: new Map([['ch-1', { id: 'ch-1', subjectId: 'sub-1', name: 'Chapitre', createdAt: '', position: 0 }]]),
  documents: new Map([['doc-1', { id: 'doc-1', name: 'Cours.pdf' }]]),
};

describe('extractFacts — les artefacts PDF ne produisent plus aucun fait', () => {
  it('« II est composé de 2 parties. » — sujet uniquement un chiffre romain, aucun fait produit', () => {
    const chunk = makeChunk('II est composé de 2 parties.');
    expect(extractFacts(chunk)).toHaveLength(0);
  });

  it('« → C\' : représente le point de fixation. » — sujet uniquement une flèche et un repère de figure', () => {
    const chunk = makeChunk("→ C' : représente le point de fixation.");
    expect(extractFacts(chunk)).toHaveLength(0);
  });

  it('« A est une structure. » — sujet réduit à une seule lettre', () => {
    const chunk = makeChunk('A est une structure.');
    expect(extractFacts(chunk)).toHaveLength(0);
  });
});

describe("generateLocalCardDrafts — ne produit jamais de carte depuis un artefact PDF (bout en bout)", () => {
  it('un chapitre mêlant artefacts et vrai contenu ne génère que des cartes exploitables', () => {
    const chunk = makeChunk(
      'II est composé de 2 parties. ' +
        "→ C' : représente le point de fixation. " +
        '1 est un repère. ' +
        'Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.',
    );
    const drafts = generateLocalCardDrafts({
      chunks: [chunk],
      lookup: LOOKUP,
      count: 10,
      importance: 2,
      difficulty: 2,
      existingQuestions: [],
    });

    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      expect(draft.question).not.toMatch(/Qu'est-ce que (II|→|C'|A|1|III|IV) ?\??$/i);
      expect(draft.question.toLowerCase()).not.toContain('qu’est-ce que ii');
      expect(draft.question.toLowerCase()).not.toContain('qu’est-ce que →');
    }
    expect(drafts.some((d) => d.answer.toLowerCase().includes('ophtalmique'))).toBe(true);
  });

  it('un chapitre ne contenant QUE des artefacts ne génère aucune carte — jamais une carte inutilisable plutôt que rien', () => {
    const chunk = makeChunk("II est composé de 2 parties. → C' : représente le point de fixation. A est une structure.");
    const drafts = generateLocalCardDrafts({
      chunks: [chunk],
      lookup: LOOKUP,
      count: 10,
      importance: 2,
      difficulty: 2,
      existingQuestions: [],
    });
    expect(drafts).toHaveLength(0);
  });
});

/**
 * Défauts constatés sur un vrai cours d'anatomie, en regardant les cartes
 * réellement produites (pas en imaginant des cas) : un sujet anaphorique et un
 * sujet qui avait avalé toute la proposition.
 */
describe('isPlausibleSubject — sujets inutilisables hors contexte', () => {
  it.each([
    'Son innervation motrice',
    'Sa contraction',
    'Ses branches',
    'Leur insertion',
    'Il',
    'Elle',
    'Cette structure',
    'Ce muscle',
    'Cela',
  ])('rejette le sujet anaphorique « %s » — l’antécédent n’existe plus sur la carte', (subject) => {
    expect(isPlausibleSubject(subject)).toBe(false);
  });

  it.each([
    'Il se compose de deux faisceaux',
    'Le nerf trijumeau possède trois branches',
    'La dentine comprend des tubuli',
  ])('rejette « %s » : c’est une proposition, pas un sujet', (subject) => {
    expect(isPlausibleSubject(subject)).toBe(false);
  });

  it('accepte toujours un vrai groupe nominal', () => {
    expect(isPlausibleSubject('Le muscle masséter')).toBe(true);
    expect(isPlausibleSubject('L’émail dentaire')).toBe(true);
  });
});

describe('generateLocalCardDrafts — qualité sur un cours réel', () => {
  const REAL = makeChunk(
    'Le muscle masséter est un muscle masticateur puissant et superficiel. ' +
      'Il se compose de deux faisceaux : un faisceau superficiel et un faisceau profond. ' +
      'Son innervation motrice est assurée par le nerf massétérique. ' +
      'Le nerf trijumeau possède trois branches : le nerf ophtalmique, le nerf maxillaire et le nerf mandibulaire. ' +
      'L’émail est le tissu le plus minéralisé de l’organisme.',
  );

  const drafts = generateLocalCardDrafts({
    chunks: [REAL],
    lookup: LOOKUP,
    count: 12,
    importance: 2,
    difficulty: 2,
    existingQuestions: [],
  });

  it('ne produit plus aucune carte au sujet anaphorique', () => {
    for (const draft of drafts) {
      expect(draft.question).not.toMatch(/Qu'est-ce que (Son|Sa|Ses|Il|Elle|Ce|Cette)\b/i);
    }
  });

  it('ne produit plus de question à double verbe', () => {
    for (const draft of drafts) {
      expect(draft.question).not.toMatch(/De quoi se compose .*se compose/i);
    }
  });

  it('n’insère jamais un déterminant capitalisé au milieu d’une question', () => {
    for (const draft of drafts) {
      expect(draft.question).not.toMatch(/que (Le|La|Les|L['’]|Un|Une|Des) /);
    }
  });

  it('garde les cartes réellement exploitables', () => {
    expect(drafts.length).toBeGreaterThanOrEqual(3);
    expect(drafts.some((d) => /muscle masséter/i.test(d.question))).toBe(true);
    expect(drafts.some((d) => /trijumeau/i.test(d.question))).toBe(true);
  });
});
