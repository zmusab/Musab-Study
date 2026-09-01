import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Spinner } from '@/components/ui';
import { Anatomy3DViewer, type Anatomy3DViewerHandle } from '@/components/features/anatomy/Anatomy3DViewer';
import { SystemToggleBar } from '@/components/features/anatomy/SystemToggleBar';
import { RegionBreadcrumb } from '@/components/features/anatomy/RegionBreadcrumb';
import { AnatomySearchBar } from '@/components/features/anatomy/AnatomySearchBar';
import { StructureInfoPanel } from '@/components/features/anatomy/StructureInfoPanel';
import { RegionExplorerCard } from '@/components/features/anatomy/RegionExplorerCard';
import { LearningModeCard } from '@/components/features/anatomy/LearningModeCard';
import { seedHeadNeckCatalog } from '@/data/repositories/anatomy';
import { useAnatomyStructures, useAnatomyStructure } from '@/hooks/useAnatomy';
import { useProfile } from '@/hooks/useProfile';
import { structuresInSubregion, DEFAULT_LOADED_SUBREGIONS } from '@/services/anatomy/regions';
import { pickLearningTarget, evaluateGuess, type LearningResult } from '@/services/anatomy/learning';
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
const ALL_CATEGORIES: AnatomyCategory[] = ['squelette', 'muscles', 'nerfs', 'vaisseaux', 'organes'];

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

function ViewportControls({ viewerRef, isFullscreen }: { viewerRef: React.RefObject<Anatomy3DViewerHandle | null>; isFullscreen: boolean }) {
  const btn =
    'flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/65';
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col gap-2">
      <button type="button" onClick={() => viewerRef.current?.zoomIn()} aria-label="Zoomer" data-touch-target className={btn}>
        <span aria-hidden className="text-lg leading-none">+</span>
      </button>
      <button type="button" onClick={() => viewerRef.current?.zoomOut()} aria-label="Dézoomer" data-touch-target className={btn}>
        <span aria-hidden className="text-lg leading-none">−</span>
      </button>
      <button type="button" onClick={() => viewerRef.current?.resetView()} aria-label="Revenir à la vue initiale" data-touch-target className={btn}>
        <span aria-hidden>⟲</span>
      </button>
      <button
        type="button"
        onClick={() => viewerRef.current?.toggleFullscreen()}
        aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
        data-touch-target
        className={btn}
      >
        <span aria-hidden>{isFullscreen ? '⤡' : '⤢'}</span>
      </button>
    </div>
  );
}

/**
 * Explorateur 3D — voir `src/data/anatomy/SOURCES.md` pour la provenance et
 * la licence des données, et le plan de la Phase 1 pour le périmètre.
 */
