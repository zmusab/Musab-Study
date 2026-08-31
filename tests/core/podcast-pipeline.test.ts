import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { Chapter, DocumentChunk, StudyDocument, Subject } from '@/types';

/**
 * Test d'intégration du pipeline, sans appel réseau réel : `ask()` est
 * simulé pour renvoyer des réponses canoniques, ce qui permet de vérifier
 * l'ORCHESTRATION (ordre des étapes, filtrage du contexte entre l'analyse et
 * le dialogue, propagation des erreurs) sans dépendre d'une clé API.
 */
const askMock = vi.fn();
vi.mock('@/services/ai/client', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/client')>('@/services/ai/client');
  return { ...actual, ask: (...args: unknown[]) => askMock(...args) };
});

const { generatePodcastEpisode, InsufficientCourseContentError } = await import('@/services/podcast/pipeline');
const { AiRequestError } = await import('@/services/ai/client');

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

  it("confie l'analyse à un modèle rapide, quel que soit le modèle de dialogue", async () => {
    // Le levier de performance central : l'extraction des notions est une
    // tâche mécanique déléguée à Haiku, jamais au modèle choisi par
    // l'utilisateur pour la qualité du dialogue.
    askMock
      .mockResolvedValueOnce(JSON.stringify([{ label: 'Composition', refs: ['S1'] }]))
      .mockResolvedValueOnce(
        JSON.stringify([{ speaker: 'B', type: 'concept', source: 'cours', text: 'Fait [S1].' }]),
      );

    await generatePodcastEpisode(baseInput());

    const analysisCallOptions = askMock.mock.calls[0]![0];
    const dialogueCallOptions = askMock.mock.calls[1]![0];

    expect(analysisCallOptions.model).toBe('claude-haiku-4-5');
    // L'appel de dialogue n'impose PAS de modèle : il utilise celui choisi
    // par l'utilisateur dans les Paramètres.
    expect(dialogueCallOptions.model).toBeUndefined();
    expect(dialogueCallOptions.effort).toBe('medium');
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
