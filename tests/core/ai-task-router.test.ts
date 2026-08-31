import { describe, it, expect } from 'vitest';
import { selectProviderCandidates, TASK_ROUTES } from '@/services/ai/taskRouter';
import type { AIProvider, AIProviderCapabilities } from '@/services/ai/types';

/**
 * Le routeur ne doit JAMAIS coder en dur « telle tâche va à tel
 * fournisseur » — il calcule, à partir de la disponibilité réelle
 * (`isAvailable()`) et des capacités déclarées de chaque provider. Ces
 * tests utilisent de faux providers, sans réseau ni SDK.
 */

const FULL_CAPABILITIES: AIProviderCapabilities = {
  reasoning: 'excellent',
  contextWindowTokens: 200_000,
  structuredOutput: true,
  vision: true,
  fileInput: true,
  toolUse: true,
  webSearch: true,
  speed: 'medium',
  reliability: 'stable',
};

function makeProvider(overrides: Partial<AIProvider> & Partial<{ capabilities: Partial<AIProviderCapabilities> }> = {}): AIProvider {
  return {
    id: 'anthropic',
    label: 'Faux provider',
    capabilities: { ...FULL_CAPABILITIES, ...overrides.capabilities },
    isAvailable: () => true,
    ask: async () => 'réponse simulée',
    ...overrides,
  } as AIProvider;
}

describe('TASK_ROUTES', () => {
  it('couvre toutes les tâches réellement appelées par l’application', () => {
    for (const task of [
      'chat-course',
      'chat-internet',
      'flashcards-generate',
      'podcast-analysis',
      'podcast-dialogue',
      'pdf-explain-page',
      'pdf-summarize-chapter',
    ] as const) {
      expect(TASK_ROUTES[task]).toBeDefined();
    }
  });

  it('impose le modèle rapide pour l’analyse podcast, comme le faisait le pipeline avant le passage par l’orchestrateur', () => {
    expect(TASK_ROUTES['podcast-analysis'].preferredModel).toBe('claude-haiku-4-5');
    expect(TASK_ROUTES['podcast-analysis'].tier).toBe('fast');
  });

  it('exige une capacité de recherche web pour le mode internet', () => {
    expect(TASK_ROUTES['chat-internet'].requires?.webSearch).toBe(true);
  });
});

describe('selectProviderCandidates', () => {
  it('écarte un provider indisponible même s’il a les bonnes capacités', () => {
    const unavailable = makeProvider({ id: 'anthropic', isAvailable: () => false });
    expect(selectProviderCandidates([unavailable], 'chat-course')).toEqual([]);
  });

  it('retient un provider disponible sans exigence particulière', () => {
    const provider = makeProvider({ id: 'anthropic' });
    expect(selectProviderCandidates([provider], 'chat-course')).toEqual([provider]);
  });

  it('écarte un provider disponible mais dépourvu de la capacité requise (recherche web)', () => {
    const noWebSearch = makeProvider({ id: 'openai', capabilities: { webSearch: false } });
    expect(selectProviderCandidates([noWebSearch], 'chat-internet')).toEqual([]);
  });

  it('retient un provider disponible qui a la capacité de recherche web requise', () => {
    const withWebSearch = makeProvider({ id: 'anthropic', capabilities: { webSearch: true } });
    expect(selectProviderCandidates([withWebSearch], 'chat-internet')).toEqual([withWebSearch]);
  });

  it('conserve l’ordre d’enregistrement parmi plusieurs candidats valides — aucune préférence de fournisseur codée en dur', () => {
    const first = makeProvider({ id: 'anthropic' });
    const second = makeProvider({ id: 'openai' });
    expect(selectProviderCandidates([first, second], 'chat-course')).toEqual([first, second]);
  });

  it('ne renvoie que les candidats réellement utilisables quand la liste est mixte', () => {
    const unavailable = makeProvider({ id: 'openai', isAvailable: () => false });
    const incapable = makeProvider({ id: 'gemini', capabilities: { webSearch: false } });
    const good = makeProvider({ id: 'anthropic', capabilities: { webSearch: true } });
    expect(selectProviderCandidates([unavailable, incapable, good], 'chat-internet')).toEqual([good]);
  });
});
