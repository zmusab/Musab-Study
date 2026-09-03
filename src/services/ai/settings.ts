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
const WORKSPACE_STORAGE = 'musab-study:anthropic-workspace-id';
const PREFERRED_PROVIDER_STORAGE = 'musab-study:preferred-provider';

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

/**
 * Identifiant d'espace de travail Anthropic (`wrkspc_…`), facultatif.
 *
 * Anthropic distingue deux sortes de clés API. Une clé rattachée à un espace
 * de travail précis suffit à elle seule. Une clé « liée à une identité »
 * (identity-linked), elle, n'appartient à aucun espace de travail : l'API
 * refuse alors la requête avec un 400 explicite — « anthropic-workspace-id is
 * required when authenticating with an identity-linked API key » — tant que
 * l'espace de travail dans lequel la requête agit n'est pas indiqué. Cet
 * identifiant, quand il est renseigné, part dans l'en-tête
 * `anthropic-workspace-id`.
 *
 * Ce n'est pas un secret (il identifie un espace de travail, il n'y donne pas
 * accès sans la clé), mais il reste stocké sur cet appareil uniquement, comme
 * la clé, et n'est pas inclus dans les sauvegardes.
 */
export function getWorkspaceId(): string | null {
  const id = readStorage(WORKSPACE_STORAGE);
  return id && id.trim().length > 0 ? id.trim() : null;
}

export function setWorkspaceId(id: string | null): void {
  writeStorage(WORKSPACE_STORAGE, id && id.trim().length > 0 ? id.trim() : null);
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
 * ordre d'enregistrement, avec repli réel entre candidats disponibles. Un
 * choix explicite, lui, restreint l'orchestrateur à CE SEUL fournisseur pour
 * toutes les tâches sans préférence propre (voir `taskPreferences.ts`) : s'il
 * échoue, la demande échoue avec son erreur à lui, jamais une bascule
 * silencieuse vers un autre — voir `orchestrator.ts` → `resolveProviderChoice`.
 */
export type PreferredProvider = 'auto' | ProviderId;

export function getPreferredProvider(): PreferredProvider {
  const raw = readStorage(PREFERRED_PROVIDER_STORAGE);
  return raw === 'anthropic' || raw === 'openai' || raw === 'gemini' ? raw : 'auto';
}

export function setPreferredProvider(provider: PreferredProvider): void {
  writeStorage(PREFERRED_PROVIDER_STORAGE, provider === 'auto' ? null : provider);
}
