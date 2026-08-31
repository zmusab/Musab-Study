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

export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/', label: 'Accueil', icon: 'home', primary: true },
  { to: '/cours', label: 'Cours', icon: 'courses', primary: true },
  { to: '/ia', label: 'IA', icon: 'ai', primary: true },
  { to: '/revisions', label: 'Révisions', icon: 'review', shortLabel: 'Révis.', primary: true },
  { to: '/flashcards', label: 'Flashcards', icon: 'cards', shortLabel: 'Cartes' },
  { to: '/quiz', label: 'Quiz', icon: 'quiz' },
  { to: '/anatomie', label: 'Anatomie', icon: 'anatomy', shortLabel: 'Anat.' },
  { to: '/calendrier', label: 'Calendrier', icon: 'calendar', shortLabel: 'Agenda' },
  { to: '/notes', label: 'Notes', icon: 'notes' },
  { to: '/recherche', label: 'Recherche', icon: 'search', shortLabel: 'Rech.' },
  { to: '/progression', label: 'Progression', icon: 'progress', shortLabel: 'Progrès' },
  { to: '/parametres', label: 'Paramètres', icon: 'settings', shortLabel: 'Réglages' },
];
