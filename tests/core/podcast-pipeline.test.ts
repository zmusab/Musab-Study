import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { Chapter, DocumentChunk, StudyDocument, Subject } from '@/types';

/**
 * Test d'intégration du pipeline, sans appel réseau réel : `aiOrchestrator.ask()`
 * est simulé pour renvoyer des réponses canoniques, ce qui permet de vérifier
 * l'ORCHESTRATION (ordre des étapes, filtrage du contexte entre l'analyse et
 * le dialogue, propagation des erreurs) sans dépendre d'une clé API — et sans
 * dépendre de quel fournisseur répondrait réellement.
 */
const askMock = vi.fn();
vi.mock('@/services/ai/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/orchestrator')>('@/services/ai/orchestrator');
  return {
    ...actual,
    aiOrchestrator: { ...actual.aiOrchestrator, ask: (...args: unknown[]) => askMock(...args) },
  };
});

const { generatePodcastEpisode, InsufficientCourseContentError } = await import('@/services/podcast/pipeline');
const { AiRequestError } = await import('@/services/ai/types');

function makeChunk(index: number, text: string): DocumentChunk {
  return {
    id: `chk-${index}`,
    documentId: 'doc-1',
    chapterId: 'ch-1',
    subjectId: 'sub-1',
    index,
    text,
    charStart: 0,
    charEnd: text.length,
    pageStart: null,
    pageEnd: null,
    termFreq: {},
    tokenCount: text.split(' ').length,
    embedding: null,
  };
}

const CHUNKS: DocumentChunk[] = [
  makeChunk(0, "L'émail dentaire est le tissu le plus minéralisé de l'organisme."),
  makeChunk(1, "La dentine se situe sous l'émail et contient des tubuli dentinaires."),
];

const LOOKUP: ContextLookup = {
  subjects: new Map<string, Subject>([
    ['sub-1', { id: 'sub-1', name: 'Histologie', color: '#000', createdAt: '', position: 0 }],
  ]),
  chapters: new Map<string, Chapter>([
    ['ch-1', { id: 'ch-1', subjectId: 'sub-1', name: 'Tissus durs', createdAt: '', position: 0 }],
  ]),
  documents: new Map<string, Pick<StudyDocument, 'id' | 'name'>>([
    ['doc-1', { id: 'doc-1', name: 'Émail.pdf' }],
  ]),
};

function baseInput(overrides: Partial<Parameters<typeof generatePodcastEpisode>[0]> = {}) {
  return {
    subjectId: 'sub-1',
    chapterId: 'ch-1',
    title: 'Histologie — Tissus durs',
    length: 'quick' as const,
    enrichedWithInternet: false,
    chunks: CHUNKS,
    lookup: LOOKUP,
    program: 'dentisterie',
    ...overrides,
  };
}

beforeEach(() => {
  askMock.mockReset();
});

