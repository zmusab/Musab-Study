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

/** Mémorise la réplique atteinte, pour reprendre l'écoute là où elle s'est arrêtée. */
export async function updatePodcastProgress(
  episodeId: ID,
  segmentIndex: number,
  now: Date = new Date(),
): Promise<void> {
  await db.podcastEpisodes.update(episodeId, {
    lastSegmentIndex: segmentIndex,
    lastPlayedAt: now.toISOString(),
  });
}

/** L'épisode le plus récemment écouté, non terminé — pour « Continuer l'écoute » sur l'accueil. */
export async function getMostRecentUnfinishedEpisode(): Promise<PodcastEpisode | undefined> {
  const episodes = await db.podcastEpisodes.filter((ep) => ep.lastPlayedAt !== null).toArray();
  const unfinished = episodes.filter((ep) => ep.lastSegmentIndex < ep.segments.length - 1);
  unfinished.sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''));
  return unfinished[0];
}
