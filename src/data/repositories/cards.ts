import Dexie from 'dexie';
import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { dayKey } from '@/lib/date';
import {
  buildDueQueue,
  buryUntil,
  initialSchedulingState,
  isReviewable,
  scheduleNext,
  type SchedulingState,
} from '@/core/srs';
import type { Confidence, Flashcard, ID, Rating, ReviewLog } from '@/types';

export type NewFlashcard = Pick<Flashcard, 'subjectId' | 'chapterId' | 'question' | 'answer'> &
  Partial<
    Pick<
      Flashcard,
      'importance' | 'difficulty' | 'origin' | 'sourceChunkIds' | 'notionKey' | 'notionLabel'
    >
  >;

export function buildFlashcard(input: NewFlashcard, now: Date = new Date()): Flashcard {
  return {
    id: uid('crd'),
    subjectId: input.subjectId,
    chapterId: input.chapterId,
    question: input.question.trim(),
    answer: input.answer.trim(),
    importance: input.importance ?? 2,
    difficulty: input.difficulty ?? 2,
    origin: input.origin ?? 'manual',
    sourceChunkIds: input.sourceChunkIds ?? [],
    notionKey: input.notionKey ?? null,
    notionLabel: input.notionLabel ?? null,
    createdAt: now.toISOString(),
    ...initialSchedulingState(now),
  };
}

export async function createFlashcard(input: NewFlashcard): Promise<Flashcard> {
  const card = buildFlashcard(input);
  await db.flashcards.add(card);
  return card;
}

export async function createFlashcards(inputs: NewFlashcard[]): Promise<Flashcard[]> {
  const cards = inputs.map((input) => buildFlashcard(input));
  await db.flashcards.bulkAdd(cards);
  return cards;
}

export async function listCards(subjectId: ID): Promise<Flashcard[]> {
  return db.flashcards.where('subjectId').equals(subjectId).toArray();
}

export async function getCard(id: ID): Promise<Flashcard | undefined> {
  return db.flashcards.get(id);
}

export async function updateCard(id: ID, patch: Partial<Flashcard>): Promise<void> {
  await db.flashcards.update(id, patch);
}

export async function deleteCard(id: ID): Promise<void> {
  await db.transaction('rw', [db.flashcards, db.reviewLogs], async () => {
    await db.flashcards.delete(id);
    await db.reviewLogs.where('itemId').equals(id).delete();
  });
}

/**
 * Cartes dues d'une matière, via l'index composé — sans tout charger.
 *
 * Les deux `true` finaux rendent les bornes INCLUSIVES. Dexie exclut la borne
 * haute par défaut : sans cela, une carte dont l'échéance tombe exactement à
 * l'instant de la requête — c'est le cas de TOUTE carte fraîchement créée —
 * n'apparaîtrait jamais dans la file de révision.
 */
export async function listDueCards(subjectId: ID, now: Date = new Date()): Promise<Flashcard[]> {
  const cards = await db.flashcards
    .where('[subjectId+due]')
    .between([subjectId, Dexie.minKey], [subjectId, now.toISOString()], true, true)
    .toArray();
  return buildDueQueue(cards, now);
}

/*
  LES COMPTEURS FILTRENT COMME LA FILE, sinon ils mentent.

  Compter sur le seul index `due` était exact tant qu'une carte due était
  forcément présentée. Depuis qu'on peut suspendre ou enterrer, le Dashboard
  annoncerait « 12 cartes à réviser » pour une file qui n'en ouvre que 9 — et
  l'écart resterait affiché jusqu'au lendemain. `.filter()` coûte un parcours
  des lignes dues, jamais de tout le volume : la borne d'index reste la même.
*/
export async function countDueCards(subjectId: ID, now: Date = new Date()): Promise<number> {
  const cards = await db.flashcards
    .where('[subjectId+due]')
    .between([subjectId, Dexie.minKey], [subjectId, now.toISOString()], true, true)
    .filter((card) => isReviewable(card, now))
    .toArray();
  return buildDueQueue(cards, now).length;
}

export async function countAllDueCards(now: Date = new Date()): Promise<number> {
  const cards = await db.flashcards
    .where('due')
    .belowOrEqual(now.toISOString())
    .filter((card) => isReviewable(card, now))
    .toArray();
  return buildDueQueue(cards, now).length;
}

/** Cartes dues de TOUTES les matières, pour une session de révision globale. */
export async function listAllDueCards(now: Date = new Date()): Promise<Flashcard[]> {
  const cards = await db.flashcards.where('due').belowOrEqual(now.toISOString()).toArray();
  return buildDueQueue(cards, now);
}

/**
 * Enregistre une réponse : met à jour la planification de la carte ET journalise
 * la révision, atomiquement. Une planification avancée sans trace dans le
 * journal fausserait définitivement les statistiques de progression.
 */
export async function reviewCard(
  cardId: ID,
  rating: Rating,
  confidence: Confidence,
  elapsedMs: number,
  now: Date = new Date(),
): Promise<Flashcard> {
  return (await reviewCardUndoable(cardId, rating, confidence, elapsedMs, now)).card;
}

