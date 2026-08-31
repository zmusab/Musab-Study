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
    <div className="flex flex-col gap-0.5" role="group" aria-label="Systèmes anatomiques">
      {SYSTEMS.map((system) => {
        const isActive = active[system.category] === true;
        return (
          <button
            key={system.category}
            type="button"
            aria-pressed={isActive}
            data-touch-target
            onClick={() => onToggle(system.category)}
            className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-2 text-left transition-colors duration-150 hover:bg-[var(--surface-2)]"
          >
            <span aria-hidden className="text-[1.05rem]">
              {system.icon}
            </span>
            <span className="flex-1 text-[0.88rem] font-medium text-[var(--ink)]">
              {system.label}
              {!system.hasMesh && (
                <span
                  className="ml-1.5 text-[0.65rem] font-normal text-[var(--ink-faint)]"
                  title="Aucun maillage 3D dans les données ouvertes intégrées — structure réelle, recherchable et explicable par l'IA, sans représentation visuelle"
                >
                  (cours)
                </span>
              )}
            </span>
            <span
              className={cn(
                'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150',
                isActive ? 'bg-[var(--accent)]' : 'bg-[var(--surface-2)] ring-1 ring-inset ring-[var(--line-strong)]',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150',
                  isActive ? 'translate-x-[18px]' : 'translate-x-0.5',
                )}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
