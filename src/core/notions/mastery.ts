import { masteryPct } from '@/core/mastery';
import type { Flashcard, ID } from '@/types';

/**
 * MAÎTRISE PAR NOTION — le bout de la chaîne cours → notion → carte → révision.
 *
 * Jusqu'ici l'application savait dire « tu maîtrises la carte n°123 ». Un
 * étudiant, lui, ne révise pas des cartes : il révise le nerf trijumeau. Les
 * notions existaient bien (onglet « Notions », quiz « Examen probable ») mais
 * dans un blob JSON par chapitre, sans le moindre lien vers les cartes — deux
 * mondes parallèles nés pourtant du MÊME sujet extrait du cours.
 *
 * Le chaînon manquant était minuscule : `Flashcard.notionKey`, écrit à la
 * génération. Aucune table, aucun graphe de connaissances, aucune migration —
 * juste un regroupement.
 *
 * Ce module est pur et local : il agrège `masteryPct`, la définition unique de
 * la maîtrise du projet. Il ne crée pas une seconde échelle concurrente.
 */

export interface NotionMastery {
  /** Forme normalisée — la clé de regroupement. */
  key: string;
  /** Formulation exacte du cours, telle qu'elle sera affichée. */
  label: string;
  subjectId: ID;
  cardCount: number;
  /** Cartes de la notion déjà révisées au moins une fois. */
  reviewedCount: number;
  /** Cartes dont la répétition espacée programme la révision maintenant. */
  dueCount: number;
  /**
   * Maîtrise moyenne sur les cartes RÉELLEMENT révisées, ou `null` si aucune ne
   * l'a été. Un `0 %` sur une notion jamais travaillée serait un jugement, pas
   * une mesure — même règle que `masteryStatus` pour une carte neuve.
   */
  masteryPct: number | null;
}

/**
 * Regroupe des cartes par notion. Les cartes sans notion (saisie manuelle,
 * cartes créées avant l'introduction du lien) sont simplement ignorées : elles
 * comptent dans la maîtrise globale, mais ne peuvent être rattachées à aucune
 * notion sans deviner.
 */
export function notionMastery(cards: readonly Flashcard[], now: Date = new Date()): NotionMastery[] {
  const nowIso = now.toISOString();
  const groups = new Map<string, Flashcard[]>();

  for (const card of cards) {
    const key = card.notionKey;
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(card);
    else groups.set(key, [card]);
  }

  const result: NotionMastery[] = [];
  for (const [key, group] of groups) {
    const reviewed = group.filter((card) => card.reps > 0);
    const total = reviewed.reduce((sum, card) => sum + masteryPct(card), 0);

    result.push({
      key,
      // Le libellé le plus fréquent du groupe : plusieurs cartes peuvent citer
      // le même sujet avec une casse ou un article légèrement différents.
      label: mostFrequentLabel(group) ?? key,
      subjectId: group[0]!.subjectId,
      cardCount: group.length,
      reviewedCount: reviewed.length,
      dueCount: group.filter((card) => card.due <= nowIso).length,
      masteryPct: reviewed.length > 0 ? Math.round(total / reviewed.length) : null,
    });
  }

  // Les notions les plus fragiles d'abord — jamais révisées en tête, puis par
  // maîtrise croissante : c'est l'ordre dans lequel elles méritent du travail.
  return result.sort((a, b) => {
    if (a.masteryPct === null && b.masteryPct !== null) return -1;
    if (a.masteryPct !== null && b.masteryPct === null) return 1;
    return (a.masteryPct ?? 0) - (b.masteryPct ?? 0);
  });
}

function mostFrequentLabel(cards: readonly Flashcard[]): string | null {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (!card.notionLabel) continue;
    counts.set(card.notionLabel, (counts.get(card.notionLabel) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Notions les plus fragiles, pour orienter une session. Une notion jamais
 * révisée n'est PAS « fragile » — elle est inconnue : elle est proposée, mais
 * après celles dont la faiblesse est mesurée.
 */
export function weakestNotions(cards: readonly Flashcard[], limit = 5, now: Date = new Date()): NotionMastery[] {
  const measured = notionMastery(cards, now).filter((notion) => notion.reviewedCount > 0);
  return measured.slice(0, limit);
}