export function AnatomyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const reduced = useReducedMotion();
  const viewerRef = useRef<Anatomy3DViewerHandle>(null);

  const structures = useAnatomyStructures(REGION);
  const [activeSystems, setActiveSystems] = useState<Record<AnatomyCategory, boolean>>(DEFAULT_SYSTEMS);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [flyToToken, setFlyToToken] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusedSubregion, setFocusedSubregion] = useState<string | null>(null);

  const [learningActive, setLearningActive] = useState(false);
  const [learningTargetId, setLearningTargetId] = useState<ID | null>(null);
  const [learningResult, setLearningResult] = useState<LearningResult | null>(null);
  const [learningStreak, setLearningStreak] = useState(0);

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
  const learningTarget = useMemo(
    () => (learningTargetId ? (structures?.find((s) => s.id === learningTargetId) ?? null) : null),
    [structures, learningTargetId],
  );

  const selectStructure = (id: ID | null) => {
    if (learningActive && id !== null && learningTargetId) {
      const result = evaluateGuess(learningTargetId, id);
      setLearningResult(result);
      if (result === 'correct') setLearningStreak((n) => n + 1);
    }
    setSelectedId(id);
    if (id === null) setIsolated(false);
    else setFlyToToken((t) => t + 1);
  };

  const toggleSystem = (category: AnatomyCategory) => {
    setActiveSystems((prev) => ({ ...prev, [category]: !prev[category] }));
  };

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

  // Appelée depuis l'effet ci-dessous, jamais directement comme gestionnaire
  // de clic : `focusedSubregion` est déjà à `subregionId` à ce moment (c'est
  // ce changement d'état qui a déclenché l'effet).
  const openSubregion = (subregionId: string) => {
    setSelectedId(null);
    setIsolated(false);
    if (!structures) return undefined;
    const inRegion = structuresInSubregion(structures, subregionId);
    const neededCategories = new Set(inRegion.map((s) => s.category));
    setActiveSystems((prev) => {
      const next = { ...prev };
      for (const category of neededCategories) next[category] = true;
      return next;
    });
    const meshIds = inRegion.filter((s) => s.model3dRef !== null).map((s) => s.id);
    // Les systèmes tout juste activés chargent leur .glb de façon
    // asynchrone : plusieurs tentatives échelonnées plutôt qu'un délai fixe
    // unique, pour cadrer correctement même au premier chargement.
    const timers = [200, 800, 1600].map((delay) => window.setTimeout(() => viewerRef.current?.flyToStructures(meshIds), delay));
    return () => timers.forEach(window.clearTimeout);
  };

  useEffect(() => {
    if (!focusedSubregion || !structures) return undefined;
    return openSubregion(focusedSubregion);
    // Ne réagit qu'au changement de sous-région, pas à chaque évolution de `structures`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedSubregion, structures !== undefined]);

  const closeSubregion = () => {
    setFocusedSubregion(null);
    setSelectedId(null);
    setIsolated(false);
    viewerRef.current?.resetView();
  };

  const startLearning = () => {
    if (!structures) return;
    setFocusedSubregion(null);
    setSelectedId(null);
    setIsolated(false);
    const candidates = structures.filter((s) => activeSystems[s.category] === true);
    const target = pickLearningTarget(candidates);
    setLearningActive(true);
    setLearningTargetId(target?.id ?? null);
    setLearningResult(null);
    setLearningStreak(0);
  };
  const nextLearningQuestion = () => {
    if (!structures) return;
    const candidates = structures.filter((s) => activeSystems[s.category] === true);
    const target = pickLearningTarget(candidates, learningTargetId);
    setLearningTargetId(target?.id ?? null);
    setLearningResult(null);
    setSelectedId(null);
  };
  const stopLearning = () => {
    setLearningActive(false);
    setLearningTargetId(null);
    setLearningResult(null);
    setSelectedId(null);
  };

  /**
   * Périmètre de chargement (§ chargement progressif) : par défaut toutes les
   * régions sauf celles marquées `lazy` (l'encéphale, 1,4 M triangles à lui
   * seul). Ouvrir explicitement une région lourde l'ajoute au périmètre —
   * c'est le seul moment où ses assets sont téléchargés.
   */
  const loadedSubregions = useMemo(() => {
    if (focusedSubregion) {
      return DEFAULT_LOADED_SUBREGIONS.includes(focusedSubregion)
        ? DEFAULT_LOADED_SUBREGIONS
        : [...DEFAULT_LOADED_SUBREGIONS, focusedSubregion];
    }
    return DEFAULT_LOADED_SUBREGIONS;
  }, [focusedSubregion]);

  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const handleLoadProgress = useCallback(
    (loaded: number, total: number) => setLoadProgress({ loaded, total }),
    [],
  );

  const markerStructureIds = useMemo(() => {
    if (learningActive || !focusedSubregion || !structures) return [];
    return structuresInSubregion(structures, focusedSubregion)
      .filter((s) => s.model3dRef !== null)
      .map((s) => s.id);
  }, [learningActive, focusedSubregion, structures]);

  const showInfoPanel = selectedStructure && !learningActive;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div>
          <h1 className="text-[1.15rem] leading-tight text-[var(--ink)]">🫀 Anatomie 3D</h1>
          <RegionBreadcrumb
            subregionId={focusedSubregion}
            structureName={selectedStructure?.name ?? null}
            onGoToBody={() => {
              closeSubregion();
              selectStructure(null);
            }}
            onGoToRegion={closeSubregion}
            onGoToSubregion={() => selectStructure(null)}
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[13rem_1fr_minmax(17rem,22%)]">
        <aside className="flex shrink-0 flex-col gap-4 overflow-y-auto border-b border-[var(--line)] p-3 lg:border-b-0 lg:border-r">
          <div>
            <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">Systèmes</p>
            <SystemToggleBar active={activeSystems} onToggle={toggleSystem} />
          </div>
          <p className="mt-auto text-[0.7rem] leading-relaxed text-[var(--ink-faint)]">
            Modèle : spécimen unique (données ouvertes BodyParts3D/DBCLS, CC BY-SA) — pas de variante homme/femme distincte disponible aujourd'hui.
          </p>
        </aside>

        {/* `min-w-0` est essentiel : sans lui, un enfant grid contenant un
            <canvas> refuse de rétrécir sous sa taille intrinsèque. */}
        <div className="relative min-h-[45vh] min-w-0 overflow-hidden lg:min-h-0">
          {structures === undefined ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size={22} />
            </div>
          ) : (
            <>
              <Anatomy3DViewer
                ref={viewerRef}
                structures={structures}
                activeSystems={activeSystems}
                selectedId={selectedId}
                isolated={isolated}
                onSelectStructure={selectStructure}
                flyToToken={flyToToken}
                markerStructureIds={markerStructureIds}
                loadedSubregions={loadedSubregions}
                reducedMotion={!!reduced}
                onFullscreenChange={setIsFullscreen}
                onLoadProgress={handleLoadProgress}
              />
              <ViewportControls viewerRef={viewerRef} isFullscreen={isFullscreen} />
              {loadProgress.total > 0 && loadProgress.loaded < loadProgress.total && (
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[0.75rem] text-white backdrop-blur">
                  <Spinner size={12} />
                  Chargement de l’anatomie… {loadProgress.loaded}/{loadProgress.total}
                </div>
              )}
              {learningActive && (
                <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/55 px-4 py-1.5 text-[0.82rem] font-medium text-white backdrop-blur">
                  {learningTarget ? <>Trouve : <span className="font-semibold">{learningTarget.name}</span></> : 'Aucune structure disponible'}
                </div>
              )}
            </>
          )}
        </div>

        <div className="min-h-[40vh] shrink-0 overflow-hidden border-t border-[var(--line)] lg:h-full lg:min-h-0 lg:border-t-0 lg:border-l">
          {showInfoPanel ? (
            <StructureDetailWrapper structureId={selectedStructure!.id} onClose={() => selectStructure(null)} />
          ) : (
            <div className="h-full p-3">
              <AnatomySearchBar structures={structures ?? []} selectedId={selectedId} onSelect={selectStructure} />
            </div>
          )}
        </div>
      </div>

      {/* Bande d'outils VOLONTAIREMENT compacte et de hauteur bornée : le
          viewport 3D doit rester la zone dominante de l'écran. Chaque carte
          défile en interne plutôt que de pousser le modèle vers le haut. */}
      <div className="grid shrink-0 grid-cols-1 gap-3 border-t border-[var(--line)] p-3 sm:grid-cols-2 lg:h-[13.5rem] lg:grid-cols-5">
        <RegionExplorerCard
          structures={structures ?? []}
          focusedSubregion={focusedSubregion}
          onOpenSubregion={setFocusedSubregion}
          onCloseSubregion={closeSubregion}
          selectedId={selectedId}
          onSelectStructure={selectStructure}
        />

        <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-3">
          <p className="mb-2 text-[0.85rem] font-semibold text-[var(--ink)]">Mode isolation</p>
          {isolated && selectedStructure ? (
            <>
              <p className="min-h-0 flex-1 overflow-y-auto text-[0.82rem] leading-relaxed text-[var(--ink)]">
                <span className="font-medium">{selectedStructure.name}</span> isolé — tout le reste est masqué.
              </p>
              <Button size="sm" variant="secondary" onClick={() => setIsolated(false)}>
                Restaurer
              </Button>
            </>
          ) : (
            <>
              <p className="min-h-0 flex-1 overflow-y-auto text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
                Sélectionne une structure dans le modèle, puis isole-la pour la voir seule.
              </p>
              <Button size="sm" variant="secondary" disabled={!selectedStructure} onClick={() => setIsolated(true)}>
                Isoler la sélection
              </Button>
            </>
          )}
        </div>

        <LearningModeCard
          active={learningActive}
          target={learningTarget}
          result={learningResult}
          streak={learningStreak}
          onStart={startLearning}
          onStop={stopLearning}
          onNext={nextLearningQuestion}
        />

        <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-3">
          <p className="mb-2 text-[0.85rem] font-semibold text-[var(--ink)]">Combinaisons</p>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            <Button size="sm" variant="ghost" className="justify-start" onClick={() => applyPreset(['squelette', 'nerfs'])}>
              🦴 + 🧠 Squelette et nerfs
            </Button>
            <Button size="sm" variant="ghost" className="justify-start" onClick={() => applyPreset(['muscles', 'vaisseaux'])}>
              💪 + 🩸 Muscles et vaisseaux
            </Button>
            <Button size="sm" variant="ghost" className="justify-start" onClick={() => applyPreset(ALL_CATEGORIES)}>
              Tout afficher
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="justify-start" onClick={hideAll}>
            Tout masquer
          </Button>
        </div>

        <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-3">
          <p className="mb-2 text-[0.85rem] font-semibold text-[var(--ink)]">Intégration cours</p>
          <p className="min-h-0 flex-1 overflow-y-auto text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
            Toutes les informations affichées viennent de tes cours importés, avec la page source cliquable — jamais
            inventées.
          </p>
          <Link to="/cours">
            <Button size="sm" variant="ghost" className="justify-start">
              Voir mes cours →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
