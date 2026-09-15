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

  it('déclare la tâche flashcards-generate (source: ai, régénération explicite)', async () => {
    const { chunks, lookup } = await seedSubjectWithDocument();
    askMock.mockResolvedValueOnce(
      JSON.stringify([{ question: 'Combien de branches a le trijumeau ?', answer: 'Trois [S1].', refs: ['S1'] }]),
    );
    await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup, source: 'ai' });
    expect(askMock.mock.calls[0]![0].task).toBe('flashcards-generate');
  });

  it('ne propose que des cartes sourcées par un extrait réellement transmis (source: ai)', async () => {
    const { chunks, lookup } = await seedSubjectWithDocument();
    askMock.mockResolvedValueOnce(
      JSON.stringify([
        { question: 'Une question ?', answer: 'Une affirmation sans référence valable [S9].', refs: ['S9'] },
      ]),
    );
    const drafts = await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup, source: 'ai' });
    expect(drafts).toHaveLength(0);
  });

  it('rappelle au modèle les questions déjà présentes dans la portée, pour qu’il évite de les redemander (source: ai)', async () => {
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

    await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup, source: 'ai' });

    const systemPrompt: string = askMock.mock.calls[0]![0].system;
    expect(systemPrompt).toContain('CARTES DÉJÀ EXISTANTES');
    expect(systemPrompt).toContain('Quel est le plus volumineux des nerfs crâniens ?');
  });

  it('filtre une carte quasi identique à une carte déjà existante, même si le modèle l’a proposée malgré la consigne (source: ai)', async () => {
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

    const drafts = await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup, source: 'ai' });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.question).toContain('moteur');
  });

  it('n’écarte pas une carte d’un AUTRE chapitre juste parce que le sujet se recoupe (source: ai)', async () => {
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

    const drafts = await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup, source: 'ai' });

    // La portée demandée est CE chapitre : une carte d'un autre chapitre ne
    // doit ni figurer dans le rappel envoyé au modèle, ni filtrer la carte.
    const systemPrompt: string = askMock.mock.calls[0]![0].system;
    expect(systemPrompt).not.toContain('CARTES DÉJÀ EXISTANTES');
    expect(drafts).toHaveLength(1);
  });

  it('par défaut (aucun `source` fourni), utilise le moteur local — jamais le moindre appel IA', async () => {
    const { chunks, lookup } = await seedSubjectWithDocument();
    const drafts = await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup });
    expect(askMock).not.toHaveBeenCalled();
    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      expect(draft.citations.length).toBeGreaterThan(0);
    }
  });
});

describe('isDuplicateQuestion', () => {
  it('reconnaît une question strictement identique, aux accents/majuscules près', () => {
    expect(isDuplicateQuestion('Où se situe le nerf facial ?', ['où se situe le nerf facial'])).toBe(true);
  });

  it('reconnaît une reformulation qui ne change que la tournure', () => {
    expect(
      isDuplicateQuestion('Quelles sont les branches du trijumeau ?', ['Quels sont les branches du trijumeau ?']),
    ).toBe(true);
  });

  /*
    LE DOUTE PROFITE À LA CARTE.

    Le recouvrement se mesure sur les mots PORTEURS DE SENS (voir `dedupe.ts`),
    et deux questions dont les termes distinctifs diffèrent ne sont plus
    fusionnées. C'est un choix explicite : perdre une carte qu'on voulait est
    pire que voir une carte de trop, qu'un clic suffit à supprimer.

    Contrepartie assumée : « Quelles sont les branches du NERF trijumeau ? »
    et « Quelles sont les TROIS branches du trijumeau ? » coexistent
    désormais, alors qu'elles posent la même question. Le mot en trop de
    chaque côté suffit à faire tomber le recouvrement des mots porteurs sous
    le seuil, et aucune règle lexicale ne sait qu'ici « nerf » est un
    classifieur et « trois » un compte, alors qu'ailleurs ce sont eux qui
    portent la question.
  */
  it('ne fusionne pas deux questions dont les termes distinctifs diffèrent', () => {
    // Deux dents différentes : la 46 et la 36. L'ancienne règle, qui comptait
    // aussi les mots outils, trouvait 0,71 de recouvrement et faisait
    // disparaître la seconde carte en silence.
    expect(
      isDuplicateQuestion('Combien de racines a la 46 ?', ['Combien de racines a la 36 ?']),
    ).toBe(false);
    // Deux notions différentes, formulées à l'identique — le cas le plus
    // fréquent dans un jeu de cartes de cours.
    expect(
      isDuplicateQuestion('Qu’est-ce que le parodonte ?', ['Qu’est-ce que le sulcus ?']),
    ).toBe(false);
  });

  it('reconnaît toujours une question identique au mot près', () => {
    expect(
      isDuplicateQuestion('Qu’est-ce que le parodonte ?', ['Qu’est-ce que le parodonte ?']),
    ).toBe(true);
  });

  it('reconnaît une question identique même sans aucun mot porteur de sens', () => {
    // « Et après ? » : que des mots outils. L'égalité exacte des libellés
    // normalisés reste testée en premier, précisément pour ce cas.
    expect(isDuplicateQuestion('Et après ?', ['Et après ?'])).toBe(true);
    expect(isDuplicateQuestion('Et après ?', ['Et avant ?'])).toBe(false);
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
