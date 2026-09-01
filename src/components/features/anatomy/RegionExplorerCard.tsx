import { Icon } from '@/components/ui';
import { summarizeSubregions, structuresInSubregion } from '@/services/anatomy/regions';
import type { AnatomyStructure, ID } from '@/types';

/**
 * « Exploration par région » (§3/§8 du cahier des charges) — un vrai
 * drill-down Tête et cou → sous-région → structure, construit uniquement à
 * partir du regroupement réel des 88 structures cataloguées
 * (`services/anatomy/regions.ts`), pas une carte décorative.
 */
export function RegionExplorerCard({
  structures,
  focusedSubregion,
  onOpenSubregion,
  onCloseSubregion,
  selectedId,
  onSelectStructure,
}: {
  structures: AnatomyStructure[];
  focusedSubregion: string | null;
  onOpenSubregion: (id: string) => void;
  onCloseSubregion: () => void;
  selectedId: ID | null;
  onSelectStructure: (id: ID) => void;
}) {
  const summaries = summarizeSubregions(structures);
  const focused = focusedSubregion ? summaries.find((s) => s.id === focusedSubregion) : undefined;
  const focusedStructures = focused ? structuresInSubregion(structures, focused.id) : [];

  return (
    <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[0.85rem] font-semibold text-[var(--ink)]">Exploration par région</p>
        {focused && (
          <button
            type="button"
            onClick={onCloseSubregion}
            aria-label="Revenir à Tête et cou"
            className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--surface-2)]"
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>

      {!focused ? (
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {summaries.map((summary) => (
            <li key={summary.id}>
              <button
                type="button"
                onClick={() => onOpenSubregion(summary.id)}
                className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[0.84rem] transition-colors hover:bg-[var(--surface-2)]"
              >
                <span aria-hidden>{summary.icon}</span>
                <span className="flex-1 text-[var(--ink)]">{summary.label}</span>
                <span className="text-[0.72rem] text-[var(--ink-faint)]">{summary.structureCount}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="mb-1.5 flex items-center gap-1.5 text-[0.8rem] font-medium text-[var(--ink)]">
            <span aria-hidden>{focused.icon}</span> {focused.label}
          </p>
          <ul className="flex-1 overflow-y-auto">
            {focusedStructures.map((structure) => (
              <li key={structure.id}>
                <button
                  type="button"
                  onClick={() => onSelectStructure(structure.id)}
                  className={
                    'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[0.8rem] transition-colors ' +
                    (structure.id === selectedId ? 'bg-[var(--accent-tint)] text-[var(--accent-ink)]' : 'text-[var(--ink-soft)] hover:bg-[var(--surface-2)]')
                  }
                >
                  <span
                    className={
                      'h-1.5 w-1.5 shrink-0 rounded-full ' + (structure.model3dRef ? 'bg-[var(--accent)]' : 'bg-[var(--ink-faint)]')
                    }
                  />
                  <span className="truncate">{structure.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-2 text-[0.72rem] text-[var(--ink-faint)]">
        {focused ? 'Clique sur une structure pour explorer.' : 'Clique sur une région pour explorer.'}
      </p>
    </div>
  );
}
