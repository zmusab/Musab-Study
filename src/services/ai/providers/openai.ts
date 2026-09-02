import { isProxyProviderAvailable } from '../providerStatus';
import { askViaProxy } from './proxyClient';
import type { AIProvider, AIProviderCapabilities } from '../types';

/**
 * Fournisseur OpenAI — réellement câblé, via le relais serveur
 * `api/ai/openai.ts` : l'API OpenAI refuse un appel direct depuis un
 * navigateur (CORS), contrairement à Anthropic. `isAvailable()` reflète
 * l'état RÉEL constaté côté serveur (`services/ai/providerStatus.ts`),
 * jamais une supposition — sur un hébergement purement statique (sans
 * fonctions serverless), il reste honnêtement `false`.
 *
 * Capacités décrites ici = ce que CE relais fait réellement, pas tout ce
 * que l'API OpenAI permettrait en général : ni recherche web, ni vision,
 * ni fichiers, ni outils ne sont câblés — les marquer `true` routerait de
 * vraies tâches vers une fonctionnalité absente.
 */
const CAPABILITIES: AIProviderCapabilities = {
  reasoning: 'excellent',
  contextWindowTokens: 400_000,
  structuredOutput: true,
  vision: false,
  fileInput: false,
  toolUse: false,
  webSearch: false,
  speed: 'medium',
  reliability: 'stable',
};

export const openaiProvider: AIProvider = {
  id: 'openai',
  label: 'OpenAI (ChatGPT)',
  capabilities: CAPABILITIES,
  isAvailable: () => isProxyProviderAvailable('openai'),
  ask: (options) => askViaProxy('openai', 'OpenAI', options),
};
