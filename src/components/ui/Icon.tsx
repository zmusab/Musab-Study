import type { SVGProps } from 'react';

/**
 * Jeu d'icônes vectorielles.
 *
 * Tracé uniquement (pas d'aplat), 1,6 px, `currentColor` : les icônes héritent
 * donc de la couleur du texte et s'adaptent seules aux thèmes clair et sombre.
 * Les emoji ont été écartés de la navigation : leur rendu varie selon le
 * système, ils ne suivent pas la couleur d'état actif, et leur polychromie
 * casse le calme de l'interface.
 */

export type IconName =
  | 'home'
  | 'courses'
  | 'ai'
  | 'review'
  | 'cards'
  | 'quiz'
  | 'anatomy'
  | 'calendar'
  | 'notes'
  | 'search'
  | 'progress'
  | 'settings'
  | 'more'
  | 'play'
  | 'pause'
  | 'skipBack'
  | 'skipForward'
  | 'volume'
  | 'zoomIn'
  | 'zoomOut'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'sparkles'
  | 'plus'
  | 'trash'
  | 'fullscreen'
  | 'fullscreenExit';

const PATHS: Record<IconName, string> = {
  home: 'M3 10.2 12 3.5l9 6.7M5.5 8.8V20h13V8.8M9.8 20v-5.4h4.4V20',
  courses: 'M4 4.8h6a2.5 2.5 0 0 1 2 2.4V20a2 2 0 0 0-2-1.6H4zM20 4.8h-6a2.5 2.5 0 0 0-2 2.4V20a2 2 0 0 1 2-1.6h6z',
  ai: 'M12 3.2v2.4M8.4 5.6h7.2a2.4 2.4 0 0 1 2.4 2.4v6.4a2.4 2.4 0 0 1-2.4 2.4H8.4A2.4 2.4 0 0 1 6 14.4V8a2.4 2.4 0 0 1 2.4-2.4ZM9.6 10.4v1.6M14.4 10.4v1.6M4 10.4v3.6M20 10.4v3.6M9.2 20.8l1.6-4M14.8 20.8l-1.6-4',
  review: 'M12 4.6a3.4 3.4 0 0 0-3.4 3.4 3 3 0 0 0-1.8 5.5A3.2 3.2 0 0 0 9.4 19a2.6 2.6 0 0 0 2.6-1.6zM12 4.6A3.4 3.4 0 0 1 15.4 8a3 3 0 0 1 1.8 5.5A3.2 3.2 0 0 1 14.6 19 2.6 2.6 0 0 1 12 17.4zM12 4.6v12.8',
  cards: 'M7.6 7.2h9.6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7.6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2ZM8.8 4.4h8.4M10.4 12.4h3.8M10.4 15.2h5.2',
  quiz: 'M12 20.6a8.6 8.6 0 1 0 0-17.2 8.6 8.6 0 0 0 0 17.2ZM9.6 9.4a2.5 2.5 0 0 1 4.85.8c0 1.7-2.45 2.5-2.45 2.5M12 16.4h.01',
  anatomy: 'M12 20s-7.2-4.3-7.2-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.2 2.6C19.2 15.7 12 20 12 20Z',
  calendar: 'M5.6 6.4h12.8a1.6 1.6 0 0 1 1.6 1.6v11.2a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19.2V8a1.6 1.6 0 0 1 1.6-1.6ZM8.4 3.6v4M15.6 3.6v4M4 11.2h16',
  notes: 'M6.4 3.6h7.2L19.2 9v11.4a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 20.4V5a1.4 1.4 0 0 1 1.4-1.4ZM13.6 3.6V9h5.6M8.6 13.2h6.8M8.6 16.6h6.8',
  search: 'M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6ZM15.8 15.8l4.4 4.4',
  progress: 'M4 20h16M7.2 20v-6M12 20V6.4M16.8 20v-9.2',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.1 14.6a1.5 1.5 0 0 0 .3 1.65l.05.06a1.8 1.8 0 1 1-2.55 2.55l-.06-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37V20a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06A1.8 1.8 0 1 1 4.45 16.3l.06-.06a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H3.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.06-.06A1.8 1.8 0 1 1 6.86 4.85l.06.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37V3.7a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.8 1.8 0 1 1 2.55 2.55l-.06.06a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9h.1a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.37.9Z',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  play: 'M7.4 5.4v13.2l11-6.6z',
  pause: 'M7.6 5.2h3v13.6h-3zM13.4 5.2h3v13.6h-3z',
  skipBack: 'M12.4 6 6.2 12l6.2 6M6.6 6v12M19 6l-6.2 6 6.2 6',
  skipForward: 'M11.6 6l6.2 6-6.2 6M17.4 6v12M5 6l6.2 6-6.2 6',
  volume: 'M4.4 9.6h3.2L12 6v12l-4.4-3.6H4.4ZM15.6 9a3.6 3.6 0 0 1 0 6M17.8 6.8a6.8 6.8 0 0 1 0 10.4',
  zoomIn: 'M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6ZM15.8 15.8l4.4 4.4M10.8 7.6v6.4M7.6 10.8h6.4',
  zoomOut: 'M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6ZM15.8 15.8l4.4 4.4M7.6 10.8h6.4',
  close: 'M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4',
  chevronLeft: 'M14.5 5 8 12l6.5 7',
  chevronRight: 'M9.5 5 16 12l-6.5 7',
  sparkles: 'M12 3.5v3M12 17.5v3M4.5 12h3M16.5 12h3M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7M7.4 7l.9 12.1a1.4 1.4 0 0 0 1.4 1.3h4.6a1.4 1.4 0 0 0 1.4-1.3L16.6 7',
  fullscreen: 'M8.4 4H4.4v4M19.6 8V4h-4M4.4 16v4h4M15.6 20h4v-4',
  fullscreenExit: 'M4.4 8.4h4v-4M19.6 8.4h-4v-4M4.4 15.6h4v4M19.6 15.6h-4v4',
};

export function Icon({
  name,
  size = 20,
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
