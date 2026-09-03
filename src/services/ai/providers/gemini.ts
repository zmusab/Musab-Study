import { isProxyProviderAvailable } from '../providerStatus';
import { getModelFor } from '../models';
import { askViaProxy } from './proxyClient';
import type { AIProvider, AIProviderCapabilities } from '../types';

/**
 * Fournisseur Google Gemini — réellement câblé, via le relais serveur
 * `api/ai/gemini.ts` : même raison qu'OpenAI (CORS refusé par
 * generativelanguage.googleapis.com pour un appel direct navigateur,
 * vérifié avant ce chantier). `isAvailable()` reflète l'état réel constaté
 * côté serveur, jamais une supposition.
 *
 * « Gemini Education » ne correspond à aucune API distincte pour une
 * intégration tierce — c'est une offre de licence/produit (Workspace for
 * Education, Gemini Advanced étudiant), pas un point d'accès développeur
 * séparé. CE fournisseur, sur l'API Gemini standard, couvre donc déjà tout
 * besoin « Gemini », quel que soit le nom commercial visé.
 *
 * Capacités décrites ici = ce que CE relais fait réellement (texte en
 * entrée, texte en sortie) — ni vision, ni fichiers, ni recherche web, ni
 * outils ne sont câblés, même si l'API Gemini les permettrait en général.
 */
const CAPABILITIES: AIProviderCapabilities = {
  reasoning: 'excellent',
  contextWindowTokens: 1_000_000,
  structuredOutput: true,
  vision: false,
  fileInput: false,
  toolUse: false,
  webSearch: false,
  speed: 'fast',
  reliability: 'stable',
};

export const geminiProvider: AIProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  capabilities: CAPABILITIES,
  isAvailable: () => isProxyProviderAvailable('gemini'),
  // Comme pour OpenAI : le modèle choisi dans les réglages POUR GEMINI
  // s'applique, sauf si la tâche en impose un.
  ask: (options) =>
    askViaProxy('gemini', 'Gemini', {
      ...options,
      preferredModel: options.preferredModel ?? getModelFor('gemini'),
    }),
};
