import type { ProviderId } from './types';

/**
 * CATALOGUE DE MODÈLES, PAR FOURNISSEUR.
 *
 * Un identifiant de modèle n'a de sens que chez celui qui le publie : le
 * choix « Modèle » des réglages doit donc dépendre de l'assistant choisi,
 * et un modèle ne peut jamais être envoyé à un autre fournisseur (voir aussi
 * `taskRouter.ts`, où les modèles imposés par tâche sont eux aussi indexés
 * par fournisseur).
 *
 * Ces listes sont VÉRIFIÉES dans la documentation de chaque fournisseur
 * (septembre 2026) et volontairement courtes : mieux vaut trois modèles
 * réellement disponibles qu'une liste exhaustive dont la moitié échoue. Les
 * catalogues bougent plus vite que ce fichier — d'où `isKnownModel` et le
 * repli explicite ci-dessous plutôt qu'une confiance aveugle.
 */

export interface ModelOption {
  id: string;
  label: string;
  hint: string;
}

export const PROVIDER_MODELS: Record<ProviderId, readonly ModelOption[]> = {
  anthropic: [
    { id: 'claude-opus-5', label: 'Claude Opus 5', hint: 'Le plus capable — fiches et explications' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'Bon compromis qualité / coût' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'Le plus rapide — génération en volume' },
  ],
  openai: [
    { id: 'gpt-5.2', label: 'GPT-5.2', hint: 'Raisonnement approfondi' },
    { id: 'gpt-5.2-chat-latest', label: 'GPT-5.2 Instant', hint: 'Réponses plus rapides' },
  ],
  gemini: [
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', hint: 'Rapide et récent' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', hint: 'Génération précédente' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', hint: 'Le plus économique' },
  ],
};

export function defaultModelFor(provider: ProviderId): string {
  return PROVIDER_MODELS[provider][0]!.id;
}

/** Vrai si ce modèle figure au catalogue DE CE fournisseur — jamais d'un autre. */
export function isKnownModel(provider: ProviderId, modelId: string): boolean {
  return PROVIDER_MODELS[provider].some((entry) => entry.id === modelId);
}

const STORAGE_PREFIX = 'musab-study:model:';

/**
 * L'ancien réglage Anthropic (`musab-study:anthropic-model`) reste lu comme
 * valeur initiale : un appareil déjà configuré garde son modèle sans avoir à
 * le rechoisir.
 */
const LEGACY_ANTHROPIC_STORAGE = 'musab-study:anthropic-model';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Navigation privée : le choix ne sera pas retenu, le défaut s'applique.
  }
}

/**
 * Modèle retenu pour ce fournisseur. Un modèle enregistré qui a disparu du
 * catalogue n'est PAS renvoyé en silence : `modelStatusFor` permet à
 * l'interface de le signaler, et cette fonction retombe sur un modèle
 * réellement disponible pour ne jamais envoyer une requête vouée à échouer.
 */
export function getModelFor(provider: ProviderId): string {
  const stored = read(STORAGE_PREFIX + provider) ?? (provider === 'anthropic' ? read(LEGACY_ANTHROPIC_STORAGE) : null);
  return stored && isKnownModel(provider, stored) ? stored : defaultModelFor(provider);
}

export function setModelFor(provider: ProviderId, modelId: string): void {
  write(STORAGE_PREFIX + provider, modelId);
  // L'ancienne clé reste synchronisée tant que du code la lit encore.
  if (provider === 'anthropic') write(LEGACY_ANTHROPIC_STORAGE, modelId);
}

export interface ModelStatus {
  /** Le modèle réellement utilisé pour les prochaines requêtes. */
  effective: string;
  /** Renseigné seulement si un modèle enregistré n'est plus au catalogue. */
  unavailable: string | null;
}

/** Dit franchement si le modèle enregistré n'est plus disponible, et lequel le remplace. */
export function modelStatusFor(provider: ProviderId): ModelStatus {
  const stored = read(STORAGE_PREFIX + provider) ?? (provider === 'anthropic' ? read(LEGACY_ANTHROPIC_STORAGE) : null);
  if (stored && !isKnownModel(provider, stored)) {
    return { effective: defaultModelFor(provider), unavailable: stored };
  }
  return { effective: getModelFor(provider), unavailable: null };
}
