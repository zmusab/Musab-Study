import { motion, useReducedMotion } from 'motion/react';
import { NavLink, useLocation } from 'react-router-dom';
import { useId, type ReactNode } from 'react';
import { NAV_ENTRIES, type NavEntry } from './navigation';
import { cn } from '@/lib/cn';
import { springSoft } from '@/components/motion/transitions';
import { useProfile } from '@/hooks/useProfile';
import { Icon } from '@/components/ui/Icon';

/**
 * Structure de l'application : rail latéral dès 768 px, barre d'onglets en bas
 * en dessous.
 *
 * Le seuil est à 768 px et non à 1024 px pour que l'iPad EN PORTRAIT (834 px)
 * garde le rail latéral : à 1024 px, il basculait sur la navigation de
 * téléphone alors qu'il a toute la place nécessaire.
 *
 * La barre du bas n'expose que les 5 destinations principales. Le prototype
 * empilait ses 12 entrées dans une bande à défilement horizontal, illisible et
 * impossible à viser au pouce. Le reste des sections est accessible depuis
 * « Plus », qui déroule la liste complète.
 */

function NavItem({ entry, indicatorId }: { entry: NavEntry; indicatorId: string }) {
  const reduced = useReducedMotion();
  return (
    <NavLink
      to={entry.to}
      end={entry.to === '/'}
      style={{ color: entry.color }}
      className={cn(
        'group relative flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5',
        'text-[0.9rem] font-medium transition-colors duration-150',
        '[-webkit-tap-highlight-color:transparent] hover:bg-[var(--surface-2)]',
      )}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              // `layoutId` partagé : le fond glisse d'une entrée à l'autre
              // au lieu de clignoter.
              layoutId={reduced ? undefined : indicatorId}
              className="absolute inset-0 rounded-[var(--radius-control)] bg-[var(--accent-tint)]"
              transition={springSoft}
            />
          )}
          <Icon name={entry.icon} className="relative z-10 shrink-0" />
          <span className="relative z-10">{entry.label}</span>
        </>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const indicatorId = useId();
  const profile = useProfile();

  return (
    <aside className="hidden w-60 shrink-0 border-r border-[var(--line)] bg-[var(--bg-elevated)] md:flex md:flex-col">
      <div className="sticky top-0 flex h-dvh flex-col gap-5 overflow-y-auto scroll-contain px-3 py-5 pt-safe">
        <div className="px-2">
          <h1 className="text-[1.1rem] leading-tight">Musab Study</h1>
          <p className="mt-0.5 text-[0.72rem] text-[var(--ink-faint)]">
            {profile ? `${profile.program} — ${profile.section}` : 'Chargement…'}
          </p>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV_ENTRIES.map((entry) => (
            <NavItem key={entry.to} entry={entry} indicatorId={indicatorId} />
          ))}
        </nav>
      </div>
    </aside>
  );
}

function MobileTabBar() {
  const reduced = useReducedMotion();
  const indicatorId = useId();
  const primary = NAV_ENTRIES.filter((entry) => entry.primary);
  const tabs: NavEntry[] = [
    ...primary,
    // « Plus » n'appartient à aucune des 7 paires de couleur : c'est un tiroir
    // synthétique, pas une section — il suit la couleur du texte, neutre.
    { to: '/plus', label: 'Plus', icon: 'more', color: 'var(--ink)' },
  ];

  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 md:hidden',
        'border-t border-[var(--line)] bg-[var(--bg-elevated)]/92 backdrop-blur-xl',
        'pb-safe',
      )}
    >
      <div className="flex items-stretch justify-around px-1">
        {tabs.map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.to === '/'}
            data-touch-target
            className={({ isActive }) =>
              cn(
                'relative flex flex-1 flex-col items-center gap-0.5 py-2',
                'text-[0.66rem] font-medium transition-colors duration-150',
                '[-webkit-tap-highlight-color:transparent]',
                !isActive && 'text-[var(--ink-faint)]',
              )
            }
            style={({ isActive }) => (isActive ? { color: entry.color } : undefined)}
          >
            {({ isActive }) => (
              <>
                {isActive && !reduced && (
                  <motion.span
                    layoutId={indicatorId}
                    className="absolute inset-x-3 top-0 h-0.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                    transition={springSoft}
                  />
                )}
                <Icon name={entry.icon} size={22} />
                <span>{entry.shortLabel ?? entry.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

// Routes dont le contenu doit occuper toute la largeur/hauteur disponible,
// sans la mise en page centrée et paddée par défaut — l'explorateur 3D
// Anatomie a besoin de tout l'espace pour que le modèle reste la partie
// dominante de l'interface (§21 du cahier des charges), la navigation
// restant néanmoins visible (contrairement au lecteur PDF, en plein écran
// total, qui est une expérience de lecture ponctuelle plutôt qu'une section).
const FULL_BLEED_PREFIXES = ['/anatomie'];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const fullBleed = FULL_BLEED_PREFIXES.some((prefix) => location.pathname.startsWith(prefix));

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main
          key={location.pathname}
          className={cn(
            'flex-1',
            fullBleed
              ? 'flex min-h-0 flex-col pb-20 pt-safe md:pb-0'
              : 'mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 md:px-8 md:pt-10 pb-28 md:pb-16 pt-safe',
          )}
        >
          {children}
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
