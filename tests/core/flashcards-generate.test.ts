import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearAllData } from '@/data/db';
import { createSubject, createChapter } from '@/data/repositories/subjects';
import { addDocument, listChunks } from '@/data/repositories/documents';
import { createFlashcard } from '@/data/repositories/cards';
import { db } from '@/data/db';

/**
 * `generateCardDrafts` (services/flashcards/generate.ts) — le parcours réel
 * COURS → FLASHCARDS IA : tâche déclarée, grounding par citation (délégué à
 * `validateCardDrafts`, déjà couvert par `flashcards-validate.test.ts`), et
 * la déduplication contre la bibliothèque déjà existante, ajoutée dans ce
 * tour. `isDuplicateQuestion` est testée séparément, en pur, à la fin.
 */
const askMock = vi.fn();
vi.mock('@/services/ai/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/orchestrator')>('@/services/ai/orchestrator');
  return {
    ...actual,
    aiOrchestrator: { ...actual.aiOrchestrator, ask: (...args: unknown[]) => askMock(...args) },
  };
});

const { generateCardDrafts, isDuplicateQuestion, NoIndexedContentError } = await import(
  '@/services/flashcards/generate'
);

const LONG_TEXT =
  "Le nerf trijumeau (V) est le plus volumineux des nerfs crâniens. Il assure l'innervation sensitive de la face et l'innervation motrice des muscles masticateurs. Il se divise en trois branches : ophtalmique (V1), maxillaire (V2) et mandibulaire (V3).".repeat(
    2,
  );

async function seedSubjectWithDocument() {
  const subject = await createSubject('Anatomie', '#1F8A5F');
  const chapter = await createChapter(subject.id, 'Nerfs crâniens');
  await addDocument({ subjectId: subject.id, chapterId: chapter.id, name: 'Cours.pdf', text: LONG_TEXT, source: 'pdf' });
  const chunks = await listChunks({ subjectId: subject.id, chapterId: chapter.id });
  const lookup = {
    subjects: new Map([[subject.id, { id: subject.id, name: subject.name } as never]]),
    chapters: new Map([[chapter.id, { id: chapter.id, name: chapter.name } as never]]),
    documents: new Map(
      (await db.documents.where('subjectId').equals(subject.id).toArray()).map((d) => [d.id, { id: d.id, name: d.name }]),
    ),
  };
  return { subject, chapter, chunks, lookup };
}

beforeEach(async () => {
  await clearAllData();
  askMock.mockReset();
});

