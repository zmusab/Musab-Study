import { describe, expect, it } from 'vitest';
import { restoreCourseLayout } from '@/services/local/courseLayout';
import { chunkDocument } from '@/services/rag/chunking';
import { generateLocalCardDrafts } from '@/services/local/localFlashcards';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk } from '@/types';

/**
 * PLANCHER DE QUALITÉ, MESURÉ SUR DU VRAI COURS.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 * Mille soixante-treize tests passaient au vert, et l'utilisateur générait
 * ses cartes depuis son propre cours pour obtenir ceci :
 *
 *     « Qu'est-ce que Ensuite, par une branche du nerf facial qui ? »
 *     « De quoi se compose (sensitives) : ? »
 *     « Où se situe (qui rappelons-le ? »
 *     « De quoi se compose Remarque ? »
 *
 * Seize cartes sur vingt-six étaient inutilisables. Aucun test ne le voyait,
 * parce que TOUS travaillaient sur des phrases d'école — bien formées, bien
 * ponctuées, écrites pour le test. Un polycopié réel ne ressemble pas à ça :
 * il a des puces, des renvois de figure, des titres en capitales, des phrases
 * coupées par la mise en page.
 *
 * Le corpus ci-dessous est fait de LIGNES RÉELLES, reprises telles quelles du
 * cours « Divisions du nerf trijumeau » — y compris ses artefacts. Le test ne
 * vérifie pas qu'une carte précise sort : il vérifie qu'AUCUNE carte ne
 * ressemble aux quatre horreurs ci-dessus. C'est un plancher, pas un plafond.
 */

/** Lignes reprises telles quelles du polycopié, artefacts d'extraction compris. */
const REAL_COURSE = [
  'Le nerf ophtalmique de Willis',
  '• Il chemine par le canal le plus interne de Cavum Meckeli',
  '• Puis il entre dans le sillon carotidien où il est en rapport avec :',
  '§ L’artère carotide interne',
  '§ Le sinus caverneux',
  '§ Les nerf III, IV et VI',
  '• Le nerf ophtalmique de Willis se divise en 3 branches terminales :',
  '§ Nerf naso-cilliaire',
  '§ Nerf frontal',
  '§ Nerf lacrymal',
  '• Chaque branche du nerf trijumeau a attaché sur son trajet un ganglion nerveux :',
  '§ Sur trajet du nerf ophtalmique : ganglion ophtalmique',
  '§ Sur trajet du nerf maxillaire : ganglion sphéno-palatin',
  'Ensuite, par une branche du nerf facial qui est le grand pétreux superficiel, celui-ci transporte la fibre lacrymale.',
  'Les nerfs palatins (x 3 : antérieur, moyen postérieur) :',
  '→ ANTERIEUR : il descend au niveau de la cavité buccale par le grand canal palatin.',
  '→ MOYEN : il descend par un canal palatin accessoire.',
  'Remarque : Le nerf alvéolaire supérieur moyen peut exister.',
  'PS : dans la partie interne de la fosse orbitaire il y a la fossette trochléaire.',
  '4 muscles droits :',
  '§ Droit supérieur',
  '§ Droit inférieur',
  '§ Droit médial',
  '§ Droit latéral',
  '• Et 2 muscles obliques :',
  '§ Oblique supérieur ou Grand Oblique',
  '§ Oblique inférieur ou Petit Oblique',
  '(sensitives) :',
  '§ Une branche interne pour le septum nasal',
  '§ Une branche externe qui chemine sur le bord inférieur de l’os propre du nez',
].join('\n');

const LOOKUP: ContextLookup = {
  subjects: new Map([['s', { id: 's', name: 'Anatomie', color: '#000', createdAt: '', position: 0 }]]),
  chapters: new Map([['ch', { id: 'ch', subjectId: 's', name: 'Trijumeau', createdAt: '', position: 0 }]]),
  documents: new Map([['doc', { id: 'doc', name: 'trijumeau.pdf' }]]),
};

