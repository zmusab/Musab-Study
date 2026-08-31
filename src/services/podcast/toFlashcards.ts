import type { NewFlashcard } from '@/data/repositories/cards';
import type { PodcastConcept, PodcastEpisode } from '@/types';

/**
 * Convertit une notion du podcast en carte de révision.
 *
 * La réponse n'est jamais reformulée par l'IA à cette étape : elle est
 * composée directement des extraits de cours déjà cités et vérifiés pour
 * cette notion (`concept.citations`). Une carte issue du podcast reste donc
 * aussi fidèle au cours qu'une carte générée directement depuis un document.
 */
export function conceptToFlashcard(concept: PodcastConcept, episode: PodcastEpisode): NewFlashcard {
  return {
    subjectId: episode.subjectId,
    chapterId: episode.chapterId,
    question: `Qu'est-ce que : ${concept.label} ?`,
    answer: concept.citations.map((citation) => citation.excerpt).join(' '),
    importance: concept.importance,
    origin: 'ai',
    sourceChunkIds: concept.citations.map((citation) => citation.chunkId),
  } satisfies NewFlashcard;
}
