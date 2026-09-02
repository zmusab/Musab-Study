/**
 * Catégorie « Comprendre » de l'Assistant IA — expliquer, simplifier, donner
 * un exemple, comparer deux notions, répondre à une question libre.
 *
 * Pur : ces fonctions ne font qu'écrire la question envoyée au chat existant
 * (`ChatPage`), qui la traite ensuite avec EXACTEMENT le même pipeline que
 * n'importe quelle question tapée à la main (`buildContext` → `courseSystemPrompt`
 * → `aiOrchestrator.ask` → `verifyCourseAnswer`) — aucune notion « Comprendre »
 * n'a donc de circuit IA propre : ce ne sont que des questions pré-rédigées.
 */

export type ComprehendAction = 'explain' | 'simplify' | 'example' | 'compare';

export const COMPREHEND_ACTIONS: { action: ComprehendAction; label: string; icon: string }[] = [
  { action: 'explain', label: 'Expliquer une notion', icon: '💡' },
  { action: 'simplify', label: 'Simplifier une notion', icon: '🧩' },
  { action: 'example', label: 'Donner un exemple', icon: '📎' },
  { action: 'compare', label: 'Comparer deux notions', icon: '⚖️' },
];

/**
 * `notion` : le sujet demandé. `notionB` : requis seulement pour « compare »
 * — les appelants doivent s'assurer que les deux champs sont remplis avant
 * d'appeler cette fonction pour cette action précise.
 */
export function comprehendPrompt(action: ComprehendAction, notion: string, notionB = ''): string {
  const term = notion.trim();
  switch (action) {
    case 'explain':
      return `Explique la notion suivante : ${term}.`;
    case 'simplify':
      return `Explique de façon simple et accessible, comme à un débutant, la notion suivante : ${term}.`;
    case 'example':
      return `Donne un exemple concret qui illustre la notion suivante : ${term}.`;
    case 'compare':
      return `Compare ces deux notions — leurs points communs et leurs différences : ${term} et ${notionB.trim()}.`;
  }
}
