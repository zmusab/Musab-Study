import type { Chapter, Flashcard, ID, ReviewLog, Subject } from '@/types';
import {
  answerStats,
  computeStreak,
  goalProgress,
  masteryTrend,
  overallMastery,
  recentActivity,
  recommendation,
  studyTime,
  subjectProgress,
  upcomingReviews,
  weakPoints,
  type ActivitySession,
  type AnswerStats,
  type GoalProgress,
  type OverallMastery,
  type Recommendation,
  type StudyTime,
  type Streak,
  type SubjectProgress,
  type TrendPoint,
  type UpcomingDay,
  type WeakPoint,
} from './index';

/**
 * Assemblage complet du tableau de bord, en UNE fonction pure.
 *
 * Le filtre par matière est appliqué ICI, sur les tables déjà chargées :
 * changer de matière ne relit donc pas la base, ne déclenche aucune requête
 * et se contente d'un recalcul mémorisé. C'est aussi ce qui rend la vue
 * entièrement testable — mêmes tables, même instant, même résultat.
 */

export interface ProgressTables {
  subjects: Subject[];
  chapters: Chapter[];
  cards: Flashcard[];
  logs: ReviewLog[];
}

export interface ProgressGoals {
  weeklyStudyMinutes: number;
  weeklyReviews: number;
}

export interface ProgressView {
  hasAnySubject: boolean;
  hasAnyCard: boolean;
  hasAnyReview: boolean;

  mastery: OverallMastery;
  answers: AnswerStats;
  time: StudyTime;
  streak: Streak;
  subjects: SubjectProgress[];
  weak: WeakPoint[];
  recommendation: Recommendation | null;
  activity: ActivitySession[];
  trend: TrendPoint[];
  upcoming: UpcomingDay[];
  goals: GoalProgress[];
  dueTotal: number;
  /** Points faibles de niveau chapitre — le « à revoir » du résumé. */
  chaptersToReview: number;
  /** Temps de révision cumulé sur toute la période enregistrée. */
  totalStudyMs: number;
}

export function progressView(
  tables: ProgressTables,
  options: { subjectId?: ID | null; goals: ProgressGoals; now?: Date },
): ProgressView {
  const now = options.now ?? new Date();
  const subjectId = options.subjectId ?? null;

  // Le périmètre est réduit AVANT tout calcul : aucune statistique affichée
  // ne peut alors mélanger une matière filtrée avec les autres.
  const subjects = subjectId ? tables.subjects.filter((s) => s.id === subjectId) : tables.subjects;
  const chapters = subjectId ? tables.chapters.filter((c) => c.subjectId === subjectId) : tables.chapters;
  const cards = subjectId ? tables.cards.filter((c) => c.subjectId === subjectId) : tables.cards;
  const logs = subjectId ? tables.logs.filter((l) => l.subjectId === subjectId) : tables.logs;

  const nowIso = now.toISOString();
  const weak = weakPoints(subjects, chapters, cards, logs);

  return {
    hasAnySubject: tables.subjects.length > 0,
    hasAnyCard: cards.length > 0,
    hasAnyReview: logs.length > 0,

    mastery: overallMastery(cards),
    answers: answerStats(logs),
    time: studyTime(logs, now),
    streak: computeStreak(logs, now),
    subjects: subjectProgress(subjects, chapters, cards, logs, now),
    weak,
    recommendation: recommendation(subjects, chapters, cards, logs, now),
    activity: recentActivity(logs, subjects),
    trend: masteryTrend(cards, logs, 6, now),
    upcoming: upcomingReviews(cards, subjects, 7, now),
    goals: goalProgress(options.goals, logs, now),
    dueTotal: cards.filter((card) => card.due <= nowIso).length,
    chaptersToReview: weak.filter((point) => point.scope === 'chapter').length,
    totalStudyMs: logs.reduce((sum, log) => sum + log.elapsedMs, 0),
  };
}
