import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import type { ID, PodcastEpisode } from '@/types';

export function usePodcastEpisodes(subjectId: ID | undefined): PodcastEpisode[] | undefined {
  return useLiveQuery(async () => {
    if (!subjectId) return [];
    const episodes = await db.podcastEpisodes.where('subjectId').equals(subjectId).toArray();
    return episodes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [subjectId]);
}

export function usePodcastEpisode(episodeId: ID | undefined): PodcastEpisode | undefined | null {
  return useLiveQuery(
    async () => (episodeId ? ((await db.podcastEpisodes.get(episodeId)) ?? null) : null),
    [episodeId],
  );
}
