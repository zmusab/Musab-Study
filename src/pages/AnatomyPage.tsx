import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Spinner } from '@/components/ui';
import { Anatomy3DViewer } from '@/components/features/anatomy/Anatomy3DViewer';
import { SystemToggleBar } from '@/components/features/anatomy/SystemToggleBar';
import { RegionBreadcrumb } from '@/components/features/anatomy/RegionBreadcrumb';
import { AnatomySearchBar } from '@/components/features/anatomy/AnatomySearchBar';
import { StructureInfoPanel } from '@/components/features/anatomy/StructureInfoPanel';
import { IsolationControls } from '@/components/features/anatomy/IsolationControls';
import { seedHeadNeckCatalog } from '@/data/repositories/anatomy';
import { useAnatomyStructures, useAnatomyStructure } from '@/hooks/useAnatomy';
import { useProfile } from '@/hooks/useProfile';
import { db } from '@/data/db';
import type { AnatomyCategory, ID } from '@/types';
import type { ContextLookup } from '@/services/rag/retrieval';

const REGION = 'tete-et-cou';
const DEFAULT_SYSTEMS: Record<AnatomyCategory, boolean> = {
  squelette: true,
  muscles: true,
  nerfs: true,
  vaisseaux: true,
  organes: true,
};

/** Charge chunks + lookup à la demande, seulement une fois qu'une structure est sélectionnée. */
function StructureDetailWrapper({ structureId, onClose }: { structureId: ID; onClose: () => void }) {
  const structure = useAnatomyStructure(structureId);
  const profile = useProfile();
  const data = useLiveQuery(async () => {
    const [chunks, subjects, chapters, documents] = await Promise.all([
      db.chunks.toArray(),
      db.subjects.toArray(),
      db.chapters.toArray(),
      db.documents.toArray(),
    ]);
    const lookup: ContextLookup = {
      subjects: new Map(subjects.map((s) => [s.id, s])),
      chapters: new Map(chapters.map((c) => [c.id, c])),
      documents: new Map(documents.map((d) => [d.id, { id: d.id, name: d.name }])),
    };
    return { chunks, lookup };
  }, []);

  if (structure === undefined || structure === null || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  }

  return (
    <StructureInfoPanel
      structure={structure}
      chunks={data.chunks}
      lookup={data.lookup}
      program={profile.program || 'dentisterie'}
      onClose={onClose}
    />
  );
}

/**
 * Explorateur 3D — voir `src/data/anatomy/SOURCES.md` pour la provenance et
 * la licence des données, et le plan de la Phase 1 pour le périmètre.
 */
export function AnatomyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const reduced = useReducedMotion();

  const structures = useAnatomyStructures(REGION);
  const [activeSystems, setActiveSystems] = useState<Record<AnatomyCategory, boolean>>(DEFAULT_SYSTEMS);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [flyToToken, setFlyToToken] = useState(0);

  useEffect(() => {
    void seedHeadNeckCatalog();
  }, []);

  // Un lien externe (recherche globale, plus tard un renvoi depuis Cours)
  // peut présélectionner une structure via `?structure=` — même mécanique
  // que `?prompt=`/`?subject=` déjà utilisée ailleurs dans l'app.
  useEffect(() => {
    const fromParam = searchParams.get('structure');
    if (fromParam) {
      setSelectedId(fromParam);
      setFlyToToken((t) => t + 1);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedStructure = useMemo(
    () => structures?.find((s) => s.id === selectedId) ?? null,
    [structures, selectedId],
  );

  const selectStructure = (id: ID | null) => {
    setSelectedId(id);
    if (id === null) setIsolated(false);
    else setFlyToToken((t) => t + 1);
  };

  const toggleSystem = (category: AnatomyCategory) => {
    setActiveSystems((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  const showAll = () => setActiveSystems({ squelette: true, muscles: true, nerfs: true, vaisseaux: true, organes: true });
  const hideAll = () => setActiveSystems({ squelette: false, muscles: false, nerfs: false, vaisseaux: false, organes: false });

  const applyPreset = (categories: AnatomyCategory[]) => {
    setActiveSystems({
      squelette: categories.includes('squelette'),
      muscles: categories.includes('muscles'),
      nerfs: categories.includes('nerfs'),
      vaisseaux: categories.includes('vaisseaux'),
      organes: categories.includes('organes'),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div>
          <h1 className="text-[1.15rem] leading-tight">🫀 Anatomie 3D</h1>
          <RegionBreadcrumb
            structureName={selectedStructure?.name ?? null}
            onGoToBody={() => selectStructure(null)}
            onGoToRegion={() => selectStructure(null)}
          />
        </div>
        <div className="w-full max-w-xs sm:w-72">
          <AnatomySearchBar structures={structures ?? []} onSelect={selectStructure} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto border-b border-[var(--line)] p-3 lg:w-64 lg:border-b-0 lg:border-r">
          <div>
            <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">Systèmes</p>
            <SystemToggleBar active={activeSystems} onToggle={toggleSystem} />
          </div>

          <div>
            <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">Combinaisons</p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => applyPreset(['squelette', 'nerfs'])}>
                Squelette + Nerfs
              </Button>
              <Button size="sm" variant="ghost" onClick={() => applyPreset(['muscles', 'vaisseaux'])}>
                Muscles + Vaisseaux
              </Button>
              <Button size="sm" variant="ghost" onClick={showAll}>
                Tout afficher
              </Button>
              <Button size="sm" variant="ghost" onClick={hideAll}>
                Tout masquer
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">Outils</p>
            <IsolationControls
              hasSelection={selectedId !== null}
              isolated={isolated}
              onIsolate={() => setIsolated(true)}
              onRestore={() => setIsolated(false)}
            />
          </div>

          <p className="mt-auto text-[0.72rem] leading-relaxed text-[var(--ink-faint)]">
            Modèle : spécimen unique (données ouvertes BodyParts3D/DBCLS, CC BY-SA) — pas de variante homme/femme distincte disponible aujourd'hui.
          </p>
        </aside>

        {/* `min-w-0` est essentiel : sans lui, un enfant flex contenant un
            <canvas> refuse de rétrécir sous sa taille intrinsèque — le
            panneau d'information se retrouvait poussé hors de l'écran dès
            qu'il apparaissait à côté du viewport 3D. */}
        <div className="relative min-h-[45vh] min-w-0 flex-1 overflow-hidden lg:min-h-0">
          {structures === undefined ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size={22} />
            </div>
          ) : (
            <Anatomy3DViewer
              structures={structures}
              activeSystems={activeSystems}
              selectedId={selectedId}
              isolated={isolated}
              onSelectStructure={selectStructure}
              flyToToken={flyToToken}
              reducedMotion={!!reduced}
            />
          )}
        </div>

        {selectedStructure && (
          <div className="flex min-h-[40vh] shrink-0 flex-col border-t border-[var(--line)] bg-[var(--bg-elevated)] lg:h-full lg:min-h-0 lg:w-96 lg:border-t-0 lg:border-l">
            <StructureDetailWrapper structureId={selectedStructure.id} onClose={() => selectStructure(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
