import { memo } from 'react';
import { Button } from '@/components/ui';
import { StructureThumbnail } from './StructureThumbnail';
import type { AnatomyCategory, AnatomyStructure } from '@/types';

export interface Combination {
  label: string;
  categories: AnatomyCategory[];
}

/**
 * Combinaisons (§11) — chaque tuile montre les VRAIES vignettes des systèmes
 * combinés, rendues depuis des maillages du catalogue, et applique
 * réellement l'état des cinq systèmes au modèle. La tuile active est
 * signalée par `aria-pressed`, pas seulement par une couleur.
 */
export const CombinationsCard = memo(function CombinationsCard({
  combinations,
  allCategories,
  activeSystems,
  samples,
  onApply,
  onHideAll,
}: {
  combinations: readonly Combination[];
  allCategories: readonly AnatomyCategory[];
  activeSystems: Partial<Record<AnatomyCategory, boolean>>;
  /** Une structure représentative par système, pour la vignette. */
  samples: ReadonlyMap<AnatomyCategory, AnatomyStructure | null>;
  onApply: (categories: AnatomyCategory[]) => void;
  onHideAll: () => void;
}) {
  return (
    <section className="anatomy-card">
      <h2 className="anatomy-card-title">Combinaisons</h2>

      <div className="grid flex-1 grid-cols-2 gap-2">
        {combinations.map((combo) => {
          const active = allCategories.every((c) => activeSystems[c] === combo.categories.includes(c));
          return (
            <button
              key={combo.label}
              type="button"
              onClick={() => onApply(combo.categories)}
              aria-pressed={active}
              data-touch-target
              className={
                'flex flex-col items-center justify-center gap-2 rounded-[var(--radius-control)] border p-2.5 text-center transition-colors ' +
                (active
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
                  : 'border-[var(--line)] hover:bg-[var(--surface-2)]')
              }
            >
              <span aria-hidden className="flex items-center justify-center -space-x-2">
                {combo.categories.map((category) => (
                  <StructureThumbnail
                    key={category}
                    structure={samples.get(category) ?? null}
                    size={40}
                    className="ring-1 ring-[var(--surface-1)]"
                  />
                ))}
              </span>
              <span className="text-[0.78rem] font-medium leading-tight text-[var(--ink)]">{combo.label}</span>
            </button>
          );
        })}
      </div>

      <Button size="sm" variant="ghost" className="self-start" onClick={onHideAll}>
        Tout masquer
      </Button>
    </section>
  );
});
