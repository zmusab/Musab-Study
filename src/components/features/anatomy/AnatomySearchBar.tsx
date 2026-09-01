import { useMemo, useState } from 'react';
import { Icon, Input } from '@/components/ui';
import { StructureThumbnail } from './StructureThumbnail';
import { searchItems, type SearchableItem } from '@/services/search';
import { systemOf } from '@/services/anatomy/systemColors';
import type { AnatomyStructure, ID } from '@/types';

/**
 * Recherche « très visible » (§7) — réutilise le moteur approximatif déjà
 * utilisé par `/recherche` (`searchItems`, tolérant aux fautes de frappe),
 * pas un filtre ad hoc. Rail permanent plutôt qu'un menu qui disparaît : les
 * résultats restent visibles pendant l'exploration, comme demandé. Chaque
 * sélection déclenche le vol de caméra (géré par le parent), jamais une
 * téléportation directe.
 *
 * Chaque résultat porte la VIGNETTE du maillage réel de la structure (voir
 * `StructureThumbnail`) : on voit à quoi ressemble l'os ou le muscle avant de
 * cliquer — jamais une icône ni un emoji. Les structures sans géométrie
 * affichent une pastille neutre annoncée comme telle. Le système est rappelé
 * par sa couleur de palette, la même que celle du maillage dans le modèle.
 */
export function AnatomySearchBar({
  structures,
  selectedId,
  onSelect,
}: {
  structures: AnatomyStructure[];
  selectedId: ID | null;
  onSelect: (id: ID) => void;
}) {
  const [query, setQuery] = useState('');

  const items = useMemo<SearchableItem[]>(
    () =>
      structures.map((s) => ({
        id: s.id,
        kind: 'anatomy' as const,
        title: s.name,
        subtitle: s.latinName,
        to: `/anatomie?structure=${s.id}`,
      })),
    [structures],
  );
  const byId = useMemo(() => new Map(structures.map((s) => [s.id, s])), [structures]);

  const results = useMemo(() => (query.trim().length > 0 ? searchItems(items, query, 12) : []), [items, query]);

  return (
    <div className="flex h-full flex-col">
      <p className="mb-2 text-[0.78rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
        Recherche intelligente
      </p>
      <div className="relative">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une structure…"
          className="pl-9"
          aria-label="Rechercher une structure anatomique"
        />
      </div>

      <div className="mt-2 flex-1 overflow-y-auto">
        {query.trim().length === 0 ? (
          <p className="px-1 py-3 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
            Cherche un os, un muscle, une dent (« dent 36 »), un nerf ou un vaisseau — les fautes de frappe sont tolérées.
          </p>
        ) : results.length === 0 ? (
          <p className="px-1 py-3 text-[0.78rem] text-[var(--ink-faint)]">Aucun résultat.</p>
        ) : (
          <ul data-anatomy-search-results className="flex flex-col gap-1">
            {results.map((result) => {
              const isSelected = result.id === selectedId;
              const structure = byId.get(result.id);
              if (!structure) return null;
              const system = systemOf(structure);
              return (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(result.id)}
                    className={
                      'flex w-full items-start gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left transition-colors duration-150 ' +
                      (isSelected ? 'bg-[var(--accent-tint)]' : 'hover:bg-[var(--surface-2)]')
                    }
                  >
                    <StructureThumbnail structure={structure} size={32} />
                    <span className="min-w-0 flex-1">
                      {/* Deux lignes plutôt qu'une troncature : quatre
                          faisceaux du masséter tronqués à « Masséter
                          (faiscea… » sont indiscernables. */}
                      <span className="block text-[0.84rem] font-medium leading-tight text-[var(--ink)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                        {result.title}
                      </span>
                      {/* Système d'appartenance, avec sa pastille de
                          couleur : le même code que sur le modèle et dans
                          l'exploration, donc reconnaissable sans le lire. */}
                      <span className="mt-0.5 flex items-center gap-1.5 text-[0.72rem] text-[var(--ink-faint)]">
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
                          style={{ backgroundColor: system.hex }}
                        />
                        <span className="truncate">
                          {system.label}
                          {result.subtitle ? ` · ${result.subtitle}` : ''}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