describe('generatePodcastEpisode', () => {
  it('refuse de générer sans le moindre fragment', async () => {
    await expect(generatePodcastEpisode(baseInput({ chunks: [] }))).rejects.toBeInstanceOf(
      InsufficientCourseContentError,
    );
    expect(askMock).not.toHaveBeenCalled();
  });

  it('orchestre les deux étapes et produit un épisode validé', async () => {
    askMock
      .mockResolvedValueOnce(
        JSON.stringify([{ label: 'Composition de l’émail', importance: 3, pitfall: false, refs: ['S1'] }]),
      )
      .mockResolvedValueOnce(
        JSON.stringify([
          { speaker: 'A', type: 'intro', source: 'none', text: 'Aujourd’hui, on parle de l’émail.' },
          {
            speaker: 'B',
            type: 'concept',
            source: 'cours',
            text: 'Il est composé à 96% d’hydroxyapatite [S1].',
          },
        ]),
      );

    const episode = await generatePodcastEpisode(baseInput());

    expect(askMock).toHaveBeenCalledTimes(2);
    expect(episode.concepts).toHaveLength(1);
    expect(episode.segments).toHaveLength(2);
    expect(episode.segments[1]!.provenance).toBe('course');
    expect(episode.estimatedDurationSec).toBeGreaterThan(0);
    expect(episode.subjectId).toBe('sub-1');
  });

  it("distingue la tâche d'analyse de la tâche de dialogue auprès de l'orchestrateur", async () => {
    // Le pipeline ne décide plus lui-même du modèle ou du niveau de qualité —
    // il déclare seulement QUELLE tâche il exécute ; c'est la table de
    // routage (tests/core/ai-task-router.test.ts) qui décide que l'analyse
    // va au modèle rapide et que le dialogue reste sur le modèle choisi par
    // l'utilisateur, et l'orchestrateur (tests/core/ai-orchestrator.test.ts)
    // qui applique réellement ce choix.
    askMock
      .mockResolvedValueOnce(JSON.stringify([{ label: 'Composition', refs: ['S1'] }]))
      .mockResolvedValueOnce(
        JSON.stringify([{ speaker: 'B', type: 'concept', source: 'cours', text: 'Fait [S1].' }]),
      );

    await generatePodcastEpisode(baseInput());

    const analysisCallOptions = askMock.mock.calls[0]![0];
    const dialogueCallOptions = askMock.mock.calls[1]![0];

    expect(analysisCallOptions.task).toBe('podcast-analysis');
    expect(dialogueCallOptions.task).toBe('podcast-dialogue');
  });

  it('ne transmet à l’étape « dialogue » que les extraits utilisés par une notion retenue', async () => {
    askMock
      .mockResolvedValueOnce(
        JSON.stringify([{ label: 'Composition de l’émail', refs: ['S1'] }]),
      )
      .mockResolvedValueOnce(JSON.stringify([]));

    await generatePodcastEpisode(baseInput()).catch(() => {});

    const dialogueCallSystem = askMock.mock.calls[1]![0].system as string;
    // S2 (la dentine) n'a servi aucune notion retenue : il ne doit pas
    // apparaître dans le contexte transmis à l'étape de dialogue.
    expect(dialogueCallSystem).toContain('émail');
    expect(dialogueCallSystem).not.toContain('tubuli dentinaires');
  });

  it('échoue clairement si aucune notion n’a pu être validée', async () => {
    askMock.mockResolvedValueOnce(JSON.stringify([{ label: 'Notion invérifiable', refs: ['S9'] }]));

    await expect(generatePodcastEpisode(baseInput())).rejects.toBeInstanceOf(
      InsufficientCourseContentError,
    );
    // L'étape de dialogue ne doit jamais être appelée sans notion validée.
    expect(askMock).toHaveBeenCalledTimes(1);
  });

  it('échoue si le dialogue ne contient aucune affirmation vérifiable', async () => {
    askMock
      .mockResolvedValueOnce(JSON.stringify([{ label: 'Composition', refs: ['S1'] }]))
      .mockResolvedValueOnce(
        JSON.stringify([{ speaker: 'A', type: 'intro', source: 'none', text: 'Bonjour.' }]),
      );

    await expect(generatePodcastEpisode(baseInput())).rejects.toBeInstanceOf(AiRequestError);
  });

  it('signale la progression à chaque étape franchie', async () => {
    askMock
      .mockResolvedValueOnce(JSON.stringify([{ label: 'Composition', refs: ['S1'] }]))
      .mockResolvedValueOnce(
        JSON.stringify([{ speaker: 'B', type: 'concept', source: 'cours', text: 'Fait [S1].' }]),
      );

    const stages: string[] = [];
    await generatePodcastEpisode(baseInput({ onStage: (stage) => stages.push(stage) }));

    expect(stages).toEqual(['analyse', 'plan', 'dialogue', 'validation']);
  });
});
