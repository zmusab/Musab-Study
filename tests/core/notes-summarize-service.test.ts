import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Note } from '@/types';

/**
 * `summarizeNote` (services/notes/summarize.ts) — orchestration testée avec
 * un mock de l'orchestrateur IA, sans appel réseau réel.
 */
const askMock = vi.fn();
vi.mock('@/services/ai/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/orchestrator')>('@/services/ai/orchestrator');
  return {
    ...actual,
    aiOrchestrator: { ...actual.aiOrchestrator, ask: (...args: unknown[]) => askMock(...args) },
  };
});

const { summarizeNote, InsufficientNoteContentError } = await import('@/services/notes/summarize');

function note(text: string): Note {
  return {
    id: 'n1',
    subjectId: 's1',
    chapterId: null,
    documentId: null,
    page: null,
    title: 'Trijumeau',
    text,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const NOTE_TEXT =
  'Le nerf trijumeau (V) est le cinquième nerf crânien. Il comporte trois branches : ophtalmique, maxillaire et mandibulaire.';

beforeEach(() => {
  askMock.mockReset();
});

describe('summarizeNote', () => {
  it('refuse une note trop courte sans appeler le modèle', async () => {
    await expect(summarizeNote({ note: note('Trop court.') })).rejects.toBeInstanceOf(InsufficientNoteContentError);
    expect(askMock).not.toHaveBeenCalled();
  });

  it('déclare la tâche note-summarize à l’orchestrateur', async () => {
    askMock.mockResolvedValueOnce(
      JSON.stringify({ summary: 'Le trijumeau a trois branches.', excerpt: 'Il comporte trois branches' }),
    );
    await summarizeNote({ note: note(NOTE_TEXT) });
    expect(askMock.mock.calls[0]![0].task).toBe('note-summarize');
  });

  it('renvoie null quand l’extrait cité n’existe pas réellement dans la note', async () => {
    askMock.mockResolvedValueOnce(JSON.stringify({ summary: 'Résumé plausible.', excerpt: 'passage inventé' }));
    expect(await summarizeNote({ note: note(NOTE_TEXT) })).toBeNull();
  });

  it('renvoie le résumé et son extrait quand la citation est vérifiée', async () => {
    askMock.mockResolvedValueOnce(
      JSON.stringify({ summary: 'Le trijumeau a trois branches.', excerpt: 'Il comporte trois branches' }),
    );
    const result = await summarizeNote({ note: note(NOTE_TEXT) });
    expect(result).toEqual({ summary: 'Le trijumeau a trois branches.', excerpt: 'Il comporte trois branches' });
  });
});
