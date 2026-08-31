import { ProviderNotConfiguredError } from '../types';
import type { AIProvider, AIProviderCapabilities } from '../types';

/**
 * Squelette du fournisseur OpenAI — l'interface existe, rien n'est câblé.
 *
 * Pas de SDK `openai` installé, pas de clé, pas d'appel réseau : c'est
 * délibéré pour cette étape (voir le plan). `isAvailable()` renvoie
 * toujours faux, donc le routeur ne le sélectionnera jamais tant qu'une
 * vraie intégration (clé + appel réel) n'aura pas été ajoutée — `ask()` ne
 * devrait donc jamais s'exécuter ; s'il l'était, il le dit clairement au
 * lieu de simuler une réponse.
 *
 * Capacités indicatives (famille GPT, connaissance publique au moment de
 * l'écriture) — à vérifier et ajuster lors de la véritable intégration.
 */
const CAPABILITIES: AIProviderCapabilities = {
  reasoning: 'excellent',
  contextWindowTokens: 400_000,
  structuredOutput: true,
  vision: true,
  fileInput: true,
  toolUse: true,
  webSearch: true,
  speed: 'medium',
  reliability: 'stable',
};

export const openaiProvider: AIProvider = {
  id: 'openai',
  label: 'OpenAI',
  capabilities: CAPABILITIES,
  isAvailable: () => false,
  ask: async () => {
    throw new ProviderNotConfiguredError('openai');
  },
};
