import { cn } from '@/lib/cn';
import type { AnatomyCategory } from '@/types';
import type { SystemVisibility } from '@/services/anatomy/visibility';

const SYSTEMS: { category: AnatomyCategory; label: string; icon: string; hasMesh: boolean }[] = [
  { category: 'squelette', label: 'Squelette', icon: '🦴', hasMesh: true },
  { category: 'muscles', label: 'Muscles', icon: '💪', hasMesh: true },
  { category: 'nerfs', label: 'Nerfs', icon: '🧠', hasMesh: false },
  { category: 'vaisseaux', label: 'Vaisseaux', icon: '🩸', hasMesh: true },
  { category: 'organes', label: 'Organes', icon: '🫀', hasMesh: true },
];

/**
 * Toggles NON exclusifs — 0, 1, 2, ... ou les 5 systèmes peuvent être actifs
 * en même temps (§3 du cahier des charges). « Nerfs » reste un vrai toggle
 * (les structures nerveuses existent, restent recherchables et explicables
 * par l'IA) mais est marqué comme sans maillage 3D disponible aujourd'hui —
 * honnête plutôt que silencieux sur cette limite (voir SOURCES.md).
 */
export function SystemToggleBar({
  active,
  onToggle,
}: {
  active: SystemVisibility;
  onToggle: (category: AnatomyCategory) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Systèmes anatomiques">
      {SYSTEMS.map((system) => {
        const isActive = active[system.category] === true;
        return (
          <button
            key={system.category}
            type="button"
            aria-pressed={isActive}
            data-touch-target
            onClick={() => onToggle(system.category)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[0.85rem] font-medium transition-colors duration-150',
              isActive
                ? 'border-[var(--nav-red)] bg-[var(--nav-red)]/15 text-[var(--nav-red)]'
                : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] hover:bg-[var(--surface-hover)]',
            )}
          >
            <span aria-hidden>{system.icon}</span>
            {system.label}
            {!system.hasMesh && (
              <span className="text-[0.68rem] font-normal text-[var(--ink-faint)]" title="Aucun maillage 3D dans les données ouvertes intégrées">
                (cours)
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
