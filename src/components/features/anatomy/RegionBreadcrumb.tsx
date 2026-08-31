import { Icon } from '@/components/ui';

/**
 * Fil d'Ariane — « Corps entier > Tête et cou > Structure ». Un seul niveau
 * de région existe pour l'instant (Phase 1 : Tête et Cou) ; la structure est
 * ajoutée au fil dès qu'une sélection est active. Chaque niveau cliquable
 * revient en arrière, comme demandé (§8).
 */
export function RegionBreadcrumb({
  structureName,
  onGoToBody,
  onGoToRegion,
}: {
  structureName: string | null;
  onGoToBody: () => void;
  onGoToRegion: () => void;
}) {
  return (
    <nav aria-label="Navigation anatomique" className="flex items-center gap-1 text-[0.82rem] text-[var(--ink-soft)]">
      <button type="button" onClick={onGoToBody} className="rounded px-1 hover:text-[var(--ink)] hover:underline">
        Corps entier
      </button>
      <Icon name="chevronRight" size={12} className="text-[var(--ink-faint)]" />
      <button
        type="button"
        onClick={onGoToRegion}
        className={structureName ? 'rounded px-1 hover:text-[var(--ink)] hover:underline' : 'rounded px-1 font-medium text-[var(--ink)]'}
      >
        Tête et cou
      </button>
      {structureName && (
        <>
          <Icon name="chevronRight" size={12} className="text-[var(--ink-faint)]" />
          <span className="rounded px-1 font-medium text-[var(--ink)]">{structureName}</span>
        </>
      )}
    </nav>
  );
}
