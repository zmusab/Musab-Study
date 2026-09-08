import type { IconName } from '@/components/ui/Icon';

/** Destinations de l'application, dans l'ordre d'affichage. */
export interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
  /** Affiché dans la barre mobile compacte (l'espace y est très limité). */
  shortLabel?: string;
  /** Épinglé dans la barre du bas sur iPhone. */
  primary?: boolean;
}

/**
 * Ordre voulu : Accueil et Recherche en tête, puis les sections par familles
 * d'usage — les cours et l'assistant, la mémorisation, l'évaluation, le suivi,
 * les outils.
 *
 * Ces entrées ne portent PLUS de couleur de section. Chacune arborait
 * auparavant sa propre teinte vive, ce qui donnait un menu arc-en-ciel de
 * treize couleurs où rien ne signalait la page courante. Le repérage se fait
 * désormais par l'ordre et par l'accent unique de la page active.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/', label: 'Accueil', icon: 'home', primary: true },
  { to: '/recherche', label: 'Recherche', icon: 'search', shortLabel: 'Rech.' },
  { to: '/cours', label: 'Cours', icon: 'courses', primary: true },
  { to: '/ia', label: 'IA', icon: 'ai', primary: true },
  { to: '/revisions', label: 'Révisions', icon: 'review', shortLabel: 'Révis.' },
  { to: '/flashcards', label: 'Flashcards', icon: 'cards', shortLabel: 'Cartes' },
  { to: '/quiz', label: 'Quiz', icon: 'quiz' },
  { to: '/podcast', label: 'Podcast', icon: 'podcast', primary: true },
  { to: '/progression', label: 'Progression', icon: 'progress', shortLabel: 'Progrès' },
  { to: '/anatomie', label: 'Anatomie', icon: 'anatomy', shortLabel: 'Anat.' },
  { to: '/calendrier', label: 'Calendrier', icon: 'calendar', shortLabel: 'Agenda' },
  { to: '/notes', label: 'Notes', icon: 'notes' },
  { to: '/parametres', label: 'Paramètres', icon: 'settings', shortLabel: 'Réglages' },
];
