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
  /**
   * Famille d'usage. Le rail latéral insère un intertitre quand la famille
   * change ; `null` en tête (Accueil, Recherche) et en pied (Paramètres), qui
   * n'appartiennent à aucune famille.
   */
  group?: string;
}

/**
 * Ordre voulu : Accueil et Recherche en tête, puis les sections par familles
 * d'usage — la matière, le travail de mémorisation, le suivi — et les réglages
 * en pied.
 *
 * Ces entrées ne portent PLUS de couleur de section. Chacune arborait
 * auparavant sa propre teinte vive, ce qui donnait un menu arc-en-ciel de
 * treize couleurs où rien ne signalait la page courante. Le repérage se fait
 * désormais par l'ordre, par l'accent unique de la page active, et par les
 * intertitres de famille : douze entrées à plat se lisaient comme une liste de
 * courses, sans hiérarchie ni point d'entrée évident.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/', label: 'Accueil', icon: 'home', primary: true },
  { to: '/recherche', label: 'Recherche', icon: 'search', shortLabel: 'Rech.' },

  { to: '/cours', label: 'Cours', icon: 'courses', primary: true, group: 'Ma matière' },
  { to: '/notes', label: 'Notes', icon: 'notes', group: 'Ma matière' },
  { to: '/anatomie', label: 'Anatomie', icon: 'anatomy', shortLabel: 'Anat.', group: 'Ma matière' },

  { to: '/revisions', label: 'Révisions', icon: 'review', shortLabel: 'Révis.', primary: true, group: 'Travailler' },
  { to: '/flashcards', label: 'Flashcards', icon: 'cards', shortLabel: 'Cartes', group: 'Travailler' },
  { to: '/quiz', label: 'Quiz', icon: 'quiz', group: 'Travailler' },
  { to: '/ia', label: 'IA', icon: 'ai', primary: true, group: 'Travailler' },

  { to: '/progression', label: 'Progression', icon: 'progress', shortLabel: 'Progrès', group: 'Suivi' },
  { to: '/calendrier', label: 'Calendrier', icon: 'calendar', shortLabel: 'Agenda', group: 'Suivi' },

  { to: '/parametres', label: 'Paramètres', icon: 'settings', shortLabel: 'Réglages' },
];
