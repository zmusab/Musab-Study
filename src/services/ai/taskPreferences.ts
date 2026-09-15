import type { AITask, ProviderId } from './types';

/**
 * Préférence de fournisseur PAR TÂCHE — « Explication → Claude, Résumé →
 * Gemini, Flashcards → ChatGPT… ». `'auto'` (défaut pour toute tâche tant
 * que l'utilisateur n'a rien choisi) laisse `orchestrator.ts` décider comme
 * aujourd'hui. Aucune tâche n'a de préférence par défaut autre que `'auto'`
 * — jamais de supposition arbitraire sur « le meilleur modèle » pour telle
 * tâche, configurable uniquement.
 */
export type TaskProviderPreference = 'auto' | ProviderId;

const STORAGE_KEY = 'musab-study:task-provider-preferences';

/**
 * Tâches proposées au réglage utilisateur. Les tâches réservées
 * (`quiz-generate`, `note-summarize`, `note-explain`) sont volontairement
 * absentes : aucun code ne les appelle encore, leur régler un fournisseur
 * n'aurait aucun effet observable — les y ajouter serait un réglage fantôme.
 */
export const CONFIGURABLE_TASKS: { task: AITask; label: string }[] = [
  { task: 'chat-course', label: 'Assistant IA — mode cours' },
  { task: 'chat-internet', label: 'Assistant IA — mode internet' },
  { task: 'flashcards-generate', label: 'Génération de flashcards' },
  { task: 'course-notions', label: 'Notions de cours' },
  { task: 'pdf-explain-page', label: 'Explication d’une page de cours' },
  { task: 'pdf-summarize-chapter', label: 'Résumé de chapitre' },
  { task: 'anatomy-explain', label: 'Explication anatomique' },
];

function isProviderId(value: unknown): value is ProviderId {
  return value === 'anthropic' || value === 'openai';
}

function readAll(): Partial<Record<AITask, ProviderId>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Partial<Record<AITask, ProviderId>> = {};
    for (const [task, provider] of Object.entries(parsed as Record<string, unknown>)) {
      if (isProviderId(provider)) result[task as AITask] = provider;
    }
    return result;
  } catch {
    return {};
  }
}

function writeAll(map: Partial<Record<AITask, ProviderId>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Navigation privée : la préférence ne sera pas retenue, l'application reste utilisable en 'auto'.
  }
}

export function getTaskProviderPreference(task: AITask): TaskProviderPreference {
  return readAll()[task] ?? 'auto';
}

export function setTaskProviderPreference(task: AITask, provider: TaskProviderPreference): void {
  const current = readAll();
  if (provider === 'auto') delete current[task];
  else current[task] = provider;
  writeAll(current);
}

export function getAllTaskProviderPreferences(): Partial<Record<AITask, ProviderId>> {
  return readAll();
}
