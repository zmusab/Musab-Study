import type { ProviderId } from './types';

/**
 * Réglages du fournisseur d'IA.
 *
 * La clé API Anthropic est conservée dans `localStorage`, sur CET appareil
 * uniquement. Elle n'est jamais écrite dans le dépôt, jamais incluse dans
 * l'export de sauvegarde, et jamais envoyée ailleurs qu'à api.anthropic.com.
 *
 * Limite assumée de l'hébergement statique : une application servie depuis
 * GitHub Pages n'a pas de serveur où cacher un secret. La clé est donc
 * accessible au code de la page. Pour une application personnelle c'est un
 * compromis raisonnable, à condition de le savoir — d'où l'avertissement
 * affiché dans l'écran Paramètres.
 *
 * OpenAI et Gemini n'ont PAS de clé ici : la leur vit exclusivement côté
 * serveur (`api/ai/*`, variables d'environnement Vercel) — voir
 * `services/ai/providerStatus.ts`. Rien à saisir ni à retenir sur cet
 * appareil pour ces deux-là.
 */

const KEY_STORAGE = 'musab-study:anthropic-key';
const MODEL_STORAGE = 'musab-study:anthropic-model';
const PREFERRED_PROVIDER_STORAGE = 'musab-study:preferred-provider';

/** Modèles proposés, du plus capable au plus économique. */
export const AVAILABLE_MODELS = [
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    hint: 'Le plus capable — meilleur pour les fiches et les explications',
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    hint: 'Bon compromis qualité / coût',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    hint: 'Le plus rapide et le moins cher — pour générer en volume',
  },
] as const;

export const DEFAULT_MODEL = AVAILABLE_MODELS[0].id;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Navigation privée : la clé ne sera pas retenue entre deux sessions.
  }
}

export function getApiKey(): string | null {
  const key = readStorage(KEY_STORAGE);
  return key && key.trim().length > 0 ? key.trim() : null;
}

export function setApiKey(key: string | null): void {
  writeStorage(KEY_STORAGE, key && key.trim().length > 0 ? key.trim() : null);
}

export function hasApiKey(): boolean {
  return getApiKey() !== null;
}

export function getModel(): string {
  return readStorage(MODEL_STORAGE) ?? DEFAULT_MODEL;
}

export function setModel(model: string): void {
  writeStorage(MODEL_STORAGE, model);
}

/** Masque une clé pour l'affichage : `sk-ant-…a1b2`. */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return '••••••';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

// ────────────────────── Sélection du fournisseur IA ──────────────────────

/**
 * `'auto'` (défaut, inchangé pour tout appareil existant) laisse
 * `taskRouter`/`orchestrator` choisir comme aujourd'hui — disponibilité puis
 * ordre d'enregistrement. Un choix explicite fait essayer CE fournisseur en
 * premier pour toutes les tâches sans préférence propre (voir
 * `taskPreferences.ts`), sans jamais empêcher le repli sur un autre
 * fournisseur disponible si celui-ci échoue.
 */
export type PreferredProvider = 'auto' | ProviderId;

export function getPreferredProvider(): PreferredProvider {
  const raw = readStorage(PREFERRED_PROVIDER_STORAGE);
  return raw === 'anthropic' || raw === 'openai' || raw === 'gemini' ? raw : 'auto';
}

export function setPreferredProvider(provider: PreferredProvider): void {
  writeStorage(PREFERRED_PROVIDER_STORAGE, provider === 'auto' ? null : provider);
}
