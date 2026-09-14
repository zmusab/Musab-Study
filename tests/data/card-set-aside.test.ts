import { describe, it, expect, beforeEach } from 'vitest';
import { db, clearAllData } from '@/data/db';
import { createSubject } from '@/data/repositories/subjects';
import {
  buryCard,
  countAllDueCards,
  countDueCards,
  createFlashcard,
  listAllDueCards,
  listDueCards,
  reviewCardUndoable,
  setCardSuspended,
  unburyCard,
  undoReview,
} from '@/data/repositories/cards';
import { buryUntil, isBuried, isReviewable, isSuspended } from '@/core/srs';
import type { QuizScope } from '@/core/quiz';
import type { Flashcard, ID } from '@/types';

/**
 * ANNULER, SUSPENDRE, ENTERRER — les trois gestes qu'Anki a et qui manquaient.
 *
 * Ce qui est vérifié ici n'est pas qu'un bouton existe, mais que chaque geste
 * laisse la base dans un état EXACT :
 *  - annuler restaure la planification au bit près ET retire la ligne de
 *    journal, donc les statistiques de progression ne gardent pas la trace
 *    d'une réponse annulée ;
 *  - suspendre et enterrer ne touchent NI `due` NI `ease` — seule la
 *    visibilité change, ce qui est la condition pour qu'une carte réactivée
 *    reprenne son historique là où il s'était arrêté ;
 *  - les compteurs comptent la même chose que la file, sinon le tableau de
 *    bord annonce des cartes que la session n'ouvrira pas.
 */

let subjectId: ID;

const newCard = (question: string) =>
  createFlashcard({ subjectId, chapterId: null, question, answer: `Réponse à ${question}` });

beforeEach(async () => {
  await clearAllData();
  subjectId = (await createSubject('Anatomie', '#7c9a8e')).id;
});

