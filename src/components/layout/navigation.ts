import type { IconName } from '@/components/ui/Icon';

/** Destinations de l'application, dans l'ordre d'affichage. */
export interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
  /** Couleur de section — variable CSS définie dans styles/index.css (clair + sombre). */
  color: string;
  /** Affiché dans la barre mobile compacte (l'espace y est très limité). */
  shortLabel?: string;
  /** Épinglé dans la barre du bas sur iPhone. */
  primary?: boolean;
}

export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/', label: 'Accueil', icon: 'home', color: 'var(--nav-home)', primary: true },
  { to: '/cours', label: 'Cours', icon: 'courses', color: 'var(--nav-courses)', primary: true },
  { to: '/ia', label: 'IA', icon: 'ai', color: 'var(--nav-ai)', primary: true },
  { to: '/revisions', label: 'Révisions', icon: 'review', color: 'var(--nav-review)', shortLabel: 'Révis.' },
  { to: '/flashcards', label: 'Flashcards', icon: 'cards', color: 'var(--nav-cards)', shortLabel: 'Cartes' },
  { to: '/quiz', label: 'Quiz', icon: 'quiz', color: 'var(--nav-quiz)' },
  { to: '/podcast', label: 'Podcast', icon: 'podcast', color: 'var(--nav-podcast)', primary: true },
  { to: '/progression', label: 'Progression', icon: 'progress', color: 'var(--nav-progress)', shortLabel: 'Progrès' },
  { to: '/anatomie', label: 'Anatomie', icon: 'anatomy', color: 'var(--nav-anatomy)', shortLabel: 'Anat.' },
  { to: '/calendrier', label: 'Calendrier', icon: 'calendar', color: 'var(--nav-calendar)', shortLabel: 'Agenda' },
  { to: '/notes', label: 'Notes', icon: 'notes', color: 'var(--nav-notes)' },
  { to: '/recherche', label: 'Recherche', icon: 'search', color: 'var(--nav-search)', shortLabel: 'Rech.' },
  { to: '/parametres', label: 'Paramètres', icon: 'settings', color: 'var(--nav-settings)', shortLabel: 'Réglages' },
];
