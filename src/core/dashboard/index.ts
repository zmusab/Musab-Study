import type { Flashcard, ID, ReviewLog } from '@/types';
import { masteryLevel } from '@/core/mastery';

/**
 * Logique de l'accueil — pure, testable, alimentée UNIQUEMENT par des
 * données réellement présentes dans l'application. Rien ici ne doit
 * produire un nombre, une notion faible ou une recommandation qui ne
 * découle pas d'un calcul sur des enregistrements réels : c'est la même
 * exigence que pour l'assistant IA, appliquée à l'accueil.
 */

// ─────────────────────── Triage de la session recommandée ───────────────────────

export interface DueTriage {
  /** Maîtrise très faible (niveau 0) — la carte a de bonnes chances d'être déjà oubliée. */
  atRisk: number;
  /** Maîtrise faible à moyenne (niveaux 1-2). */
  difficult: number;
  /** Maîtrise bonne à acquise (niveaux 3-4), due malgré tout. */
  normal: number;
  total: number;
}

/** Répartit les cartes dues par risque d'oubli, à partir de leur maîtrise réelle (SM-2). */
export function triageDueCards(
  cards: readonly Pick<Flashcard, 'ease' | 'interval' | 'reps'>[],
): DueTriage {
  let atRisk = 0;
  let difficult = 0;
  let normal = 0;

  for (const card of cards) {
    const level = masteryLevel(card);
    if (level === 0) atRisk += 1;
    else if (level <= 2) difficult += 1;
    else normal += 1;
  }

  return { atRisk, difficult, normal, total: cards.length };
}

const DEFAULT_SECONDS_PER_CARD = 35;

/** Temps moyen réellement passé par révision, à partir du journal — null sans historique. */
export function averageElapsedMs(logs: readonly Pick<ReviewLog, 'elapsedMs'>[]): number | null {
  if (logs.length === 0) return null;
  const sum = logs.reduce((total, log) => total + log.elapsedMs, 0);
  return sum / logs.length;
}

/**
 * Durée estimée d'une session, en minutes. Utilise le temps moyen RÉEL passé
 * par carte (journal de révisions) quand il existe ; une estimation par
 * défaut sinon — jamais un chiffre présenté comme mesuré alors qu'il ne
 * l'est pas.
 */
export function estimateSessionMinutes(count: number, avgElapsedMs: number | null): number {
  if (count === 0) return 0;
  const perCardSeconds = avgElapsedMs && avgElapsedMs > 0 ? avgElapsedMs / 1000 : DEFAULT_SECONDS_PER_CARD;
  return Math.max(1, Math.round((count * perCardSeconds) / 60));
}

// ─────────────────────────── Notions fragiles ───────────────────────────

export interface WeakConcept {
  cardId: ID;
  question: string;
  reason: string;
  /** Plus élevé = plus préoccupant ; sert uniquement au tri interne. */
  severity: number;
}

const RECENT_WINDOW_MS = 7 * 86_400_000;

/**
 * Identifie les cartes fragiles à partir du journal de révisions réel — trois
 * signaux, jamais un score arbitraire :
 *  1. La dernière révision a échoué → oubliée.
 *  2. Plusieurs échecs cette semaine → instable.
 *  3. Réussites récentes mais déclarées peu confiantes → maîtrise fragile.
 */
export function computeWeakConcepts(
  cards: readonly Flashcard[],
  logs: readonly ReviewLog[],
  now: Date = new Date(),
  limit = 3,
): WeakConcept[] {
  const logsByCard = new Map<ID, ReviewLog[]>();
  for (const log of logs) {
    if (log.itemKind !== 'card') continue;
    const list = logsByCard.get(log.itemId);
    if (list) list.push(log);
    else logsByCard.set(log.itemId, [log]);
  }

  const cutoff = now.getTime() - RECENT_WINDOW_MS;
  const results: WeakConcept[] = [];

  for (const card of cards) {
    const cardLogs = logsByCard.get(card.id);
    if (!cardLogs || cardLogs.length === 0) continue;
    const sorted = [...cardLogs].sort((a, b) => a.at.localeCompare(b.at));
    const last = sorted[sorted.length - 1]!;
    const recentFailures = sorted.filter(
      (log) => !log.correct && new Date(log.at).getTime() >= cutoff,
    ).length;

    let reason: string | null = null;
    let severity = 0;

    if (!last.correct) {
      reason = 'Oublié lors de ta dernière révision.';
      severity = 3;
    } else if (recentFailures >= 2) {
      reason = `${recentFailures} erreurs cette semaine.`;
      severity = 2;
    } else {
      const hesitant = sorted.slice(-3).filter((log) => log.correct && log.confidence === 'low').length;
      if (hesitant >= 2) {
        reason = 'Répondu correctement, mais avec hésitation.';
        severity = 1;
      }
    }

    if (reason) results.push({ cardId: card.id, question: card.question, reason, severity });
  }

  return results.sort((a, b) => b.severity - a.severity).slice(0, limit);
}

// ─────────────────────────────── Accroche ───────────────────────────────

export interface GreetingSignals {
  totalDue: number;
  atRisk: number;
  weakCount: number;
}

/** Phrase d'accroche, choisie selon l'état réel de l'étude — jamais un message générique fixe. */
export function computeGreeting(signals: GreetingSignals): string {
  if (signals.totalDue === 0) return 'Tu es à jour. Profite de ta journée.';
  if (signals.atRisk > 0 || signals.weakCount > 0) return 'Quelques notions commencent à devenir fragiles.';
  return 'Voyons ce que ton cerveau doit retenir aujourd’hui.';
}

// ────────────────────────────── Résumé du jour ──────────────────────────────

export interface DailySummary {
  cardsReviewed: number;
  minutesStudied: number;
  documentsOpened: number;
}

/** Résumé de l'activité du jour, entièrement dérivé du journal de révisions et des ouvertures de documents. */
export function computeDailySummary(todayLogs: readonly ReviewLog[], documentsOpenedToday: number): DailySummary {
  const cardsReviewed = todayLogs.filter((log) => log.itemKind === 'card').length;
  const minutesStudied = Math.round(todayLogs.reduce((sum, log) => sum + log.elapsedMs, 0) / 60_000);
  return { cardsReviewed, minutesStudied, documentsOpened: documentsOpenedToday };
}
