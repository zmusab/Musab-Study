import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import assetManifest from '@/data/anatomy/assetManifest.json';
import { StructureThumbnail } from './StructureThumbnail';
import { pickRepresentative } from '@/services/anatomy/representative';
import type { AnatomyCategory, AnatomyStructure } from '@/types';
import type { SystemVisibility } from '@/services/anatomy/visibility';

const SYSTEMS: { category: AnatomyCategory; label: string }[] = [
  { category: 'squelette', label: 'Squelette' },
  { category: 'muscles', label: 'Muscles' },
  { category: 'nerfs', label: 'Nerfs' },
  { category: 'vaisseaux', label: 'Vaisseaux' },
  { category: 'organes', label: 'Organes' },
];

/**
 * Un système n'est marqué « (cours) » que s'il n'a RÉELLEMENT aucun maillage
 * dans les assets produits — déduit du manifeste généré, jamais d'un
 * booléen écrit à la main qui se désynchroniserait des données. C'est ce qui
 * évite d'annoncer comme absent un système qui existe (ou l'inverse).
 */
const CATEGORIES_WITH_MESH = new Set(
  (assetManifest as { category: AnatomyCategory }[]).map((g) => g.category),
);

/**
 * Toggles NON exclusifs — 0, 1, 2, ... ou les 5 systèmes peuvent être actifs
 * en même temps (§3 du cahier des charges). Le marqueur « (cours) »
 * est calculé depuis le manifeste d'assets : un système ne s'affiche comme
 * dépourvu de 3D que si aucun maillage n'existe réellement pour lui, et le
 * marqueur disparaît de lui-même le jour où des maillages sont ajoutés.
 *
 * Chaque système est illustré par la vignette d'une structure réelle de ce
 * système, prise dans le périmètre actuellement chargé — pas par un emoji.
 */
export function SystemToggleBar({
  active,
  onToggle,
  structures,
}: {
  active: SystemVisibility;
  onToggle: (category: AnatomyCategory) => void;
  structures: readonly AnatomyStructure[];
}) {
  const sample = useMemo(() => {
    const map = new Map<AnatomyCategory, AnatomyStructure | null>();
    for (const system of SYSTEMS) {
      map.set(system.category, pickRepresentative(structures, (s) => s.category === system.category));
    }
    return map;
  }, [structures]);

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
            className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--surface-2)]"
          >
            <StructureThumbnail structure={sample.get(system.category) ?? null} size={24} />
            <span className="flex-1 text-[0.84rem] font-medium text-[var(--ink)]">
              {system.label}
              {!CATEGORIES_WITH_MESH.has(system.category) && (
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
