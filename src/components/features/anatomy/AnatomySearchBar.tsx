import { useMemo, useState } from 'react';
import { Icon, Input } from '@/components/ui';
import { searchItems, type SearchableItem } from '@/services/search';
import type { AnatomyCategory, AnatomyStructure, ID } from '@/types';

const CATEGORY_ICON: Record<AnatomyCategory, string> = {
  squelette: '🦴',
  muscles: '💪',
  nerfs: '🧠',
  vaisseaux: '🩸',
  organes: '🫀',
};

const CATEGORY_LABEL: Record<AnatomyCategory, string> = {
  squelette: 'Os',
  muscles: 'Muscle',
  nerfs: 'Nerf',
  vaisseaux: 'Vaisseau',
  organes: 'Organe',
};

/**
 * Recherche « très visible » (§7) — réutilise le moteur approximatif déjà
 * utilisé par `/recherche` (`searchItems`, tolérant aux fautes de frappe),
 * pas un filtre ad hoc. Rail permanent plutôt qu'un menu qui disparaît : les
 * résultats restent visibles pendant l'exploration, comme demandé. Chaque
 * sélection déclenche le vol de caméra (géré par le parent), jamais une
 * téléportation directe.
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
  const categoryById = useMemo(() => new Map(structures.map((s) => [s.id, s.category])), [structures]);

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
          placeholder="Rechercher une structure anatomique…"
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
          <ul className="flex flex-col gap-1">
            {results.map((result) => {
              const isSelected = result.id === selectedId;
              const category = categoryById.get(result.id);
              if (!category) return null;
              return (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(result.id)}
                    className={
                      'flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left transition-colors duration-150 ' +
                      (isSelected ? 'bg-[var(--accent-tint)]' : 'hover:bg-[var(--surface-2)]')
                    }
                  >
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[0.95rem]"
                    >
                      {CATEGORY_ICON[category]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.86rem] font-medium text-[var(--ink)]">{result.title}</span>
                      <span className="block truncate text-[0.72rem] text-[var(--ink-faint)]">
                        {CATEGORY_LABEL[category]}
                        {result.subtitle ? ` · ${result.subtitle}` : ''}
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
