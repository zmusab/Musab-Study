import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearAllData } from '@/data/db';
import { createSubject, createChapter } from '@/data/repositories/subjects';
import { addDocument } from '@/data/repositories/documents';

/**
 * `studyChapter` (services/assistant/chapterStudy.ts) — les actions « Étudier »
 * de l'Assistant IA (résumer un cours, préparer une fiche de révision). Même
 * garantie que `PdfAiPanel` : sans le moindre document indexé, on ne cite
 * jamais un passage inexistant.
 */
const askMock = vi.fn();
vi.mock('@/services/ai/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/orchestrator')>('@/services/ai/orchestrator');
  return {
    ...actual,
    aiOrchestrator: { ...actual.aiOrchestrator, ask: (...args: unknown[]) => askMock(...args) },
  };
});

const { studyChapter } = await import('@/services/assistant/chapterStudy');

const LONG_TEXT =
  "L'émail dentaire est le tissu le plus minéralisé de l'organisme humain. Il recouvre la couronne de la dent et protège la dentine sous-jacente. Sa formation, appelée amélogenèse, se déroule avant l'éruption dentaire.".repeat(
    3,
  );

beforeEach(async () => {
  await clearAllData();
  askMock.mockReset();
});

describe('studyChapter', () => {
  it('renvoie null sans le moindre document indexé dans la portée — jamais d’appel IA pour rien', async () => {
    const subject = await createSubject('Histologie', '#1F8A5F');
    const chapter = await createChapter(subject.id, 'Tissus durs');
    const result = await studyChapter({ subjectId: subject.id, chapterId: chapter.id }, 'summary', 'dentisterie');
    expect(result).toBeNull();
    expect(askMock).not.toHaveBeenCalled();
  });

  it('déclare la tâche pdf-summarize-chapter et vérifie la réponse contre le contexte réellement transmis', async () => {
    const subject = await createSubject('Histologie', '#1F8A5F');
    const chapter = await createChapter(subject.id, 'Tissus durs');
    await addDocument({ subjectId: subject.id, chapterId: chapter.id, name: 'Cours.pdf', text: LONG_TEXT, source: 'pdf' });

    askMock.mockResolvedValueOnce("L'émail est le tissu le plus minéralisé [S1].");
    const result = await studyChapter({ subjectId: subject.id, chapterId: chapter.id }, 'summary', 'dentisterie');

    expect(askMock.mock.calls[0]![0].task).toBe('pdf-summarize-chapter');
    expect(result).not.toBeNull();
    expect(result!.verified.provenance).toBe('course');
    expect(result!.verified.citations.length).toBeGreaterThan(0);
  });

  it('une réponse sans citation valide devient « insuffisant » — jamais présentée comme sourcée', async () => {
    const subject = await createSubject('Histologie', '#1F8A5F');
    const chapter = await createChapter(subject.id, 'Tissus durs');
    await addDocument({ subjectId: subject.id, chapterId: chapter.id, name: 'Cours.pdf', text: LONG_TEXT, source: 'pdf' });

    askMock.mockResolvedValueOnce('Une affirmation sans la moindre référence.');
    const result = await studyChapter({ subjectId: subject.id, chapterId: chapter.id }, 'sheet', 'dentisterie');

    expect(result!.verified.provenance).toBe('insufficient');
  });

  it('chapterId null couvre toute la matière, pas seulement les cartes sans chapitre', async () => {
    const subject = await createSubject('Histologie', '#1F8A5F');
    const chapter = await createChapter(subject.id, 'Tissus durs');
    await addDocument({ subjectId: subject.id, chapterId: chapter.id, name: 'Cours.pdf', text: LONG_TEXT, source: 'pdf' });

    askMock.mockResolvedValueOnce("Résumé général [S1].");
    const result = await studyChapter({ subjectId: subject.id, chapterId: null }, 'summary', 'dentisterie');
    expect(result).not.toBeNull();
    expect(result!.chunkCount).toBeGreaterThan(0);
  });
});
