import { Icon } from '@/components/ui';
import { subregionMeta, regionMeta } from '@/services/anatomy/regions';

/**
 * Fil d'Ariane — « Corps entier > région > sous-région > Structure ».
 * Le niveau « région » suit la sous-région réellement ouverte (tronc, membre
 * supérieur…), il n'est plus figé sur la tête et le cou.
 * Chaque niveau cliquable revient en arrière (§8). La sous-région reflète un
 * vrai regroupement de structures déjà cataloguées (`services/anatomy/regions.ts`),
 * pas un niveau de navigation décoratif.
 */
export function RegionBreadcrumb({
  subregionId,
  structureName,
  onGoToBody,
  onGoToRegion,
  onGoToSubregion,
}: {
  subregionId: string | null;
  structureName: string | null;
  onGoToBody: () => void;
  onGoToRegion: () => void;
  onGoToSubregion: () => void;
}) {
  const subregion = subregionMeta(subregionId);
  const region = regionMeta(subregion?.region ?? 'tete-et-cou');
  return (
    <nav aria-label="Navigation anatomique" className="flex flex-wrap items-center gap-1 text-[0.82rem] text-[var(--ink-soft)]">
      <button type="button" onClick={onGoToBody} className="rounded px-1 hover:text-[var(--ink)] hover:underline">
        Corps entier
      </button>
      <Icon name="chevronRight" size={12} className="text-[var(--ink-faint)]" />
      <button
        type="button"
        onClick={onGoToRegion}
        className={
          subregion || structureName
            ? 'rounded px-1 hover:text-[var(--ink)] hover:underline'
            : 'rounded px-1 font-medium text-[var(--ink)]'
        }
      >
        {region?.label ?? 'Tête et cou'}
      </button>
      {subregion && (
        <>
          <Icon name="chevronRight" size={12} className="text-[var(--ink-faint)]" />
          <button
            type="button"
            onClick={onGoToSubregion}
            className={
              structureName
                ? 'rounded px-1 hover:text-[var(--ink)] hover:underline'
                : 'rounded px-1 font-medium text-[var(--ink)]'
            }
          >
            {subregion.label}
          </button>
        </>
      )}
      {structureName && (
        <>
          <Icon name="chevronRight" size={12} className="text-[var(--ink-faint)]" />
          <span className="rounded px-1 font-medium text-[var(--ink)]">{structureName}</span>
        </>
      )}
    </nav>
  );
}
