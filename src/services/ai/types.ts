/**
 * Vocabulaire commun de la couche IA — le seul endroit où « tâche »,
 * « fournisseur » et « capacité » sont définis. Aucun fichier de
 * fonctionnalité (flashcards, podcast, chat, PDF) ne doit connaître un
 * détail propre à un fournisseur particulier ; tout passe par ces types.
 */

/** Une tâche par appel réel de l'application. `quiz-generate` et
 * `anatomy-explain` sont réservées pour des phases pas encore construites
 * (Quiz, Anatomie) — présentes dans la table de routage, appelées par
 * aucun code aujourd'hui. */
export type AITask =
  | 'chat-course'
  | 'chat-internet'
  | 'flashcards-generate'
  | 'podcast-analysis'
  | 'podcast-dialogue'
  | 'pdf-explain-page'
  | 'pdf-summarize-chapter'
  | 'quiz-generate'
  | 'anatomy-explain';

/**
 * Niveau de qualité demandé — l'équivalent générique du paramètre `effort`
 * propre à Anthropic. Chaque fournisseur traduit ce niveau dans son propre
 * vocabulaire (voir providers/anthropic.ts) ; un fournisseur qui ne
 * distingue pas les niveaux peut l'ignorer sans erreur.
 */
export type QualityTier = 'fast' | 'balanced' | 'deep';

/**
 * Capacités déclarées d'un fournisseur — sert au routeur à choisir un
 * candidat par calcul plutôt que par préférence arbitraire. Les champs de
 * coût sont volontairement optionnels et approximatifs : à vérifier avant
 * toute décision budgétaire réelle, les tarifs changent.
 */
export interface AIProviderCapabilities {
  reasoning: 'basic' | 'good' | 'excellent';
  contextWindowTokens: number;
  structuredOutput: boolean;
  vision: boolean;
  fileInput: boolean;
  toolUse: boolean;
  webSearch: boolean;
  speed: 'slow' | 'medium' | 'fast';
  reliability: 'experimental' | 'stable';
  /** USD approximatifs pour 1 million de tokens — informatif, pas contractuel. */
  approxCostPerMTokIn?: number;
  approxCostPerMTokOut?: number;
}

export type ProviderId = 'anthropic' | 'openai' | 'gemini';

/** Options transmises par l'orchestrateur à un provider — déjà résolues (tier, modèle). */
export interface ProviderAskOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
  webSearch?: boolean;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  tier?: QualityTier;
  /** Force un modèle précis, indépendamment du réglage général de l'utilisateur — voir podcast-analysis. */
  preferredModel?: string;
}

/** Un fournisseur d'IA interchangeable. */
export interface AIProvider {
  id: ProviderId;
  label: string;
  capabilities: AIProviderCapabilities;
  /** Vrai si une clé est configurée pour ce fournisseur — jamais supposé, toujours vérifié. */
  isAvailable(): boolean;
  ask(options: ProviderAskOptions): Promise<string>;
}

/** Options transmises par un appelant (page, service) à l'orchestrateur. */
export interface AskOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
  webSearch?: boolean;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  task: AITask;
}

export class MissingApiKeyError extends Error {
  constructor(message = "Aucune clé API n'est configurée. Ouvre Paramètres → Assistant IA pour en ajouter une.") {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}

export class AiRequestError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AiRequestError';
  }
}

/** Un provider existe dans le registre mais n'est pas câblé — ne devrait jamais être atteint : le routeur ne le sélectionne que si `isAvailable()` est vrai. */
export class ProviderNotConfiguredError extends Error {
  constructor(providerId: ProviderId) {
    super(`Le fournisseur « ${providerId} » n'est pas encore intégré à Musab Study.`);
    this.name = 'ProviderNotConfiguredError';
  }
}
