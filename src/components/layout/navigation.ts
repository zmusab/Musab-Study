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

/**
 * Ordre voulu : Accueil puis Recherche en tête, puis les sections groupées
 * par couleur (Recherche+Cours, IA+Révisions, Flashcards+Quiz,
 * Podcast+Progression, Anatomie+Calendrier, Notes+Paramètres) — un coup
 * d'œil au rail latéral doit suffire à voir les paires.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/', label: 'Accueil', icon: 'home', color: 'var(--nav-neutral)', primary: true },
  { to: '/recherche', label: 'Recherche', icon: 'search', color: 'var(--nav-blue)', shortLabel: 'Rech.' },
  { to: '/cours', label: 'Cours', icon: 'courses', color: 'var(--nav-blue)', primary: true },
  { to: '/ia', label: 'IA', icon: 'ai', color: 'var(--nav-purple)', primary: true },
  { to: '/revisions', label: 'Révisions', icon: 'review', color: 'var(--nav-purple)', shortLabel: 'Révis.' },
  { to: '/flashcards', label: 'Flashcards', icon: 'cards', color: 'var(--nav-yellow)', shortLabel: 'Cartes' },
  { to: '/quiz', label: 'Quiz', icon: 'quiz', color: 'var(--nav-yellow)' },
  { to: '/podcast', label: 'Podcast', icon: 'podcast', color: 'var(--nav-green)', primary: true },
  { to: '/progression', label: 'Progression', icon: 'progress', color: 'var(--nav-green)', shortLabel: 'Progrès' },
  { to: '/anatomie', label: 'Anatomie', icon: 'anatomy', color: 'var(--nav-red)', shortLabel: 'Anat.' },
  { to: '/calendrier', label: 'Calendrier', icon: 'calendar', color: 'var(--nav-red)', shortLabel: 'Agenda' },
  { to: '/notes', label: 'Notes', icon: 'notes', color: 'var(--nav-orange)' },
  { to: '/parametres', label: 'Paramètres', icon: 'settings', color: 'var(--nav-orange)', shortLabel: 'Réglages' },
];
