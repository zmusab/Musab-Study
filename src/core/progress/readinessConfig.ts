/**
 * PARAMÈTRES DE LA SUFFISANCE EXAMEN — des heuristiques, pas une science.
 *
 * Aucun de ces nombres n'est issu d'une étude, d'un calibrage sur des notes
 * réelles ni d'une littérature pédagogique. Ce sont des CHOIX DE CONCEPTION,
 * assumés comme tels : ils traduisent une intuition raisonnable de ce qui
 * rend quelqu'un prêt pour une évaluation, et rien de plus.
 *
 * Conséquence directe, à respecter partout dans l'interface : la suffisance
 * examen ne prédit PAS une note et ne doit jamais être présentée comme une
 * probabilité de réussite. C'est un repère de préparation, comparable d'une
 * semaine à l'autre parce que la formule ne bouge pas — pas une prévision.
 *
 * Tout est regroupé ici pour une raison pratique : le jour où assez de
 * résultats d'examens réels seront enregistrés dans l'application, ces
 * valeurs pourront être ajustées (ou apprises) en un seul endroit, sans
 * toucher au calcul lui-même. Les tests vérifient le COMPORTEMENT (couvrir
 * la moitié du programme fait baisser la note, une rechute la fait baisser…)
 * et non les valeurs exactes, précisément pour que ce réglage reste possible.
 */
export interface ReadinessConfig {
  /**
   * Répartition de la note de départ entre les deux signaux de CONNAISSANCE.
   * Doit sommer à 1 — un test le vérifie.
   */
  masteryWeight: number;
  reliabilityWeight: number;

  /**
   * Planchers des deux MODULATEURS. Un modulateur multiplie la note de
   * départ par une valeur comprise entre son plancher et 1 : il ne peut donc
   * que la faire baisser. Avoir couvert tout le programme ou avoir révisé
   * hier ne rend pas prêt en soi ; n'avoir vu qu'un quart du cours, ou n'y
   * avoir plus touché depuis six semaines, rend clairement moins prêt.
   */
  coverageFloor: number;
  freshnessModulatorFloor: number;

  /** Part de la note finale tirée du chapitre le plus faible. */
  weakestShare: number;

  /** Jours au-delà desquels une révision ne compte plus comme « fraîche ». */
  freshnessHorizonDays: number;
  /** Plancher de fraîcheur : une connaissance ancienne s'affaiblit, elle ne disparaît pas. */
  freshnessFloor: number;
  /** Plafond de la pénalité de rechute appliquée à la fiabilité. */
  maxLapsePenalty: number;
}

export const DEFAULT_READINESS_CONFIG: ReadinessConfig = {
  masteryWeight: 0.55,
  reliabilityWeight: 0.45,
  coverageFloor: 0.5,
  freshnessModulatorFloor: 0.75,
  weakestShare: 0.25,
  freshnessHorizonDays: 40,
  freshnessFloor: 0.25,
  maxLapsePenalty: 0.35,
};

/**
 * PARAMÈTRES DE PRIORITÉ — mêmes réserves : des poids de conception.
 *
 * Ils décident de ce qui remonte en tête de « À travailler en priorité ».
 * Contrairement à la suffisance, ils n'ont pas à être « justes » dans
 * l'absolu : il suffit qu'ils classent sensément.
 */
export interface PriorityConfig {
  weaknessWeight: number;
  errorWeight: number;
  stalenessWeight: number;
  /** Poids du volume de cartes — approxime l'importance d'un chapitre. */
  shareWeight: number;
  stalenessHorizonDays: number;
  /** Fenêtre au-delà de laquelle une évaluation n'accélère plus rien. */
  urgencyHorizonDays: number;
  /** Multiplicateur d'urgence par nature d'évaluation, à échéance immédiate. */
  kindWeight: Record<string, number>;
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  weaknessWeight: 45,
  errorWeight: 25,
  stalenessWeight: 20,
  shareWeight: 10,
  stalenessHorizonDays: 45,
  urgencyHorizonDays: 30,
  kindWeight: { final: 1.5, exam: 1.3, midterm: 1, task: 0.5 },
};