describe('annuler la dernière réponse', () => {
  it('restaure la planification au bit près et retire la ligne de journal', async () => {
    const card = await newCard('Combien de racines a la 46 ?');
    const before = await db.flashcards.get(card.id);

    const review = await reviewCardUndoable(card.id, 3, 'high', 4200);
    const after = await db.flashcards.get(card.id);
    // Épreuve préalable : sans elle, un « restauré » trivial passerait aussi.
    expect(after!.due).not.toBe(before!.due);
    expect(after!.reps).toBe(1);
    expect(await db.reviewLogs.count()).toBe(1);

    const restored = await undoReview(review);
    expect(restored).toBeDefined();
    expect(restored!.due).toBe(before!.due);
    expect(restored!.ease).toBe(before!.ease);
    expect(restored!.interval).toBe(before!.interval);
    expect(restored!.reps).toBe(before!.reps);
    expect(restored!.lapses).toBe(before!.lapses);
    expect(restored!.lastReview).toBe(before!.lastReview);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('rend la carte de nouveau due, donc de nouveau présentée', async () => {
    const card = await newCard('Quel nerf innerve le masséter ?');
    expect(await listDueCards(subjectId)).toHaveLength(1);

    const review = await reviewCardUndoable(card.id, 2, 'medium', 3000);
    expect(await listDueCards(subjectId)).toHaveLength(0);

    await undoReview(review);
    expect(await listDueCards(subjectId)).toHaveLength(1);
  });

  it('annuler un échec rend aussi le compte de rechutes', async () => {
    const card = await newCard('Quelle artère vascularise la langue ?');
    const review = await reviewCardUndoable(card.id, 0, 'low', 9000);
    expect((await db.flashcards.get(card.id))!.lapses).toBe(1);

    const restored = await undoReview(review);
    expect(restored!.lapses).toBe(0);
  });

  it('une carte supprimée entre-temps ne fait pas échouer l’annulation', async () => {
    const card = await newCard('Combien de cuspides a la 16 ?');
    const review = await reviewCardUndoable(card.id, 2, 'medium', 1000);
    await db.flashcards.delete(card.id);

    await expect(undoReview(review)).resolves.toBeUndefined();
    // La ligne de journal est bien partie : c'est ce qui compte encore.
    expect(await db.reviewLogs.count()).toBe(0);
  });
});

describe('suspendre une carte', () => {
  it('la retire de la file sans toucher à son échéance', async () => {
    const card = await newCard('Quels sont les muscles masticateurs ?');
    const before = await db.flashcards.get(card.id);

    await setCardSuspended(card.id, true);
    const suspended = await db.flashcards.get(card.id);
    expect(isSuspended(suspended!)).toBe(true);
    expect(suspended!.due).toBe(before!.due);
    expect(suspended!.ease).toBe(before!.ease);
    expect(suspended!.reps).toBe(before!.reps);

    expect(await listDueCards(subjectId)).toHaveLength(0);
    expect(await listAllDueCards()).toHaveLength(0);
  });

  it('la réactivation la remet exactement là où elle en était', async () => {
    const card = await newCard('Où passe le nerf lingual ?');
    await reviewCardUndoable(card.id, 2, 'medium', 2500);
    const reviewed = await db.flashcards.get(card.id);

    await setCardSuspended(card.id, true);
    await setCardSuspended(card.id, false);
    const back = await db.flashcards.get(card.id);

    expect(isSuspended(back!)).toBe(false);
    expect(back!.due).toBe(reviewed!.due);
    expect(back!.ease).toBe(reviewed!.ease);
    expect(back!.reps).toBe(reviewed!.reps);
  });

  it('réactiver lève aussi un enterrement en cours', async () => {
    const card = await newCard('Combien de branches a le V ?');
    await buryCard(card.id);
    await setCardSuspended(card.id, true);

    await setCardSuspended(card.id, false);
    const back = await db.flashcards.get(card.id);
    expect(back!.buriedUntil).toBeNull();
    expect(await listDueCards(subjectId)).toHaveLength(1);
  });

  it('n’efface ni la carte ni son historique de révision', async () => {
    const card = await newCard('Quelle est la formule dentaire adulte ?');
    await reviewCardUndoable(card.id, 1, 'medium', 8000);
    await setCardSuspended(card.id, true);

    expect(await db.flashcards.get(card.id)).toBeDefined();
    expect(await db.reviewLogs.where('itemId').equals(card.id).count()).toBe(1);
  });
});

describe('enterrer une carte', () => {
  it('la cache aujourd’hui et la rend demain', async () => {
    const card = await newCard('Quel muscle abaisse la mandibule ?');
    const now = new Date(2026, 8, 14, 23, 50);
    await buryCard(card.id, now);

    expect(await listDueCards(subjectId, now)).toHaveLength(0);

    const tomorrowMorning = new Date(2026, 8, 15, 7, 0);
    expect(await listDueCards(subjectId, tomorrowMorning)).toHaveLength(1);
  });

  it('enterrer à 23 h 50 ne la fait pas revenir dix minutes plus tard', async () => {
    const lateNight = new Date(2026, 8, 14, 23, 50);
    const until = new Date(buryUntil(lateNight));
    expect(until.getDate()).toBe(15);
    expect(until.getHours()).toBe(0);
    expect(isBuried({ buriedUntil: buryUntil(lateNight) }, new Date(2026, 8, 15, 0, 0, 1))).toBe(false);
  });

  it('ne touche pas à l’échéance SM-2', async () => {
    const card = await newCard('Quelle est la pulpe d’une dent ?');
    const before = await db.flashcards.get(card.id);
    await buryCard(card.id);
    const buried = await db.flashcards.get(card.id);
    expect(buried!.due).toBe(before!.due);
    expect(buried!.interval).toBe(before!.interval);
  });

  it('se lève à la demande', async () => {
    const card = await newCard('Combien de dents temporaires ?');
    await buryCard(card.id);
    expect(await listDueCards(subjectId)).toHaveLength(0);
    await unburyCard(card.id);
    expect(await listDueCards(subjectId)).toHaveLength(1);
  });
});

describe('les compteurs comptent ce que la file ouvrira', () => {
  it('une carte suspendue ou enterrée ne compte pas comme due', async () => {
    const a = await newCard('Carte A');
    const b = await newCard('Carte B');
    await newCard('Carte C');
    expect(await countDueCards(subjectId)).toBe(3);
    expect(await countAllDueCards()).toBe(3);

    await setCardSuspended(a.id, true);
    await buryCard(b.id);

    expect(await countDueCards(subjectId)).toBe(1);
    expect(await countAllDueCards()).toBe(1);
    expect(await listDueCards(subjectId)).toHaveLength(1);
  });
});

describe('isReviewable — la seule porte d’entrée de la file', () => {
  const base = {
    ease: 2.3,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: '2026-09-14T00:00:00.000Z',
    lastReview: null,
  };
  const now = new Date('2026-09-14T12:00:00.000Z');

  it('accepte une carte due sans mise de côté', () => {
    expect(isReviewable(base, now)).toBe(true);
  });

  it('refuse une carte suspendue, même due', () => {
    expect(isReviewable({ ...base, suspended: true }, now)).toBe(false);
  });

  it('refuse une carte enterrée, même due', () => {
    expect(isReviewable({ ...base, buriedUntil: '2026-09-15T00:00:00.000Z' }, now)).toBe(false);
  });

  it('accepte une carte dont l’enterrement est expiré', () => {
    expect(isReviewable({ ...base, buriedUntil: '2026-09-14T06:00:00.000Z' }, now)).toBe(true);
  });

  it('lit l’absence de champ exactement comme « ni suspendue ni enterrée »', () => {
    // C'est l'état de TOUTES les cartes déjà en base avant cet ajout.
    const legacy = { ...base } as Flashcard & { suspended?: boolean };
    expect(isSuspended(legacy)).toBe(false);
    expect(isBuried(legacy, now)).toBe(false);
    expect(isReviewable(legacy, now)).toBe(true);
  });
});

describe('une carte suspendue ne revient par aucune porte', () => {
  it('le quiz l’écarte de TOUS ses viviers, pas seulement de « à revoir »', async () => {
    const { scopeCards } = await import('@/core/quiz');
    const kept = await newCard('Quelle est la fonction du cément ?');
    const hidden = await newCard('Qu’est-ce que le ligament alvéolo-dentaire ?');
    await setCardSuspended(hidden.id, true);

    const tables = {
      subjects: await db.subjects.toArray(),
      chapters: [],
      cards: await db.flashcards.toArray(),
      logs: await db.reviewLogs.toArray(),
      analyses: [],
      events: [],
    };

    const scopes: QuizScope[] = [
      { kind: 'subject', subjectId },
      { kind: 'due' },
      { kind: 'exam', subjectId },
      { kind: 'cards', cardIds: [kept.id, hidden.id] },
    ];
    for (const scope of scopes) {
      const pool = scopeCards(scope, tables);
      expect(pool.map((card) => card.id)).toContain(kept.id);
      expect(pool.map((card) => card.id)).not.toContain(hidden.id);
    }
  });

  it('une carte enterrée reste disponible pour un quiz demandé explicitement', async () => {
    // Enterrer dit « pas aujourd'hui en révision », pas « retire-la de tout » :
    // un quiz que l'étudiant demande sur sa matière la garde.
    const { scopeCards } = await import('@/core/quiz');
    const card = await newCard('Quelle est l’épaisseur du sulcus sain ?');
    await buryCard(card.id);

    const tables = {
      subjects: await db.subjects.toArray(),
      chapters: [],
      cards: await db.flashcards.toArray(),
      logs: await db.reviewLogs.toArray(),
      analyses: [],
      events: [],
    };

    expect(scopeCards({ kind: 'subject', subjectId }, tables).map((c) => c.id)).toContain(card.id);
    expect(scopeCards({ kind: 'due' }, tables).map((c) => c.id)).not.toContain(card.id);
  });
});
