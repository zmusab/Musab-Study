import { describe, expect, it } from 'vitest';
import { notionMastery, weakestNotions } from '@/core/notions/mastery';
import { buildFlashcard } from '@/data/repositories/cards';
import type { Flashcard } from '@/types';

/**
 * La chaîne cours → notion → carte → révision → maîtrise. Elle était rompue au
 * maillon notion → carte : l'application ne pouvait dire que « tu maîtrises la
 * carte n°123 », jamais « tu maîtrises le nerf trijumeau ».
 */

function card(overrides: Partial<Flashcard>): Flashcard {
  return {
    ...buildFlashcard({
      subjectId: 'sub-1',
      chapterId: 'ch-1',
      question: 'Q',
      answer: 'R',
    }),
    ...overrides,
  };
}

const TRIJUMEAU = { notionKey: 'le nerf trijumeau', notionLabel: 'Le nerf trijumeau' };
const MASSETER = { notionKey: 'le muscle masseter', notionLabel: 'Le muscle masséter' };

describe('notionMastery', () => {
  it('regroupe les cartes issues du même sujet de cours', () => {
    const result = notionMastery([card(TRIJUMEAU), card(TRIJUMEAU), card(MASSETER)]);
    expect(result).toHaveLength(2);
    expect(result.find((n) => n.key === 'le nerf trijumeau')?.cardCount).toBe(2);
  });

  it('affiche la formulation exacte du cours, pas la clé normalisée', () => {
    const result = notionMastery([card(TRIJUMEAU)]);
    expect(result[0]!.label).toBe('Le nerf trijumeau');
  });

  it('ignore les cartes sans notion — jamais rattachées en devinant', () => {
    const manual = card({ notionKey: null, notionLabel: null });
    expect(notionMastery([manual])).toHaveLength(0);
  });

  it('une notion jamais révisée n’a PAS 0 % — elle n’a pas de pourcentage du tout', () => {
    const result = notionMastery([card({ ...TRIJUMEAU, reps: 0, interval: 0 })]);
    expect(result[0]!.masteryPct).toBeNull();
    expect(result[0]!.reviewedCount).toBe(0);
  });

  it('moyenne la maîtrise sur les seules cartes réellement révisées', () => {
    const result = notionMastery([
      card({ ...TRIJUMEAU, reps: 4, interval: 60, ease: 2.6 }),
      card({ ...TRIJUMEAU, reps: 0, interval: 0 }),
    ]);
    expect(result[0]!.reviewedCount).toBe(1);
    expect(result[0]!.masteryPct).toBeGreaterThan(50);
  });

  it('compte les cartes réellement dues de la notion', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = notionMastery([
      card({ ...TRIJUMEAU, due: past }),
      card({ ...TRIJUMEAU, due: future }),
    ]);
    expect(result[0]!.dueCount).toBe(1);
  });

  it('classe les notions les plus fragiles en premier', () => {
    const result = notionMastery([
      card({ ...MASSETER, reps: 5, interval: 60, ease: 2.7 }),
      card({ ...TRIJUMEAU, reps: 1, interval: 1, ease: 1.4 }),
    ]);
    expect(result[0]!.key).toBe('le nerf trijumeau');
  });
});

describe('weakestNotions', () => {
  it('ne propose que des notions dont la faiblesse est MESURÉE', () => {
    const result = weakestNotions([
      card({ ...TRIJUMEAU, reps: 0, interval: 0 }),
      card({ ...MASSETER, reps: 2, interval: 3, ease: 1.5 }),
    ]);
    expect(result.map((n) => n.key)).toEqual(['le muscle masseter']);
  });

  it('respecte la limite demandée', () => {
    const cards = Array.from({ length: 10 }, (_, i) =>
      card({ notionKey: `notion-${i}`, notionLabel: `Notion ${i}`, reps: 2, interval: 3 }),
    );
    expect(weakestNotions(cards, 3)).toHaveLength(3);
  });
});

describe('chaîne complète : une carte générée localement porte sa notion', () => {
  it('le sujet extrait du cours devient la notion de la carte', async () => {
    const { generateLocalCardDrafts } = await import('@/services/local/localFlashcards');
    const text = 'Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.';
    const drafts = generateLocalCardDrafts({
      chunks: [
        {
          id: 'c1', documentId: 'd1', chapterId: 'ch1', subjectId: 's1', index: 0, text,
          charStart: 0, charEnd: text.length, pageStart: 1, pageEnd: 1, termFreq: {},
          tokenCount: 12, embedding: null,
        },
      ],
      lookup: {
        subjects: new Map([['s1', { id: 's1', name: 'A', color: '#000', createdAt: '', position: 0 }]]),
        chapters: new Map([['ch1', { id: 'ch1', subjectId: 's1', name: 'C', createdAt: '', position: 0 }]]),
        documents: new Map([['d1', { id: 'd1', name: 'Doc' }]]),
      },
      count: 5,
      importance: 2,
      difficulty: 2,
      existingQuestions: [],
    });

    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      expect(draft.notionKey).toBe('le nerf trijumeau');
      expect(draft.notionLabel).toBe('Le nerf trijumeau');
    }
  });
});
