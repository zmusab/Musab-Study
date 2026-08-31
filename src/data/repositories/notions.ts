import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import type { ChapterAnalysis, ID, PodcastConcept } from '@/types';

export async function getChapterAnalysis(chapterId: ID): Promise<ChapterAnalysis | undefined> {
  return db.chapterAnalyses.where('chapterId').equals(chapterId).first();
}

export async function listSubjectAnalyses(subjectId: ID): Promise<ChapterAnalysis[]> {
  return db.chapterAnalyses.where('subjectId').equals(subjectId).toArray();
}

/**
 * Enregistre (ou remplace) l'analyse d'un chapitre. Un chapitre n'a qu'une
 * analyse à la fois — ré-analyser écrase la précédente plutôt que
 * d'accumuler des doublons.
 */
export async function saveChapterAnalysis(
  subjectId: ID,
  chapterId: ID,
  notions: PodcastConcept[],
): Promise<ChapterAnalysis> {
  const existing = await getChapterAnalysis(chapterId);
  const analysis: ChapterAnalysis = {
    id: existing?.id ?? uid('analysis'),
    subjectId,
    chapterId,
    notions,
    generatedAt: nowISO(),
  };
  await db.chapterAnalyses.put(analysis);
  return analysis;
}
