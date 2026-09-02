import { describe, it, expect } from 'vitest';
import { validateNoteSummary, type RawNoteSummary } from '@/services/notes/summarize';

/**
 * « Résumer une note » (Assistant IA, catégorie Étudier) — même principe que
 * les flashcards générées depuis une note : un résumé n'est accepté que si
 * son extrait cité se retrouve VRAIMENT, mot pour mot, dans le texte réel de
 * la note.
 */

const NOTE_TEXT =
  'Le nerf trijumeau (V) est le cinquième nerf crânien. Il comporte trois branches : ophtalmique (V1), maxillaire (V2) et mandibulaire (V3). Seule la branche V3 est mixte, à la fois sensitive et motrice.';

describe('validateNoteSummary — jamais un résumé invérifiable', () => {
  it('accepte un résumé dont l’extrait existe mot pour mot dans la note', () => {
    const raw: RawNoteSummary = {
      summary: 'Le trijumeau est le Ve nerf crânien, avec trois branches dont seule V3 est mixte.',
      excerpt: 'Il comporte trois branches : ophtalmique (V1), maxillaire (V2) et mandibulaire (V3)',
    };
    const result = validateNoteSummary(raw, NOTE_TEXT);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain('trois branches');
  });

  it('rejette un résumé dont l’extrait n’apparaît pas dans la note', () => {
    const raw: RawNoteSummary = {
      summary: 'Résumé plausible mais invérifiable.',
      excerpt: 'ce passage n’existe pas dans la note',
    };
    expect(validateNoteSummary(raw, NOTE_TEXT)).toBeNull();
  });

  it('la comparaison ignore les différences d’espaces et de casse, jamais le contenu', () => {
    const raw: RawNoteSummary = {
      summary: 'La branche V3 est la seule mixte.',
      excerpt: '   SEULE   LA   BRANCHE   V3   EST   MIXTE  ',
    };
    expect(validateNoteSummary(raw, NOTE_TEXT)).not.toBeNull();
  });

  it('rejette un résumé sans texte ou sans extrait', () => {
    expect(validateNoteSummary({ summary: '', excerpt: 'trois branches' }, NOTE_TEXT)).toBeNull();
    expect(validateNoteSummary({ summary: 'Un résumé.', excerpt: '' }, NOTE_TEXT)).toBeNull();
    expect(validateNoteSummary({ summary: undefined, excerpt: 'trois branches' }, NOTE_TEXT)).toBeNull();
    expect(validateNoteSummary({ summary: 'Un résumé.', excerpt: undefined }, NOTE_TEXT)).toBeNull();
  });
});
