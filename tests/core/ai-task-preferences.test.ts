import { afterEach, describe, it, expect } from 'vitest';
import {
  CONFIGURABLE_TASKS,
  getAllTaskProviderPreferences,
  getTaskProviderPreference,
  setTaskProviderPreference,
} from '@/services/ai/taskPreferences';
import { getPreferredProvider, setPreferredProvider } from '@/services/ai/settings';

/**
 * « Explication → Claude, Résumé → Gemini… » : une préférence PAR TÂCHE,
 * configurable, jamais une supposition arbitraire codée en dur — chaque
 * tâche vaut 'auto' tant que l'utilisateur n'a rien choisi.
 */

afterEach(() => {
  for (const { task } of CONFIGURABLE_TASKS) setTaskProviderPreference(task, 'auto');
  setPreferredProvider('auto');
});

describe('taskPreferences — par tâche, jamais une supposition par défaut', () => {
  it('toute tâche vaut "auto" tant que rien n’a été choisi', () => {
    for (const { task } of CONFIGURABLE_TASKS) {
      expect(getTaskProviderPreference(task)).toBe('auto');
    }
  });

  it('enregistre et relit une préférence précise', () => {
    setTaskProviderPreference('flashcards-generate', 'openai');
    expect(getTaskProviderPreference('flashcards-generate')).toBe('openai');
    // Les autres tâches restent inchangées.
    expect(getTaskProviderPreference('chat-course')).toBe('auto');
  });

  it('revenir à "auto" efface réellement la préférence enregistrée', () => {
    setTaskProviderPreference('note-summarize', 'openai');
    expect(getTaskProviderPreference('note-summarize')).toBe('openai');
    setTaskProviderPreference('note-summarize', 'auto');
    expect(getTaskProviderPreference('note-summarize')).toBe('auto');
    expect(getAllTaskProviderPreferences()).not.toHaveProperty('note-summarize');
  });

  it('les tâches réservées (jamais encore appelées) ne sont pas proposées au réglage', () => {
    const tasks = CONFIGURABLE_TASKS.map((entry) => entry.task);
    expect(tasks).not.toContain('quiz-generate');
    expect(tasks).not.toContain('note-summarize');
    expect(tasks).not.toContain('note-explain');
  });

  it('getAllTaskProviderPreferences ne renvoie que les tâches réellement personnalisées', () => {
    setTaskProviderPreference('anatomy-explain', 'anthropic');
    setTaskProviderPreference('course-notions', 'openai');
    const all = getAllTaskProviderPreferences();
    expect(all).toEqual({ 'anatomy-explain': 'anthropic', 'course-notions': 'openai' });
  });
});

describe('settings — préférence générale de fournisseur', () => {
  afterEach(() => setPreferredProvider('auto'));

  it('vaut "auto" par défaut', () => {
    expect(getPreferredProvider()).toBe('auto');
  });

  it('enregistre et relit un choix explicite', () => {
    setPreferredProvider('openai');
    expect(getPreferredProvider()).toBe('openai');
  });

  it('revenir à "auto" efface le choix', () => {
    setPreferredProvider('openai');
    setPreferredProvider('auto');
    expect(getPreferredProvider()).toBe('auto');
  });

  it('une valeur corrompue en stockage retombe sur "auto", jamais une erreur', () => {
    localStorage.setItem('musab-study:preferred-provider', 'un-fournisseur-qui-n-existe-pas');
    expect(getPreferredProvider()).toBe('auto');
    localStorage.removeItem('musab-study:preferred-provider');
  });
});
