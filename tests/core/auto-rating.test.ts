import { describe, expect, it } from 'vitest';
import { answerTimeBudgetMs, deriveRating } from '@/core/revisions/autoRating';
import { evaluateAnswer } from '@/core/revisions/evaluateAnswer';
import { scheduleNext } from '@/core/srs';

/**
 * La note SM-2 n'est plus RÉCLAMÉE à l'étudiant mais DÉDUITE de sa réponse et
 * du temps qu'il a mis. Ces tests verrouillent les deux propriétés qui
 * comptent : la déduction est cohérente, et elle s'abstient quand elle ne peut
 * pas trancher plutôt que d'inventer une note.
 */

const SHORT = 'Environ 22 mm';
const LONG = 'Le nerf trijumeau est sensitif et moteur, et possède trois branches principales';

describe('answerTimeBudgetMs', () => {
  it('accorde plus de temps à une réponse plus longue', () => {
    expect(answerTimeBudgetMs(LONG)).toBeGreaterThan(answerTimeBudgetMs(SHORT));
  });

  it('reste borné : une réponse démesurée ne donne pas un budget infini', () => {
    expect(answerTimeBudgetMs('mot '.repeat(500))).toBeLessThanOrEqual(120_000);
  });
});

describe('deriveRating', () => {
  it('une réponse incorrecte programme un rappel immédiat', () => {
    const result = deriveRating('incorrect', 5_000, SHORT);
    expect(result?.rating).toBe(0);
    expect(result?.confidence).toBe('low');
  });

  it('une réponse incomplète vaut « Difficile », jamais un échec total', () => {
    expect(deriveRating('partial', 5_000, SHORT)?.rating).toBe(1);
  });

  it('une réponse correcte et rapide vaut « Facile »', () => {
    const result = deriveRating('correct', 3_000, SHORT);
    expect(result?.rating).toBe(3);
    expect(result?.confidence).toBe('high');
  });

  it('la même réponse correcte, mais laborieuse, vaut seulement « Bien »', () => {
    const slow = answerTimeBudgetMs(SHORT) + 1_000;
    expect(deriveRating('correct', slow, SHORT)?.rating).toBe(2);
  });

  it('s’abstient quand le moteur d’évaluation n’a pas pu trancher', () => {
    expect(deriveRating('indeterminate', 5_000, SHORT)).toBeNull();
  });

  it('donne toujours une raison lisible — une note muette serait pire que la question qu’elle remplace', () => {
    for (const verdict of ['correct', 'partial', 'incorrect'] as const) {
      expect(deriveRating(verdict, 5_000, SHORT)?.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('chaîne complète : réponse écrite → note → planification SM-2', () => {
  const QUESTION = 'Qu’est-ce que le nerf trijumeau ?';
  const EXPECTED = 'Le nerf trijumeau est sensitif et moteur';
  // Carte COMPLÈTE : `scheduleNext` lit aussi `due` (retard), `importance` et
  // `difficulty` — un objet partiel produisait une date invalide.
  const CARD = {
    ease: 2.5,
    interval: 6,
    reps: 2,
    lapses: 0,
    due: new Date().toISOString(),
    lastReview: new Date().toISOString(),
    importance: 2 as const,
    difficulty: 2 as const,
  };

  const ratingFor = (attempt: string, elapsedMs: number) => {
    const { verdict } = evaluateAnswer(attempt, EXPECTED, QUESTION);
    return deriveRating(verdict, elapsedMs, EXPECTED);
  };

  it('une bonne réponse rapide ESPACE réellement la carte', () => {
    const auto = ratingFor('Il est sensitif et moteur', 4_000)!;
    const next = scheduleNext(CARD, auto.rating, auto.confidence);
    expect(next.interval).toBeGreaterThan(CARD.interval);
  });

  it('une réponse fausse RAPPROCHE réellement la carte', () => {
    const auto = ratingFor('Jsp', 4_000)!;
    expect(auto.rating).toBe(0);
    const next = scheduleNext(CARD, auto.rating, auto.confidence);
    expect(next.interval).toBeLessThan(CARD.interval);
  });

  it('une contradiction est traitée comme une erreur, pas comme une réponse partielle', () => {
    const auto = ratingFor('Le nerf trijumeau est uniquement sensitif', 4_000)!;
    expect(auto.rating).toBe(0);
  });

  it('une réponse incomplète rapproche la carte sans la remettre à zéro', () => {
    const auto = ratingFor('Il est sensitif', 4_000)!;
    expect(auto.rating).toBe(1);
  });
});

describe('autoRating — n’importe jamais la couche IA', () => {
  it('ne dépend d’aucun module aiOrchestrator/services/ai', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'src/core/revisions/autoRating.ts'), 'utf-8');
    expect(/aiOrchestrator/.test(source)).toBe(false);
    expect(/services\/ai\//.test(source)).toBe(false);
  });
});
