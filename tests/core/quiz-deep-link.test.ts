import { describe, it, expect } from 'vitest';
import { parseQuizDeepLink } from '@/core/quiz/deepLink';

/**
 * Lien direct vers le Quiz depuis l'Assistant IA — le principe testé ici :
 * ces paramètres ne font que choisir un `QuizScope` déjà compris par
 * `buildQuiz`, jamais une nouvelle façon de construire un quiz.
 */

describe('parseQuizDeepLink', () => {
  it('renvoie null sans scope reconnu', () => {
    expect(parseQuizDeepLink({})).toBeNull();
    expect(parseQuizDeepLink({ scope: 'inconnu' })).toBeNull();
  });

  it('scope "subject" exige un identifiant de matière', () => {
    expect(parseQuizDeepLink({ scope: 'subject' })).toBeNull();
    expect(parseQuizDeepLink({ scope: 'subject', subject: 's1' })).toEqual({
      scope: { kind: 'subject', subjectId: 's1' },
      format: 'mixed',
      count: 10,
      difficulty: 'mixed',
    });
  });

  it('scope "chapter" accepte un chapitre null (toute la matière n’est PAS ce scope)', () => {
    expect(parseQuizDeepLink({ scope: 'chapter', subject: 's1', chapter: 'c1' })).toEqual({
      scope: { kind: 'chapter', subjectId: 's1', chapterId: 'c1' },
      format: 'mixed',
      count: 10,
      difficulty: 'mixed',
    });
    expect(parseQuizDeepLink({ scope: 'chapter', subject: 's1' })).toEqual({
      scope: { kind: 'chapter', subjectId: 's1', chapterId: null },
      format: 'mixed',
      count: 10,
      difficulty: 'mixed',
    });
  });

  it('scope "weak" et "due" ne dépendent d’aucun paramètre supplémentaire', () => {
    expect(parseQuizDeepLink({ scope: 'weak' })?.scope).toEqual({ kind: 'weak' });
    expect(parseQuizDeepLink({ scope: 'due' })?.scope).toEqual({ kind: 'due' });
  });

  it('scope "exam" exige une matière', () => {
    expect(parseQuizDeepLink({ scope: 'exam' })).toBeNull();
    expect(parseQuizDeepLink({ scope: 'exam', subject: 's1' })?.scope).toEqual({ kind: 'exam', subjectId: 's1' });
  });

  it('scope "exam-likely" — chapitre unique optionnel, évaluation optionnelle', () => {
    expect(parseQuizDeepLink({ scope: 'exam-likely', subject: 's1' })?.scope).toEqual({
      kind: 'exam-likely',
      subjectId: 's1',
      chapterIds: [],
      evaluationEventId: null,
    });
    expect(
      parseQuizDeepLink({ scope: 'exam-likely', subject: 's1', chapter: 'c1', evaluation: 'ev1' })?.scope,
    ).toEqual({
      kind: 'exam-likely',
      subjectId: 's1',
      chapterIds: ['c1'],
      evaluationEventId: 'ev1',
    });
  });

  it('scope "cards" exige au moins un identifiant, ignore les entrées vides', () => {
    expect(parseQuizDeepLink({ scope: 'cards' })).toBeNull();
    expect(parseQuizDeepLink({ scope: 'cards', cards: '' })).toBeNull();
    expect(parseQuizDeepLink({ scope: 'cards', cards: 'a, b ,,c' })?.scope).toEqual({
      kind: 'cards',
      cardIds: ['a', 'b', 'c'],
    });
  });

  it('format et difficulté invalides retombent sur les valeurs par défaut, jamais une erreur', () => {
    const result = parseQuizDeepLink({ scope: 'weak', format: 'n’importe quoi', difficulty: 'n’importe quoi' });
    expect(result?.format).toBe('mixed');
    expect(result?.difficulty).toBe('mixed');
  });

  it('un nombre de questions est borné entre 3 et 30, avec 10 par défaut', () => {
    expect(parseQuizDeepLink({ scope: 'weak' })?.count).toBe(10);
    expect(parseQuizDeepLink({ scope: 'weak', count: '1' })?.count).toBe(3);
    expect(parseQuizDeepLink({ scope: 'weak', count: '999' })?.count).toBe(30);
    expect(parseQuizDeepLink({ scope: 'weak', count: 'abc' })?.count).toBe(10);
    expect(parseQuizDeepLink({ scope: 'weak', count: '7' })?.count).toBe(7);
  });

  it('accepte les formats et difficultés valides tels quels', () => {
    expect(parseQuizDeepLink({ scope: 'due', format: 'qcm', difficulty: 'hard' })).toEqual({
      scope: { kind: 'due' },
      format: 'qcm',
      count: 10,
      difficulty: 'hard',
    });
    expect(parseQuizDeepLink({ scope: 'due', format: 'vf' })?.format).toBe('vf');
  });
});
