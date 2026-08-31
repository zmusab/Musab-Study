import type { AIProvider, AIProviderCapabilities, AITask, QualityTier } from './types';

/**
 * Table de routage : pour chaque tâche, le niveau de qualité voulu et,
 * éventuellement, les capacités minimales requises ou un modèle imposé.
 *
 * Reproduit exactement les réglages qui vivaient jusqu'ici dispersés dans
 * chaque call site (`effort: 'medium'`, `model: 'claude-haiku-4-5'`…) — le
 * comportement observable ne change pas, seul l'endroit où il est décrit
 * change. `quiz-generate` et `anatomy-explain` sont réservées : aucune
 * fonctionnalité ne les appelle encore (Quiz et Anatomie ne sont pas
 * construits), mais la table est prête à les recevoir.
 */
export interface TaskRoute {
  tier?: QualityTier;
  /** Force un modèle précis pour cette tâche, quel que soit le réglage général de l'utilisateur. */
  preferredModel?: string;
  /** Capacités minimales — un provider qui ne les a pas n'est pas candidat pour cette tâche. */
  requires?: Partial<Pick<AIProviderCapabilities, 'webSearch' | 'vision' | 'structuredOutput'>>;
}

export const TASK_ROUTES: Record<AITask, TaskRoute> = {
  // Une réponse en mode cours est une tâche de citation ancrée dans un
  // contexte déjà filtré par la recherche : un niveau « balanced » répond
  // plus vite sans perte de fiabilité, puisque verifyCourseAnswer() rejette
  // de toute façon toute réponse non sourcée.
  'chat-course': { tier: 'balanced' },
  // Pas de niveau forcé : le mode internet garde le comportement par défaut
  // du modèle (raisonnement plus poussé), et a besoin d'un provider outillé
  // pour la recherche web.
  'chat-internet': { requires: { webSearch: true } },
  // Extraire des paires question/réponse d'un texte déjà fourni est une
  // tâche mécanique : un niveau « balanced » répond plus vite sans perte de
  // fiabilité, puisque validateCardDrafts() rejette de toute façon toute
  // carte sans citation vérifiable — c'est ce filet qui rend le choix sûr.
  'flashcards-generate': { tier: 'balanced', requires: { structuredOutput: true } },
  // Sélectionner des notions dans un texte déjà fourni est une tâche
  // d'extraction mécanique : un modèle rapide et économique suffit, quel
  // que soit le modèle choisi par l'utilisateur pour la qualité du
  // dialogue — la validation après coup (validateConcepts) est le vrai
  // filet de sécurité, pas la prudence du modèle.
  'podcast-analysis': { tier: 'fast', preferredModel: 'claude-haiku-4-5' },
  // Ici la qualité compte (c'est le contenu que l'étudiant écoute) : le
  // niveau reste néanmoins « balanced » plutôt que « deep », sans
  // dégradation notable, car la structure est déjà contrainte par les
  // notions validées à l'étape d'analyse — moins de place à l'improvisation
  // qu'une génération libre.
  'podcast-dialogue': { tier: 'balanced' },
  'pdf-explain-page': { tier: 'balanced' },
  'pdf-summarize-chapter': { tier: 'balanced' },
  'quiz-generate': { tier: 'balanced', requires: { structuredOutput: true } },
  'anatomy-explain': { tier: 'balanced' },
};

function satisfiesRequirements(capabilities: AIProviderCapabilities, requires: TaskRoute['requires']): boolean {
  if (!requires) return true;
  if (requires.webSearch && !capabilities.webSearch) return false;
  if (requires.vision && !capabilities.vision) return false;
  if (requires.structuredOutput && !capabilities.structuredOutput) return false;
  return true;
}

/**
 * Candidats pour une tâche, dans l'ordre où l'orchestrateur doit les
 * essayer : disponibles (clé configurée) ET dotés des capacités requises,
 * dans l'ordre de préférence fourni par l'appelant (l'ordre d'enregistrement
 * des providers). Aucune préférence de fournisseur codée en dur ici — le
 * classement vient uniquement de la disponibilité et des capacités
 * déclarées.
 */
export function selectProviderCandidates(providers: readonly AIProvider[], task: AITask): AIProvider[] {
  const route = TASK_ROUTES[task];
  return providers.filter((provider) => provider.isAvailable() && satisfiesRequirements(provider.capabilities, route.requires));
}
