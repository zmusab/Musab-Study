import { answerStats } from '@/core/progress';
import type { Evaluation } from '@/core/progress/exam';
import type { ChapterAnalysis, Flashcard, ID, ReviewLog } from '@/types';

/**
 * ESTIMATION « EXAMEN PROBABLE » — jamais une prédiction.
 *
 * Module pur, sans appel IA ici : le signal IA existe déjà dans
 * `db.chapterAnalyses`, produit par `services/courses/notions.ts`
 * (`analyzeChapter`), lui-même bâti pour ne jamais citer un passage qui ne
 * lui a pas été transmis — la même garantie anti-hallucination que le reste
 * de l'application. Ce module se contente d'agréger CES données déjà
 * vérifiées avec des signaux tout aussi réels (importance des flashcards,
 * historique de réponses, proximité d'un examen enregistré au calendrier)
 * pour produire une estimation, jamais une certitude.
 *
 * Deux notions RESTENT séparées à dessein :
 * - le score de PROBABILITÉ (🟢🟡🟠) reflète le CONTENU du cours (importance,
 *   répétition, caractère fondamental, proximité d'examen) — jamais la
 *   performance personnelle de l'étudiant, qu'il serait malhonnête de
 *   présenter comme rendant une notion « plus probable à l'examen » ;
 * - l'ORDRE de sélection des questions, lui, combine ce score avec les
 *   lacunes RÉELLEMENT mesurées de l'étudiant (réponses passées, cartes
 *   jamais révisées) — c'est ce qui fait que deux étudiants reçoivent des
 *   séries différentes sans que le badge affiché mente sur ce qu'il mesure.
 */

export type ExamLikelihood = 'high' | 'medium' | 'low';

export interface ExamLikelihoodInfo {
  level: ExamLikelihood;
  /** 1 à 2 raisons concrètes, réellement vraies pour cette carte — jamais une formule générique présentée comme un fait. */
  reasons: string[];
  /** Le chapitre réel sur lequel se base l'estimation — jamais un contenu inventé. */
  chapterName: string | null;
}

/** Agrégats réels d'un chapitre, tirés de son analyse IA déjà enregistrée. Absent si le chapitre n'a jamais été analysé. */
export interface ChapterSignal {
  maxImportance: 1 | 2 | 3;
  /** Part des notions signalées comme pièges fréquents. */
  pitfallShare: number;
  /** Nombre moyen de passages du cours citant chaque notion — un proxy réel de répétition dans le contenu. */
  avgCitations: number;
  notionCount: number;
}

/** N'agrège que des analyses réellement enregistrées — un chapitre jamais analysé n'a simplement pas d'entrée. */
export function chapterSignalsFromAnalyses(analyses: readonly ChapterAnalysis[]): Map<ID, ChapterSignal> {
  const byChapter = new Map<ID, ChapterSignal>();
  for (const analysis of analyses) {
    if (analysis.notions.length === 0) continue;
    const maxImportance = Math.max(...analysis.notions.map((notion) => notion.importance)) as 1 | 2 | 3;
    const pitfallShare = analysis.notions.filter((notion) => notion.isPitfall).length / analysis.notions.length;
    const avgCitations =
      analysis.notions.reduce((sum, notion) => sum + notion.citations.length, 0) / analysis.notions.length;
    byChapter.set(analysis.chapterId, { maxImportance, pitfallShare, avgCitations, notionCount: analysis.notions.length });
  }
  return byChapter;
}

const IMPORTANCE_BASE: Record<1 | 2 | 3, number> = { 1: 0.2, 2: 0.5, 3: 0.85 };
/** En-dessous de 14 jours, l'échéance est assez proche pour justifier d'insister davantage sur les notions déjà fondamentales. */
const EXAM_PROXIMITY_DAYS = 14;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Score de probabilité de CONTENU (0..1) et sa justification, pour une seule
 * carte. Ne dépend que de faits réels : l'importance déclarée de la carte,
 * l'analyse IA déjà enregistrée du chapitre (si elle existe) et un examen
 * réellement enregistré au calendrier (si sélectionné). Rien n'est déduit
 * d'une donnée absente — l'absence de signal fait simplement rester le score
 * bas, jamais une supposition compense.
 */
