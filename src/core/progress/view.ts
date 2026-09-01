import type { CalendarEvent, Chapter, Flashcard, ID, ReviewLog, Subject } from '@/types';
import {
  answerStats,
  computeStreak,
  goalProgress,
  masteryTrend,
  overallMastery,
  recentActivity,
  studyTime,
  subjectProgress,
  upcomingReviews,
  weakPoints,
  type ActivitySession,
  type AnswerStats,
  type GoalProgress,
  type OverallMastery,
  type StudyTime,
  type Streak,
  type SubjectProgress,
  type TrendPoint,
  type UpcomingDay,
  type WeakPoint,
} from './index';
import {
  examReadiness,
  mainRecommendation,
  nextEvaluationFor,
  priorityItems,
  strengths,
  upcomingEvaluations,
  type Evaluation,
  type ExamReadiness,
  type MainRecommendation,
  type PriorityItem,
  type StrengthItem,
} from './exam';

/**
 * Assemblage complet du tableau de bord, en UNE fonction pure.
 *
 * Le filtre par matière est appliqué ICI, sur les tables déjà chargées :
 * changer de matière ne relit donc pas la base, ne déclenche aucune requête
 * et se contente d'un recalcul mémorisé. C'est aussi ce qui rend la vue
 * entièrement testable — mêmes tables, même instant, même résultat.
 *
 * Trois familles d'indicateurs, volontairement séparées (§25 du cahier des
 * charges) : la PROGRESSION dit où l'on en est, la SUFFISANCE EXAMEN dit si
 * le niveau paraît assez solide, les PRIORITÉS disent quoi faire maintenant.
 */

export interface ProgressTables {
  subjects: Subject[];
  chapters: Chapter[];
  cards: Flashcard[];
  logs: ReviewLog[];
  events: CalendarEvent[];
}

export interface ProgressGoals {
  weeklyStudyMinutes: number;
  weeklyReviews: number;
}

export interface SubjectReadiness {
  subject: Subject;
  readiness: ExamReadiness;
  /** Évaluation réellement inscrite au calendrier — null si aucune. */
  evaluation: Evaluation | null;
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
  strengths: StrengthItem[];
  activity: ActivitySession[];
  trend: TrendPoint[];
  upcoming: UpcomingDay[];
  goals: GoalProgress[];
  dueTotal: number;
  chaptersToReview: number;
  totalStudyMs: number;

  // Suffisance examen, calendrier et priorités
  evaluations: Evaluation[];
  readiness: SubjectReadiness[];
  /** Moyenne des suffisances mesurables — null si aucune ne l'est. */
  globalReadiness: { pct: number; subjects: number } | null;
  /** Matière dont l'évaluation est la plus proche, si une date existe. */
  focus: SubjectReadiness | null;
  priorities: PriorityItem[];
  recommendation: MainRecommendation | null;
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
  const events = subjectId ? tables.events.filter((e) => e.subjectId === subjectId) : tables.events;

  const nowIso = now.toISOString();
  const weak = weakPoints(subjects, chapters, cards, logs);
  const evaluations = upcomingEvaluations(events, subjects, now);

  const readiness: SubjectReadiness[] = subjects
    .filter((subject) => cards.some((card) => card.subjectId === subject.id))
    .map((subject) => ({
      subject,
      readiness: examReadiness(subject.id, chapters, cards, logs, now),
      evaluation: nextEvaluationFor(evaluations, subject.id),
    }));

  const measured = readiness.filter((entry) => entry.readiness.pct !== null);
  const priorities = priorityItems(subjects, chapters, cards, logs, evaluations, now);

  // La matière « en focus » est celle dont l'évaluation est la plus proche.
  // Sans aucune date au calendrier, il n'y en a pas — et la page continue de
  // fonctionner grâce à la suffisance examen seule.
  const focus =
    readiness
      .filter((entry) => entry.evaluation !== null)
      .sort((a, b) => a.evaluation!.daysUntil - b.evaluation!.daysUntil)[0] ?? null;

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
    strengths: strengths(subjects, chapters, cards, logs),
    activity: recentActivity(logs, subjects),
    trend: masteryTrend(cards, logs, 6, now),
    upcoming: upcomingReviews(cards, subjects, 7, now),
    goals: goalProgress(options.goals, logs, now),
    dueTotal: cards.filter((card) => card.due <= nowIso).length,
    // « À revoir » compte les points faibles mesurés, pas les cartes dues :
    // ce sont deux notions différentes et les confondre gonflerait le chiffre.
    chaptersToReview: weak.filter((point) => point.scope === 'chapter').length,
    totalStudyMs: logs.reduce((sum, log) => sum + log.elapsedMs, 0),

    evaluations,
    readiness,
    globalReadiness:
      measured.length > 0
        ? {
            pct: Math.round(measured.reduce((sum, entry) => sum + entry.readiness.pct!, 0) / measured.length),
            subjects: measured.length,
          }
        : null,
    focus,
    priorities,
    recommendation: mainRecommendation(priorities),
  };
}
