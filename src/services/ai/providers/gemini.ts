import { ProviderNotConfiguredError } from '../types';
import type { AIProvider, AIProviderCapabilities } from '../types';

/**
 * Squelette du fournisseur Google Gemini — même principe que openai.ts :
 * interface prête, rien de câblé, `isAvailable()` toujours faux tant
 * qu'aucune vraie intégration n'existe. Voir openai.ts pour le détail du
 * raisonnement.
 *
 * Capacités indicatives (famille Gemini, connaissance publique au moment de
 * l'écriture) — à vérifier et ajuster lors de la véritable intégration.
 * Gemini est notamment connu pour un contexte particulièrement long, ce qui
 * en ferait un candidat naturel pour `pdf-summarize-chapter` une fois
 * réellement branché.
 */
const CAPABILITIES: AIProviderCapabilities = {
  reasoning: 'good',
  contextWindowTokens: 1_000_000,
  structuredOutput: true,
  vision: true,
  fileInput: true,
  toolUse: true,
  webSearch: true,
  speed: 'fast',
  reliability: 'stable',
};

export const geminiProvider: AIProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  capabilities: CAPABILITIES,
  isAvailable: () => false,
  ask: async () => {
    throw new ProviderNotConfiguredError('gemini');
  },
};
