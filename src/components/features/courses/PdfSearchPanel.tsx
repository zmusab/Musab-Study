import { useMemo, useState } from 'react';
import { Icon, Input } from '@/components/ui';
import { searchDocumentText } from '@/services/pdf/search';

/** Recherche dans le PDF ouvert — panneau latéral, résultats groupés par page. */
export function PdfSearchPanel({
  text,
  pageOffsets,
  onJumpToPage,
  onClose,
}: {
  text: string;
  pageOffsets: number[];
  onJumpToPage: (page: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const matches = useMemo(
    () => (query.trim().length > 0 ? searchDocumentText(text, pageOffsets, query) : []),
    [text, pageOffsets, query],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--line)] p-3">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher dans ce PDF…"
          className="flex-1"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la recherche"
          data-touch-target
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {query.trim().length === 0 ? (
          <p className="px-1 text-[0.82rem] text-[var(--ink-faint)]">
            Recherche exacte (accents et casse ignorés), page par page.
          </p>
        ) : matches.length === 0 ? (
          <p className="px-1 text-[0.82rem] text-[var(--ink-faint)]">Aucun résultat.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {matches.map((match) => (
              <li key={match.charOffset}>
                <button
                  type="button"
                  onClick={() => onJumpToPage(match.page)}
                  className="w-full rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <span className="text-[0.72rem] font-semibold text-[var(--accent)]">
                    Page {match.page}
                  </span>
                  <p className="mt-0.5 text-[0.82rem] leading-relaxed text-[var(--ink-soft)]">
                    {match.excerpt}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