describe('generateCardDrafts', () => {
  it('refuse sans le moindre contenu indexé — jamais d’appel IA pour rien', async () => {
    const subject = await createSubject('Anatomie', '#1F8A5F');
    await expect(
      generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks: [], lookup: { subjects: new Map(), chapters: new Map(), documents: new Map() } }),
    ).rejects.toBeInstanceOf(NoIndexedContentError);
    expect(askMock).not.toHaveBeenCalled();
    void subject;
  });

  it('déclare la tâche flashcards-generate', async () => {
    const { chunks, lookup } = await seedSubjectWithDocument();
    askMock.mockResolvedValueOnce(
      JSON.stringify([{ question: 'Combien de branches a le trijumeau ?', answer: 'Trois [S1].', refs: ['S1'] }]),
    );
    await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup });
    expect(askMock.mock.calls[0]![0].task).toBe('flashcards-generate');
  });

  it('ne propose que des cartes sourcées par un extrait réellement transmis', async () => {
    const { chunks, lookup } = await seedSubjectWithDocument();
    askMock.mockResolvedValueOnce(
      JSON.stringify([
        { question: 'Une question ?', answer: 'Une affirmation sans référence valable [S9].', refs: ['S9'] },
      ]),
    );
    const drafts = await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup });
    expect(drafts).toHaveLength(0);
  });

  it('rappelle au modèle les questions déjà présentes dans la portée, pour qu’il évite de les redemander', async () => {
    const { subject, chapter, chunks, lookup } = await seedSubjectWithDocument();
    await createFlashcard({
      subjectId: subject.id,
      chapterId: chapter.id,
      question: 'Quel est le plus volumineux des nerfs crâniens ?',
      answer: 'Le nerf trijumeau.',
      origin: 'manual',
    });
    askMock.mockResolvedValueOnce(
      JSON.stringify([{ question: 'Combien de branches a le trijumeau ?', answer: 'Trois [S1].', refs: ['S1'] }]),
    );

    await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup });

    const systemPrompt: string = askMock.mock.calls[0]![0].system;
    expect(systemPrompt).toContain('CARTES DÉJÀ EXISTANTES');
    expect(systemPrompt).toContain('Quel est le plus volumineux des nerfs crâniens ?');
  });

  it('filtre une carte quasi identique à une carte déjà existante, même si le modèle l’a proposée malgré la consigne', async () => {
    const { subject, chapter, chunks, lookup } = await seedSubjectWithDocument();
    await createFlashcard({
      subjectId: subject.id,
      chapterId: chapter.id,
      question: 'Quelles sont les trois branches du nerf trijumeau ?',
      answer: 'Ophtalmique, maxillaire, mandibulaire.',
      origin: 'manual',
    });
    askMock.mockResolvedValueOnce(
      JSON.stringify([
        // Quasi la même question que la carte existante, à peine reformulée.
        { question: 'Quelles sont les trois branches du trijumeau ?', answer: 'V1, V2, V3 [S1].', refs: ['S1'] },
        // Une carte réellement nouvelle, sur une autre information du même extrait.
        { question: 'Le trijumeau est-il moteur, sensitif, ou les deux ?', answer: 'Les deux [S1].', refs: ['S1'] },
      ]),
    );

    const drafts = await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.question).toContain('moteur');
  });

  it('n’écarte pas une carte d’un AUTRE chapitre juste parce que le sujet se recoupe', async () => {
    const { subject, chunks, lookup } = await seedSubjectWithDocument();
    const otherChapter = await createChapter(subject.id, 'Un autre chapitre');
    await createFlashcard({
      subjectId: subject.id,
      chapterId: otherChapter.id,
      question: 'Quelles sont les trois branches du nerf trijumeau ?',
      answer: 'Ophtalmique, maxillaire, mandibulaire.',
      origin: 'manual',
    });
    askMock.mockResolvedValueOnce(
      JSON.stringify([{ question: 'Quelles sont les trois branches du trijumeau ?', answer: 'V1, V2, V3 [S1].', refs: ['S1'] }]),
    );

    const drafts = await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup });

    // La portée demandée est CE chapitre : une carte d'un autre chapitre ne
    // doit ni figurer dans le rappel envoyé au modèle, ni filtrer la carte.
    const systemPrompt: string = askMock.mock.calls[0]![0].system;
    expect(systemPrompt).not.toContain('CARTES DÉJÀ EXISTANTES');
    expect(drafts).toHaveLength(1);
  });
});

describe('isDuplicateQuestion', () => {
  it('reconnaît une question strictement identique, aux accents/majuscules près', () => {
    expect(isDuplicateQuestion('Où se situe le nerf facial ?', ['où se situe le nerf facial'])).toBe(true);
  });

  it('reconnaît une reformulation superficielle (même vocabulaire, ordre différent)', () => {
    expect(
      isDuplicateQuestion('Quelles sont les branches du nerf trijumeau ?', ['Quelles sont les trois branches du trijumeau ?']),
    ).toBe(true);
  });

  it('ne confond pas deux questions distinctes qui partagent seulement un même sujet', () => {
    expect(
      isDuplicateQuestion('Le trijumeau est-il moteur ou sensitif ?', ['Quelles sont les branches du nerf trijumeau ?']),
    ).toBe(false);
  });

  it('une liste vide ne signale jamais de doublon', () => {
    expect(isDuplicateQuestion('Une question quelconque ?', [])).toBe(false);
  });
});
