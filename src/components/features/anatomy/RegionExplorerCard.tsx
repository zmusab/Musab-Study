import { useMemo, useState } from 'react';
import { Icon } from '@/components/ui';
import { buildRegionTree, regionPath, type RegionNode } from '@/services/anatomy/bodyRegions';
import { structuresInSubregion } from '@/services/anatomy/regions';
import type { AnatomyStructure, ID } from '@/types';

/**
 * « Exploration par région » (§9) — navigation Corps entier → région →
 * sous-région → structure.
 *
 * L'arbre décrit tout le corps, mais la disponibilité de chaque nœud est
 * DÉRIVÉE du catalogue réellement généré : une région sans maillage est
 * affichée, grisée, avec la raison exacte. Rien n'est masqué pour faire
 * croire que l'atlas est complet, et rien n'est simulé pour faire croire
 * qu'une région existe en 3D.
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
  const tree = useMemo(() => buildRegionTree(structures), [structures]);
  // Point d'entrée sur « Tête et cou » : c'est la seule région modélisée
  // aujourd'hui, ouvrir sur « Corps entier » ajouterait un clic inutile.
  const [nodeId, setNodeId] = useState('tete-et-cou');

  const path = useMemo(() => regionPath(tree, nodeId), [tree, nodeId]);
  const node: RegionNode = path[path.length - 1] ?? tree;

  const focusedStructures = focusedSubregion ? structuresInSubregion(structures, focusedSubregion) : [];
  const showingStructures = focusedSubregion !== null && node.subregion === focusedSubregion;

  return (
    <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        {path.length > 1 && (
          <button
            type="button"
            onClick={() => {
              const parent = path[path.length - 2]!;
              setNodeId(parent.id);
              if (focusedSubregion) onCloseSubregion();
            }}
            aria-label="Remonter d’un niveau"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--surface-2)]"
          >
            <Icon name="chevronLeft" size={13} />
          </button>
        )}
        <p className="min-w-0 flex-1 truncate text-[0.85rem] font-semibold text-[var(--ink)]">
          {path.length > 1 ? node.label : 'Exploration par région'}
        </p>
        {node.meshCount > 0 && (
          <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[0.65rem] text-[var(--ink-faint)]">
            {node.meshCount} en 3D
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showingStructures ? (
          <ul className="flex flex-col gap-0.5">
            {focusedStructures.map((structure) => (
              <li key={structure.id}>
                <button
                  type="button"
                  onClick={() => onSelectStructure(structure.id)}
                  className={
                    'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[0.8rem] transition-colors ' +
                    (structure.id === selectedId
                      ? 'bg-[var(--accent-tint)] text-[var(--accent-ink)]'
                      : 'text-[var(--ink-soft)] hover:bg-[var(--surface-2)]')
                  }
                >
                  <span
                    className={
                      'h-1.5 w-1.5 shrink-0 rounded-full ' +
                      (structure.model3dRef ? 'bg-[var(--accent)]' : 'bg-[var(--ink-faint)]')
                    }
                  />
                  <span className="truncate">{structure.name}</span>
                  {!structure.model3dRef && (
                    <span className="ml-auto shrink-0 text-[0.62rem] text-[var(--ink-faint)]">cours</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {(node.children ?? []).map((child) => {
              const disabled = !child.available;
              return (
                <li key={child.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    title={disabled ? child.unavailableReason : undefined}
                    onClick={() => {
                      setNodeId(child.id);
                      if (child.subregion) onOpenSubregion(child.subregion);
                    }}
                    className={
                      'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[0.84rem] transition-colors ' +
                      (disabled
                        ? 'cursor-not-allowed text-[var(--ink-faint)] opacity-60'
                        : 'text-[var(--ink)] hover:bg-[var(--surface-2)]')
                    }
                  >
                    <span aria-hidden>{child.icon}</span>
                    <span className="flex-1 truncate">{child.label}</span>
                    {disabled ? (
                      <span className="shrink-0 text-[0.62rem] uppercase tracking-wide">indisponible</span>
                    ) : (
                      <span className="shrink-0 text-[0.72rem] text-[var(--ink-faint)]">{child.meshCount}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-1.5 shrink-0 text-[0.68rem] leading-snug text-[var(--ink-faint)]">
        {showingStructures
          ? 'Clique sur une structure pour l’explorer.'
          : node.children?.some((c) => !c.available)
            ? 'Les régions grisées n’ont pas encore de maillage 3D.'
            : 'Clique sur une région pour l’explorer.'}
      </p>
    </div>
  );
}
