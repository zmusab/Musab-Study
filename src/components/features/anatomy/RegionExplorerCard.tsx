import { useMemo, useState } from 'react';
import { Icon, Modal } from '@/components/ui';
import { StructureThumbnail } from './StructureThumbnail';
import { BodySchema, schemaHasZone, schemaRegionBox } from './BodySchema';
import { pickRepresentative } from '@/services/anatomy/representative';
import { summarizeRegions, summarizeSubregions, structuresInSubregion } from '@/services/anatomy/regions';
import type { AnatomyStructure, ID } from '@/types';

/**
 * « Exploration par région » — navigation Corps entier → région →
 * sous-région → structure, pilotée par un SCHÉMA ANATOMIQUE INTERACTIF
 * (`BodySchema`) et doublée d'une liste.
 *
 * Le schéma est un rendu du corps réel : ses zones cliquables sont dérivées
 * des maillages, pas dessinées. Certaines zones sont invisibles de face
 * (encéphale, dos) — elles n'ont pas de point sur le schéma et restent
 * accessibles par la liste, signalées comme telles plutôt que placées au
 * hasard.
 *
 * Tous les comptes affichés viennent du catalogue réellement généré : une
 * sous-région sans maillage apparaît à zéro, jamais masquée ni gonflée.
 */
export function RegionExplorerCard({
  structures,
  focusedSubregion,
  onOpenSubregion: onOpenSubregionProp,
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
  const regions = useMemo(() => summarizeRegions(structures), [structures]);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const subregions = useMemo(
    () => (regionId ? summarizeSubregions(structures, regionId) : []),
    [structures, regionId],
  );
  /** Ouvrir une sous-région referme le grand schéma : on veut voir le modèle. */
  const onOpenSubregion = (id: string) => {
    setExpanded(false);
    onOpenSubregionProp(id);
  };

  const focusedStructures = focusedSubregion ? structuresInSubregion(structures, focusedSubregion) : [];
  const level = focusedSubregion ? 'structures' : regionId ? 'subregions' : 'regions';

  const representative = (ids: string[]) =>
    pickRepresentative(structures, (s) => ids.includes(s.subregion ?? ''));

  const back = () => {
    if (focusedSubregion) onCloseSubregion();
    else setRegionId(null);
  };

  const title =
    level === 'structures'
      ? (subregions.find((s) => s.id === focusedSubregion)?.label ?? 'Structures')
      : level === 'subregions'
        ? (regions.find((r) => r.id === regionId)?.label ?? 'Région')
        : 'Exploration par région';

  /** Sous-régions non visibles sur une vue antérieure — listées à part, jamais inventées sur le schéma. */
  const offSchema = subregions.filter((s) => s.meshCount > 0 && !schemaHasZone('sub', s.id));

  return (
    <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        {level !== 'regions' && (
          <button
            type="button"
            onClick={back}
            aria-label="Remonter d’un niveau"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--surface-2)]"
          >
            <Icon name="chevronLeft" size={13} />
          </button>
        )}
        <p className="min-w-0 flex-1 truncate text-[0.85rem] font-semibold text-[var(--ink)]">{title}</p>
        {/* Le rail est étroit par nature ; l'agrandissement donne au schéma
            une taille réellement confortable au doigt sur iPad (§8/§18). */}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Agrandir le schéma anatomique"
          title="Agrandir le schéma anatomique"
          data-touch-target
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          <Icon name="fullscreen" size={13} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {level === 'regions' && (
          <BodySchema
            kind="region"
            zones={regions.map((r) => ({
              id: r.id,
              label: r.label,
              detail: `${r.meshCount} structures en 3D`,
            }))}
            activeId={null}
            onSelect={setRegionId}
            hint="Touche une région du corps."
          />
        )}

        {level === 'subregions' && (
          <>
            <BodySchema
              kind="sub"
              zones={subregions
                .filter((s) => s.meshCount > 0)
                .map((s) => ({ id: s.id, label: s.label, detail: `${s.meshCount} structures en 3D` }))}
              activeId={focusedSubregion}
              onSelect={onOpenSubregion}
              hint="Touche une zone de la région."
              crop={regionId ? schemaRegionBox(regionId) : null}
            />
            {offSchema.length > 0 && (
              <div className="shrink-0">
                <p className="mb-1 text-[0.64rem] leading-snug text-[var(--ink-faint)]">
                  Invisible sur une vue de face — accessible ici :
                </p>
                <div className="flex flex-wrap gap-1">
                  {offSchema.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => onOpenSubregion(sub.id)}
                      className="flex items-center gap-1.5 rounded-full border border-[var(--line)] py-0.5 pl-0.5 pr-2 text-[0.7rem] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <StructureThumbnail structure={representative([sub.id])} size={20} />
                      {sub.label}
                      <span className="text-[var(--ink-faint)]">{sub.meshCount}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {level === 'structures' && (
          <ul className="flex shrink-0 flex-col gap-0.5">
            {focusedStructures.map((structure) => (
              <li key={structure.id}>
                <button
                  type="button"
                  onClick={() => onSelectStructure(structure.id)}
                  title={structure.name}
                  className={
                    'flex w-full items-center gap-2 rounded-[var(--radius-control)] p-1 text-left text-[0.8rem] transition-colors ' +
                    (structure.id === selectedId
                      ? 'bg-[var(--accent-tint)] text-[var(--accent-ink)]'
                      : 'text-[var(--ink-soft)] hover:bg-[var(--surface-2)]')
                  }
                >
                  <StructureThumbnail structure={structure} size={26} />
                  <span className="truncate">{structure.name}</span>
                  {!structure.model3dRef && (
                    <span className="ml-auto shrink-0 text-[0.62rem] text-[var(--ink-faint)]">cours</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {level === 'structures' && (
        <p className="mt-1.5 shrink-0 text-[0.68rem] leading-snug text-[var(--ink-faint)]">
          Clique sur une structure pour l’explorer.
        </p>
      )}

      <Modal
        open={expanded}
        onClose={() => setExpanded(false)}
        size="lg"
        // La section Anatomie force le thème sombre ; la modale, rendue dans
        // un portail, doit le suivre explicitement.
        theme="dark"
        title={regionId ? (regions.find((r) => r.id === regionId)?.label ?? 'Région') : 'Exploration par région'}
        description={
          regionId
            ? 'Touche une zone pour l’ouvrir dans le modèle 3D.'
            : 'Touche une région du corps pour voir ses sous-régions.'
        }
      >
        <div className="flex h-[62vh] min-h-0 flex-col">
          {regionId ? (
            <BodySchema
              kind="sub"
              zones={subregions
                .filter((sub) => sub.meshCount > 0)
                .map((sub) => ({ id: sub.id, label: sub.label, detail: `${sub.meshCount} structures en 3D` }))}
              activeId={focusedSubregion}
              onSelect={onOpenSubregion}
              hint="Touche une zone de la région."
              crop={schemaRegionBox(regionId)}
            />
          ) : (
            <BodySchema
              kind="region"
              zones={regions.map((r) => ({
                id: r.id,
                label: r.label,
                detail: `${r.meshCount} structures en 3D`,
              }))}
              activeId={null}
              onSelect={setRegionId}
              hint="Touche une région du corps."
            />
          )}
          {regionId && (
            <button
              type="button"
              onClick={() => setRegionId(null)}
              className="mt-2 shrink-0 self-center rounded-full border border-[var(--line)] px-3 py-1.5 text-[0.8rem] text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
            >
              ← Toutes les régions
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}