/**
 * CE QU'IL FAUT RETENIR POUR POUVOIR ANNULER.
 *
 * SM-2 n'est pas inversible : de `ease 2.45, interval 14` on ne peut pas
 * déduire ce qu'était la carte avant la note — la même arrivée est atteignable
 * depuis plusieurs états. Un journal de révision ne suffit donc pas à revenir
 * en arrière, et reconstituer l'état d'avant serait le DEVINER.
 *
 * On garde donc l'état exact d'avant la note, tel qu'il était en base, et
 * l'identifiant de la ligne de journal écrite. C'est la seule façon honnête de
 * rendre l'annulation exacte plutôt qu'approchée.
 */
export interface UndoableReview {
  card: Flashcard;
  /** État de planification AVANT la note — ce que l'annulation restaure. */
  previous: SchedulingState;
  /** Ligne de journal écrite — ce que l'annulation supprime. */
  logId: ID;
}

export async function reviewCardUndoable(
  cardId: ID,
  rating: Rating,
  confidence: Confidence,
  elapsedMs: number,
  now: Date = new Date(),
): Promise<UndoableReview> {
  return db.transaction('rw', [db.flashcards, db.reviewLogs], async () => {
    const card = await db.flashcards.get(cardId);
    if (!card) throw new Error(`Carte introuvable : ${cardId}`);

    const scheduling = scheduleNext(card, rating, confidence, now);
    const updated: Flashcard = { ...card, ...scheduling };

    const log: ReviewLog = {
      id: uid('rev'),
      subjectId: card.subjectId,
      chapterId: card.chapterId,
      itemId: card.id,
      itemKind: 'card',
      at: now.toISOString(),
      day: dayKey(now),
      correct: rating >= 2,
      rating,
      confidence,
      elapsedMs,
    };

    await db.flashcards.put(updated);
    await db.reviewLogs.add(log);
    return {
      card: updated,
      previous: {
        ease: card.ease,
        interval: card.interval,
        reps: card.reps,
        lapses: card.lapses,
        due: card.due,
        lastReview: card.lastReview,
      },
      logId: log.id,
    };
  });
}

/**
 * ANNULER LA DERNIÈRE RÉPONSE — remettre la carte ET le journal comme avant.
 *
 * Les deux ensemble, dans une seule transaction : restaurer la planification
 * sans retirer la ligne de journal laisserait une réponse fantôme dans les
 * statistiques de progression, et retirer la ligne sans restaurer la
 * planification laisserait la carte repoussée pour une réponse qui n'existe
 * plus. C'est la symétrie exacte de `reviewCardUndoable`.
 *
 * Rend la carte restaurée, ou `undefined` si elle a été supprimée entre-temps
 * — il n'y a alors plus rien à restaurer, et c'est un état normal, pas une
 * erreur.
 */
export async function undoReview(review: UndoableReview): Promise<Flashcard | undefined> {
  return db.transaction('rw', [db.flashcards, db.reviewLogs], async () => {
    await db.reviewLogs.delete(review.logId);
    const card = await db.flashcards.get(review.card.id);
    if (!card) return undefined;
    const restored: Flashcard = { ...card, ...review.previous };
    await db.flashcards.put(restored);
    return restored;
  });
}

/**
 * SUSPENDRE / RÉACTIVER, ENTERRER — la visibilité, jamais l'échéance.
 *
 * Aucune de ces trois écritures ne touche `due`, `ease`, `interval` ni `reps` :
 * une carte réactivée reprend exactement là où elle en était.
 */
export async function setCardSuspended(id: ID, suspended: boolean): Promise<void> {
  // Réactiver lève aussi l'enterrement : l'utilisateur vient de dire
  // explicitement qu'il veut revoir cette carte.
  await db.flashcards.update(id, suspended ? { suspended: true } : { suspended: false, buriedUntil: null });
}

export async function buryCard(id: ID, now: Date = new Date()): Promise<void> {
  await db.flashcards.update(id, { buriedUntil: buryUntil(now) });
}

export async function unburyCard(id: ID): Promise<void> {
  await db.flashcards.update(id, { buriedUntil: null });
}

/**
 * RÉINITIALISER UNE CARTE — la remettre à l'état neuf sans la supprimer.
 *
 * Le cas réel : une carte notée « Facile » trop vite revient dans deux mois,
 * alors qu'on sait déjà qu'on ne la maîtrise pas. Repousser n'avance à rien,
 * supprimer perd la carte. La réinitialiser la remet dans la file dès
 * maintenant, avec l'ease et l'intervalle d'une carte neuve.
 *
 * L'HISTORIQUE DE RÉVISION EST CONSERVÉ, délibérément : ces réponses ont
 * réellement eu lieu, et la progression les compte à juste titre. C'est la
 * différence avec `undoReview`, qui efface une réponse parce qu'elle n'aurait
 * pas dû être enregistrée.
 */
export async function resetCardScheduling(id: ID, now: Date = new Date()): Promise<void> {
  await db.flashcards.update(id, { ...initialSchedulingState(now), buriedUntil: null });
}

export async function logReview(log: Omit<ReviewLog, 'id'>): Promise<void> {
  await db.reviewLogs.add({ ...log, id: uid('rev') });
}

export async function listReviewLogs(subjectId?: ID): Promise<ReviewLog[]> {
  if (subjectId) return db.reviewLogs.where('subjectId').equals(subjectId).toArray();
  return db.reviewLogs.toArray();
}
