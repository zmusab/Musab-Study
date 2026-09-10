import { describe, it, expect } from 'vitest';
import {
  generateNoteCardDraftsLocally,
  validateNoteCardDrafts,
  type RawNoteCardDraft,
} from '@/services/notes/flashcards';

/**
 * « Créer des flashcards avec l'IA » depuis une note — le principe testé
 * partout ici : une proposition n'est acceptée que si son extrait cité se
 * retrouve VRAIMENT, mot pour mot, dans le texte réel de la note. Rien de
 * plausible-mais-invérifiable ne doit atteindre l'utilisateur.
 */

const NOTE_TEXT =
  'Le nerf trijumeau (V) est le cinquième nerf crânien. Il comporte trois branches : ophtalmique (V1), maxillaire (V2) et mandibulaire (V3). Seule la branche V3 est mixte, à la fois sensitive et motrice.';

describe('validateNoteCardDrafts — jamais une réponse invérifiable', () => {
  it('accepte une proposition dont l’extrait existe mot pour mot dans la note', () => {
    const raw: RawNoteCardDraft[] = [
      {
        question: 'Combien de branches comporte le nerf trijumeau ?',
        answer: 'Trois : ophtalmique, maxillaire et mandibulaire.',
        excerpt: 'Il comporte trois branches : ophtalmique (V1), maxillaire (V2) et mandibulaire (V3)',
      },
    ];
    const drafts = validateNoteCardDrafts(raw, NOTE_TEXT, 5);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.question).toContain('branches');
  });

  it('rejette une proposition dont l’extrait n’apparaît pas dans la note', () => {
    const raw: RawNoteCardDraft[] = [
      {
        question: 'Quel est le rôle du nerf facial ?',
        answer: 'La motricité de la face.',
        excerpt: 'Le nerf facial innerve les muscles de la mimique',
      },
    ];
    expect(validateNoteCardDrafts(raw, NOTE_TEXT, 5)).toEqual([]);
  });

  it('la comparaison ignore les différences d’espaces et de casse, jamais le contenu', () => {
    const raw: RawNoteCardDraft[] = [
      {
        question: 'Quelle branche du trijumeau est mixte ?',
        answer: 'La branche V3 (mandibulaire).',
        excerpt: '   SEULE   LA   BRANCHE   V3   EST   MIXTE  ',
      },
    ];
    expect(validateNoteCardDrafts(raw, NOTE_TEXT, 5)).toHaveLength(1);
  });

  it('rejette une proposition sans question, sans réponse ou sans extrait', () => {
    const raw: RawNoteCardDraft[] = [
      { question: '', answer: 'Une réponse.', excerpt: 'trois branches' },
      { question: 'Une question ?', answer: '', excerpt: 'trois branches' },
      { question: 'Une question ?', answer: 'Une réponse.', excerpt: '' },
      { question: undefined, answer: 'Une réponse.', excerpt: 'trois branches' },
    ];
    expect(validateNoteCardDrafts(raw, NOTE_TEXT, 5)).toEqual([]);
  });

  it('respecte la limite demandée même si plus de propositions valides existent', () => {
    const raw: RawNoteCardDraft[] = [
      { question: 'Q1', answer: 'R1', excerpt: 'nerf trijumeau' },
      { question: 'Q2', answer: 'R2', excerpt: 'cinquième nerf crânien' },
      { question: 'Q3', answer: 'R3', excerpt: 'trois branches' },
    ];
    expect(validateNoteCardDrafts(raw, NOTE_TEXT, 2)).toHaveLength(2);
  });

  it('un tableau vide (note jugée insuffisante par le modèle) reste un tableau vide, jamais fabriqué', () => {
    expect(validateNoteCardDrafts([], NOTE_TEXT, 5)).toEqual([]);
  });

  it('n’accepte que les extraits réellement présents parmi un mélange valides/invalides', () => {
    const raw: RawNoteCardDraft[] = [
      { question: 'Vraie', answer: 'Réponse vraie', excerpt: 'cinquième nerf crânien' },
      { question: 'Fausse', answer: 'Réponse inventée', excerpt: 'ce passage n’existe pas dans la note' },
    ];
    const drafts = validateNoteCardDrafts(raw, NOTE_TEXT, 5);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.question).toBe('Vraie');
  });
});

/**
 * LE CHEMIN PAR DÉFAUT — depuis une note, sans clé.
 *
 * Générer des cartes depuis une NOTE était la dernière action à exiger une
 * clé API, alors que le faire depuis un COURS est local depuis longtemps :
 * deux portes voisines pour le même geste, une seule fermée.
 *
 * Ce qui est vérifié ici est la garantie qui compte, la même que celle imposée
 * au chemin IA : l'extrait affiché doit se retrouver MOT POUR MOT dans la
 * note. Ici elle est vraie par construction — rien n'est réécrit — et ces
 * tests tombent le jour où ce ne serait plus le cas.
 */
describe('generateNoteCardDraftsLocally — sans IA', () => {
  it('tire des cartes de la note, sans le moindre appel réseau', () => {
    const drafts = generateNoteCardDraftsLocally(
      { id: 'n1', subjectId: 's1', chapterId: null, title: 'Trijumeau', text: NOTE_TEXT } as never,
      5,
    );
    expect(drafts.length).toBeGreaterThan(0);
  });

  it('n’affiche que des extraits réellement présents dans la note', () => {
    const drafts = generateNoteCardDraftsLocally(
      { id: 'n1', subjectId: 's1', chapterId: null, title: 'Trijumeau', text: NOTE_TEXT } as never,
      5,
    );
    for (const draft of drafts) {
      expect(NOTE_TEXT.toLowerCase()).toContain(draft.excerpt.toLowerCase());
    }
  });

  it('ne propose rien plutôt que du vide sur un texte sans relation exploitable', () => {
    const drafts = generateNoteCardDraftsLocally(
      { id: 'n2', subjectId: 's1', chapterId: null, title: 'Vide', text: 'aaa bbb ccc ddd eee fff.' } as never,
      5,
    );
    expect(drafts).toEqual([]);
  });
});
