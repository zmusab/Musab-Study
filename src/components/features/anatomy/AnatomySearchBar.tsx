import { useMemo, useState } from 'react';
import { Icon, Input } from '@/components/ui';
import { searchItems, type SearchableItem } from '@/services/search';
import type { AnatomyStructure, ID } from '@/types';

/**
 * Recherche « très visible » (§7) — réutilise le moteur approximatif déjà
 * utilisé par `/recherche` (`searchItems`, tolérant aux fautes de frappe),
 * pas un filtre ad hoc. Sélectionner un résultat déclenche le vol de caméra
 * (géré par le parent via `onSelect`), jamais une téléportation directe.
 */
export function AnatomySearchBar({
  structures,
  onSelect,
}: {
  structures: AnatomyStructure[];
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

  const results = useMemo(() => (query.trim().length > 0 ? searchItems(items, query, 8) : []), [items, query]);

  return (
    <div className="relative">
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
      {results.length > 0 && (
        <ul className="surface-card absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto p-1.5 shadow-[var(--shadow-lift)]">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(result.id);
                  setQuery('');
                }}
                className="flex w-full flex-col items-start rounded-[var(--radius-control)] px-3 py-2 text-left hover:bg-[var(--surface-hover)]"
              >
                <span className="text-[0.88rem] font-medium">{result.title}</span>
                {result.subtitle && <span className="text-[0.74rem] text-[var(--ink-faint)]">{result.subtitle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
