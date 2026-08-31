import { db } from '@/data/db';
import type { ID, PodcastEpisode } from '@/types';

export async function listPodcastEpisodes(subjectId: ID): Promise<PodcastEpisode[]> {
  const episodes = await db.podcastEpisodes.where('subjectId').equals(subjectId).toArray();
  return episodes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPodcastEpisode(id: ID): Promise<PodcastEpisode | undefined> {
  return db.podcastEpisodes.get(id);
}

export async function savePodcastEpisode(episode: PodcastEpisode): Promise<void> {
  await db.podcastEpisodes.add(episode);
}

export async function deletePodcastEpisode(id: ID): Promise<void> {
  await db.podcastEpisodes.delete(id);
}