export function scoreExamLikelihood(
  card: Flashcard,
  chapterName: string | null,
  chapterSignal: ChapterSignal | undefined,
  evaluation: Evaluation | null,
): { score: number; info: ExamLikelihoodInfo } {
  let score = IMPORTANCE_BASE[card.importance];
  const reasons: string[] = [];
  let fundamental = card.importance === 3;

  if (card.importance === 3) reasons.push('Marquée « tombe à l’examen » dans tes flashcards.');

  if (chapterSignal) {
    score += (chapterSignal.maxImportance / 3) * 0.25;
    if (chapterSignal.maxImportance === 3) {
      fundamental = true;
      reasons.push('Ce chapitre contient au moins une notion jugée essentielle par l’analyse du cours.');
    }
    if (chapterSignal.pitfallShare > 0) {
      score += chapterSignal.pitfallShare * 0.15;
      reasons.push('Ce chapitre contient une source d’erreur fréquente identifiée dans le cours.');
    }
    if (chapterSignal.avgCitations >= 1.6) {
      score += 0.1;
      reasons.push('Notion présente à plusieurs endroits du cours — répétée dans le contenu indexé.');
    }
  }

  // La proximité d'un examen n'augmente le score QUE pour une notion déjà
  // fondamentale par ailleurs, et seulement à l'approche réelle de
  // l'échéance : jamais de bonus générique justifié par la seule existence
  // d'un examen, comme demandé.
  if (evaluation && fundamental && evaluation.daysUntil <= EXAM_PROXIMITY_DAYS) {
    score += 0.1;
    const days = evaluation.daysUntil;
    reasons.push(
      `Examen dans ${days} jour${days > 1 ? 's' : ''} — l’accent est mis sur les notions déjà essentielles à l’approche de l’échéance.`,
    );
  }

  score = clamp01(score);
  const level: ExamLikelihood = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';

  if (reasons.length === 0) {
    reasons.push(
      'Estimation basée uniquement sur sa présence dans tes flashcards — aucune analyse de cours ni examen proche ne renforce ce signal pour l’instant.',
    );
  }

  return { score, info: { level, reasons: reasons.slice(0, 2), chapterName } };
}

/**
 * Lacune RÉELLEMENT mesurée sur une carte (0..1, plus haut = plus fragile) —
 * sert uniquement à ORDONNER les questions, jamais à colorer le badge de
 * probabilité. Une carte jamais révisée reste neutre : ni supposée acquise,
 * ni supposée fragile faute de donnée.
 */
export function weaknessScore(card: Flashcard, logs: readonly ReviewLog[]): number {
  const cardLogs = logs.filter((log) => log.itemId === card.id && log.itemKind !== 'session');
  const stats = answerStats(cardLogs);
  if (stats.successRate !== null) return 1 - stats.successRate;
  return card.reps === 0 ? 0.5 : 0.3;
}

export interface ExamLikelyRanking {
  /** Les cartes du périmètre, triées probabilité de contenu + lacune réelle décroissantes. */
  ordered: Flashcard[];
  infoByCardId: Map<ID, { score: number; info: ExamLikelihoodInfo }>;
}

/**
 * Classe un vivier de cartes pour le mode « Examen probable » : combine le
 * score de contenu (probabilité) et la lacune mesurée de l'étudiant, pour
 * que deux étudiants aux lacunes différentes reçoivent un ordre différent —
 * sans que cela change ce que le badge de probabilité affiché mesure.
 */
export function rankForExamLikely(
  cards: readonly Flashcard[],
  chapterSignals: Map<ID, ChapterSignal>,
  chapterNameOf: (chapterId: ID | null) => string | null,
  logs: readonly ReviewLog[],
  evaluation: Evaluation | null,
): ExamLikelyRanking {
  const infoByCardId = new Map<ID, { score: number; info: ExamLikelihoodInfo }>();
  for (const card of cards) {
    const signal = card.chapterId ? chapterSignals.get(card.chapterId) : undefined;
    infoByCardId.set(card.id, scoreExamLikelihood(card, chapterNameOf(card.chapterId), signal, evaluation));
  }

  const orderScore = (card: Flashcard): number =>
    infoByCardId.get(card.id)!.score * 0.6 + weaknessScore(card, logs) * 0.4;

  const ordered = [...cards].sort((a, b) => orderScore(b) - orderScore(a));
  return { ordered, infoByCardId };
}