function cardsFromRealCourse() {
  const chunks: DocumentChunk[] = chunkDocument(restoreCourseLayout([REAL_COURSE]), []).map((draft, index) => ({
    ...draft, id: `c${index}`, documentId: 'doc', subjectId: 's', chapterId: 'ch', embedding: null,
  }));
  return generateLocalCardDrafts({
    chunks, lookup: LOOKUP, count: 40, importance: 2, difficulty: 2, existingQuestions: [],
  });
}

describe('qualité des cartes sur un vrai cours', () => {
  const cards = cardsFromRealCourse();

  it('produit quand même des cartes — s’abstenir de tout n’est pas une réussite', () => {
    expect(cards.length).toBeGreaterThanOrEqual(4);
  });

  /** Le sujet d'une carte est un NOM, jamais un morceau de phrase. */
  it('aucune question ne s’ouvre sur un connecteur ou un complément', () => {
    const bad = cards.filter((card) =>
      /\b(?:Ensuite|Et|Donc|Puis|Alors|Or|Mais|Car)\b\s|\b(?:Dans|Sur|Au niveau|Pour|Par)\s+(?:son|le|la|les|l’)/i.test(
        card.question,
      ),
    );
    expect(bad.map((c) => c.question)).toEqual([]);
  });

  it('aucune question ne contient de parenthèse ouverte sans sa fermeture', () => {
    const bad = cards.filter((card) => {
      const open = (card.question.match(/\(/g) ?? []).length;
      const close = (card.question.match(/\)/g) ?? []).length;
      return open !== close;
    });
    expect(bad.map((c) => c.question)).toEqual([]);
  });

  it('aucune question ne s’arrête sur un relatif en suspens', () => {
    const bad = cards.filter((card) => /\b(?:qui|que|dont|où|et|de|à)\s*\?\s*$/i.test(card.question));
    expect(bad.map((c) => c.question)).toEqual([]);
  });

  it('aucune question ne porte sur une étiquette de document', () => {
    const bad = cards.filter((card) => /\b(?:Remarque|PS|Schéma|Figure|MOYEN|ANTERIEUR|POSTERIEUR)\b/.test(card.question));
    expect(bad.map((c) => c.question)).toEqual([]);
  });

  it('aucune question ne garde une puce du document', () => {
    const bad = cards.filter((card) => /[•§▪‣◦▫→⇒]/.test(card.question));
    expect(bad.map((c) => c.question)).toEqual([]);
  });

  /**
   * LE CAS LE PLUS GRAVE : une carte JUSTE dans sa forme et FAUSSE dans son
   * contenu. « Et 2 muscles obliques » étant rejeté, le moteur reprenait le
   * dernier titre — « 4 muscles droits » — et rendait les muscles OBLIQUES en
   * réponse. L'étudiant apprend alors une erreur.
   */
  it('ne recolle jamais une liste au mauvais sujet', () => {
    const droits = cards.find((card) => /muscles droits/i.test(card.question));
    if (droits) {
      expect(droits.answer).toMatch(/Droit/);
      expect(droits.answer).not.toMatch(/Oblique/);
    }
  });

  /**
   * Vu à l'écran : « C'est un nerf sensitif. ET Il chemine par le canal
   * moyen du cavum Meckeli… ». Coordonner deux phrases complètes par « et »
   * ne produit pas une liste, ça produit une faute de français.
   */
  it('ne coordonne pas deux phrases entières par « et »', () => {
    const bad = cards.filter((card) => /[.!?]\s+et\s+[A-ZÀ-Þ]/.test(card.answer));
    expect(bad.map((c) => c.answer)).toEqual([]);
  });

  it('aucune réponse ne commence par un connecteur', () => {
    const bad = cards.filter((card) => /^(?:Donc|Ensuite|Puis|Alors|Or|Mais|Car)\b/i.test(card.answer.trim()));
    expect(bad.map((c) => c.answer)).toEqual([]);
  });
});
