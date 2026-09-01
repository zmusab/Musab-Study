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

function NavItem({ entry, indicatorId, compact }: { entry: NavEntry; indicatorId: string; compact?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <NavLink
      to={entry.to}
      end={entry.to === '/'}
      style={{ color: entry.color }}
      // En mode compact le libellé n'est plus rendu : `aria-label` et `title`
      // conservent le nom accessible, donc la navigation reste utilisable au
      // lecteur d'écran comme au survol.
      aria-label={compact ? entry.label : undefined}
      title={compact ? entry.label : undefined}
      className={cn(
        'group relative flex items-center rounded-[var(--radius-control)] py-2.5',
        'text-[0.9rem] font-medium transition-colors duration-150',
        '[-webkit-tap-highlight-color:transparent] hover:bg-[var(--surface-2)]',
        compact ? 'justify-center px-2' : 'gap-3 px-3',
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
          {!compact && <span className="relative z-10">{entry.label}</span>}
        </>
      )}
    </NavLink>
  );
}

/**
 * `compact` : rail réduit aux icônes. Utilisé sur les routes plein écran
 * (Anatomie 3D), où chaque pixel de largeur rendu au contenu compte — le rail
 * complet y consommait 240 px sur les ~1194 px d'un iPad en paysage, au
 * détriment du modèle et des panneaux.
 */
function Sidebar({ compact }: { compact?: boolean }) {
  const indicatorId = useId();
  const profile = useProfile();

  return (
    <aside
      className={cn(
        'hidden shrink-0 border-r border-[var(--line)] bg-[var(--bg-elevated)] md:flex md:flex-col',
        compact ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn('sticky top-0 flex h-dvh flex-col gap-5 overflow-y-auto scroll-contain py-5 pt-safe', compact ? 'px-2' : 'px-3')}>
        {compact ? (
          <p className="px-1 text-center text-[0.95rem] font-semibold leading-none text-[var(--ink)]" title="Musab Study">
            M
          </p>
        ) : (
          <div className="px-2">
            <h1 className="text-[1.1rem] leading-tight">Musab Study</h1>
            <p className="mt-0.5 text-[0.72rem] text-[var(--ink-faint)]">
              {profile ? `${profile.program} — ${profile.section}` : 'Chargement…'}
            </p>
          </div>
        )}

        <nav className="flex flex-col gap-0.5">
          {NAV_ENTRIES.map((entry) => (
            <NavItem key={entry.to} entry={entry} indicatorId={indicatorId} compact={compact} />
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
    // Anatomie force le thème sombre sur toute la coquille (rail compris),
    // quel que soit le réglage clair/sombre choisi par l'utilisateur — une
    // section « cockpit » immersive, comme le lecteur PDF force son propre
    // plein écran. `[data-theme]` s'applique à n'importe quel élément, pas
    // seulement à la racine du document : cette valeur l'emporte sur celle
    // héritée de `<html>` pour tout ce sous-arbre, sans nouvelle feuille de
    // style — les mêmes variables déjà utilisées partout ailleurs.
    // Sur une route pleine page ET à partir de `lg` (iPad en paysage), la
    // coquille fait EXACTEMENT la hauteur de la fenêtre : c'est ce qui permet
    // aux colonnes internes de défiler chacune de leur côté au lieu
    // d'allonger la page. En portrait et sur mobile les colonnes s'empilent —
    // la page doit alors pouvoir grandir et défiler normalement, sinon le bas
    // de l'empilement serait inaccessible.
    <div
      className={cn('flex min-h-dvh', fullBleed && 'lg:h-dvh lg:min-h-0 lg:overflow-hidden')}
      data-theme={fullBleed ? 'dark' : undefined}
      style={fullBleed ? { background: 'var(--bg)' } : undefined}
    >
      <Sidebar compact={fullBleed} />
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
