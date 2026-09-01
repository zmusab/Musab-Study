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
import { StructureThumbnail } from '@/components/features/anatomy/StructureThumbnail';
import { pickRepresentative } from '@/services/anatomy/representative';
import { LearningModeCard } from '@/components/features/anatomy/LearningModeCard';
import { seedBodyCatalog } from '@/data/repositories/anatomy';
import { useAnatomyStructures, useAnatomyStructure } from '@/hooks/useAnatomy';
import { useProfile } from '@/hooks/useProfile';
import { structuresInSubregion, DEFAULT_LOADED_SUBREGIONS } from '@/services/anatomy/regions';
import { pickLearningTarget, evaluateGuess, type LearningResult } from '@/services/anatomy/learning';
import { db } from '@/data/db';
import type { AnatomyCategory, ID } from '@/types';
import type { ContextLookup } from '@/services/rag/retrieval';

const DEFAULT_SYSTEMS: Record<AnatomyCategory, boolean> = {
  squelette: true,
  muscles: true,
  nerfs: true,
  vaisseaux: true,
  organes: true,
};
const ALL_CATEGORIES: AnatomyCategory[] = ['squelette', 'muscles', 'nerfs', 'vaisseaux', 'organes'];

/**
 * Combinaisons proposées (§12) — chacune applique réellement l'état des 5
 * systèmes. La tuile montre les VRAIES vignettes des systèmes combinés
 * (une par système, superposées), donc à quoi la combinaison ressemble
 * vraiment dans le modèle — pas une paire d'emojis.
 */
const COMBINATIONS: { label: string; categories: AnatomyCategory[] }[] = [
  { label: 'Squelette et nerfs', categories: ['squelette', 'nerfs'] },
  { label: 'Muscles et vaisseaux', categories: ['muscles', 'vaisseaux'] },
  { label: 'Squelette seul', categories: ['squelette'] },
  { label: 'Tout afficher', categories: ALL_CATEGORIES },
];

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

  const structures = useAnatomyStructures();
  const [activeSystems, setActiveSystems] = useState<Record<AnatomyCategory, boolean>>(DEFAULT_SYSTEMS);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [flyToToken, setFlyToToken] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusedSubregion, setFocusedSubregion] = useState<string | null>(null);

  const [learningActive, setLearningActive] = useState(false);
  const [learningTargetId, setLearningTargetId] = useState<ID | null>(null);
  const [learningResult, setLearningResult] = useState<LearningResult | null>(null);
  /** Structure réellement cliquée en réponse — sert à la corriger EN ROUGE sur le modèle. */
  const [learningAnsweredId, setLearningAnsweredId] = useState<ID | null>(null);
  const [learningStreak, setLearningStreak] = useState(0);

  useEffect(() => {
    void seedBodyCatalog();
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
  /** Une vignette réelle par système, pour les tuiles de combinaison. */
  const systemSamples = useMemo(() => {
    const map = new Map<AnatomyCategory, ReturnType<typeof pickRepresentative>>();
    for (const category of ALL_CATEGORIES) {
      map.set(category, pickRepresentative(structures ?? [], (s) => s.category === category));
    }
    return map;
  }, [structures]);

  const learningTarget = useMemo(
    () => (learningTargetId ? (structures?.find((s) => s.id === learningTargetId) ?? null) : null),
    [structures, learningTargetId],
  );
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

  /**
   * Structures pouvant être demandées : uniquement celles dont les assets
   * sont RÉELLEMENT chargés et dont le système est actif. Sans ce filtre, le
   * jeu demandait des structures absentes de l'écran (un muscle du pied
   * pendant qu'on regarde la tête) — introuvables, et impossibles à corriger
   * en vert sur le modèle.
   */
  const learningCandidates = useMemo(
    () =>
      (structures ?? []).filter(
        (s) =>
          s.model3dRef !== null &&
          activeSystems[s.category] === true &&
          loadedSubregions.includes(s.subregion ?? ''),
      ),
    [structures, activeSystems, loadedSubregions],
  );

  const learningAnswered = useMemo(
    () => (learningAnsweredId ? (structures?.find((s) => s.id === learningAnsweredId) ?? null) : null),
    [structures, learningAnsweredId],
  );

  const selectStructure = (id: ID | null) => {
    if (learningActive && id !== null && learningTargetId) {
      const result = evaluateGuess(learningTargetId, id);
      setLearningResult(result);
      setLearningAnsweredId(id);
      if (result === 'correct') setLearningStreak((n) => n + 1);
      // Sur une erreur, la caméra va vers LA BONNE structure : c'est elle
      // qu'il faut voir. La structure cliquée reste visible en rouge à côté
      // (cf. `computeVisibility`), ce qui permet de comparer les deux.
      setSelectedId(result === 'correct' ? id : learningTargetId);
      setFlyToToken((t) => t + 1);
      return;
    }
    setSelectedId(id);
    if (id === null) setIsolated(false);
    else setFlyToToken((t) => t + 1);
  };

  const resetView = () => {
    setIsolated(false);
    viewerRef.current?.resetView();
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
    setSelectedId(null);
    setIsolated(false);
    const target = pickLearningTarget(learningCandidates);
    setLearningActive(true);
    setLearningTargetId(target?.id ?? null);
    setLearningResult(null);
    setLearningAnsweredId(null);
    setLearningStreak(0);
  };
  const nextLearningQuestion = () => {
    if (!structures) return;
    const target = pickLearningTarget(learningCandidates, learningTargetId);
    setLearningTargetId(target?.id ?? null);
    setLearningResult(null);
    setLearningAnsweredId(null);
    setSelectedId(null);
  };
  const stopLearning = () => {
    setLearningActive(false);
    setLearningTargetId(null);
    setLearningResult(null);
    setLearningAnsweredId(null);
    setSelectedId(null);
  };


  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const handleLoadProgress = useCallback(
    (loaded: number, total: number) => setLoadProgress({ loaded, total }),
    [],
  );

  /**
   * État d'apprentissage transmis au modèle 3D — `answeredId` reste nul tant
   * qu'aucune réponse n'est donnée, la cible n'est donc jamais révélée avant
   * le clic.
   */
  const learningState = useMemo(
    () =>
      learningActive && learningTargetId
        ? { targetId: learningTargetId, answeredId: learningAnsweredId }
        : null,
    [learningActive, learningTargetId, learningAnsweredId],
  );

  const markerStructureIds = useMemo(() => {
    // Pendant l'apprentissage : aucun marqueur avant la réponse (ils
    // donneraient la solution), puis exactement les deux structures de la
    // correction — la bonne, et celle cliquée si elle diffère.
    if (learningActive) {
      if (!learningState || learningState.answeredId === null) return [];
      const ids = [learningState.targetId];
      if (learningState.answeredId !== learningState.targetId) ids.push(learningState.answeredId);
      return ids;
    }
    if (!focusedSubregion || !structures) return [];
    return structuresInSubregion(structures, focusedSubregion)
      .filter((s) => s.model3dRef !== null)
      .map((s) => s.id);
  }, [learningActive, learningState, focusedSubregion, structures]);

  const showInfoPanel = selectedStructure && !learningActive;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div>
          <h1 className="text-[1.15rem] leading-tight text-[var(--ink)]">Anatomie 3D</h1>
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

      {/* 4 colonnes (§4/§17) : Systèmes → Modèle → Informations → Recherche.
          Le rail de navigation de l'app passe en mode icônes sur cette route,
          ce qui rend ~176 px au contenu et permet de tenir les 4 colonnes sur
          un iPad en paysage sans écraser le modèle. */}
      <div className="grid min-h-0 flex-1 grid-cols-2 lg:grid-cols-[12.5rem_minmax(0,1fr)_15rem_15rem] xl:grid-cols-[14rem_minmax(0,1fr)_19rem_17rem]">
        {/* Rail gauche pleine hauteur : les systèmes, puis le schéma
            anatomique interactif — c'est la colonne qui a la hauteur
            nécessaire pour afficher un corps entier lisible. */}
        <aside className="col-span-2 flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-b border-[var(--line)] p-3 lg:col-span-1 lg:overflow-hidden lg:border-b-0 lg:border-r">
          <div className="shrink-0">
            <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">Systèmes</p>
            <SystemToggleBar structures={structures ?? []} active={activeSystems} onToggle={toggleSystem} />
          </div>
          <div className="min-h-[26rem] flex-1 lg:min-h-0">
            <RegionExplorerCard
              structures={structures ?? []}
              focusedSubregion={focusedSubregion}
              onOpenSubregion={setFocusedSubregion}
              onCloseSubregion={closeSubregion}
              selectedId={selectedId}
              onSelectStructure={selectStructure}
            />
          </div>
          <p
            className="shrink-0 text-[0.64rem] leading-tight text-[var(--ink-faint)]"
            title="Les données BodyParts3D proviennent d'un spécimen unique : aucune variante homme/femme distincte n'existe dans la source, elle n'est donc pas proposée."
          >
            BodyParts3D/DBCLS (CC BY-SA) — spécimen unique.
          </p>
        </aside>

        {/* `min-w-0` est essentiel : sans lui, un enfant grid contenant un
            <canvas> refuse de rétrécir sous sa taille intrinsèque. */}
        <div className="relative col-span-2 min-h-[50vh] min-w-0 overflow-hidden lg:col-span-1 lg:min-h-0">
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
                learning={learningState}
                onSelectStructure={selectStructure}
                flyToToken={flyToToken}
                markerStructureIds={markerStructureIds}
                loadedSubregions={loadedSubregions}
                focusedSubregion={focusedSubregion}
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

        {/* Colonne INFORMATIONS — une vraie colonne du layout, visible en
            même temps que le modèle ET que la recherche (§4). Elle ne
            remplace jamais la recherche et ne recouvre jamais le modèle. */}
        <div className="min-h-[30vh] shrink-0 overflow-hidden border-t border-[var(--line)] lg:h-full lg:min-h-0 lg:border-l lg:border-t-0">
          {showInfoPanel ? (
            <StructureDetailWrapper structureId={selectedStructure!.id} onClose={() => selectStructure(null)} />
          ) : (
            <div className="flex h-full flex-col p-4">
              <p className="mb-2 text-[0.78rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                Informations
              </p>
              <p className="text-[0.82rem] leading-relaxed text-[var(--ink-faint)]">
                {learningActive
                  ? 'Masqué pendant le mode apprentissage — il révélerait la réponse.'
                  : 'Sélectionne une structure dans le modèle, un marqueur, la recherche ou l’exploration par région pour afficher sa fiche.'}
              </p>
            </div>
          )}
        </div>

        {/* Colonne RECHERCHE — permanente, jamais remplacée par le panneau. */}
        <div className="min-h-[30vh] shrink-0 overflow-hidden border-l border-t border-[var(--line)] lg:h-full lg:min-h-0 lg:border-t-0">
          <div className="h-full p-3">
            <AnatomySearchBar structures={structures ?? []} selectedId={selectedId} onSelect={selectStructure} />
          </div>
        </div>
      </div>

      {/* Bande d'outils VOLONTAIREMENT compacte et de hauteur bornée : le
          viewport 3D doit rester la zone dominante de l'écran. Chaque carte
          défile en interne plutôt que de pousser le modèle vers le haut. */}
      <div className="grid shrink-0 grid-cols-1 gap-3 border-t border-[var(--line)] p-3 sm:grid-cols-2 lg:h-[12rem] lg:grid-cols-4">
        {/* Mode isolation (§10) — trois vrais outils de mise en évidence. */}
        <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <StructureThumbnail structure={selectedStructure ?? null} size={30} />
            <p className="min-w-0 flex-1 truncate text-[0.85rem] font-semibold text-[var(--ink)]">Mode isolation</p>
          </div>
          <p className="mb-2 min-h-0 flex-1 overflow-y-auto text-[0.76rem] leading-snug text-[var(--ink-faint)]">
            {isolated && selectedStructure ? (
              <>
                <span className="font-medium text-[var(--ink)]">{selectedStructure.name}</span> isolé — tout le reste est
                masqué.
              </>
            ) : selectedStructure ? (
              <>
                <span className="font-medium text-[var(--ink)]">{selectedStructure.name}</span> sélectionné.
              </>
            ) : (
              'Sélectionne une structure dans le modèle pour l’isoler.'
            )}
          </p>
          <div className="flex shrink-0 flex-col gap-1.5">
            {isolated ? (
              <Button size="sm" variant="secondary" onClick={() => setIsolated(false)}>
                Restaurer
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={!selectedStructure} onClick={() => setIsolated(true)}>
                Isoler la sélection
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="justify-start"
              disabled={!selectedStructure}
              onClick={() => setIsolated(true)}
            >
              Masquer le reste
            </Button>
            <Button size="sm" variant="ghost" className="justify-start" onClick={resetView}>
              Réinitialiser la vue
            </Button>
          </div>
        </div>

        <LearningModeCard
          active={learningActive}
          target={learningTarget}
          answered={learningAnswered}
          result={learningResult}
          streak={learningStreak}
          onStart={startLearning}
          onStop={stopLearning}
          onNext={nextLearningQuestion}
        />

        {/* Combinaisons (§12) — vignettes cliquables qui appliquent réellement
            la combinaison de systèmes, et signalent celle qui est active. */}
        <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-3">
          <p className="mb-1.5 text-[0.85rem] font-semibold text-[var(--ink)]">Combinaisons</p>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-1.5 overflow-y-auto">
            {COMBINATIONS.map((combo) => {
              const active = ALL_CATEGORIES.every((c) => activeSystems[c] === combo.categories.includes(c));
              return (
                <button
                  key={combo.label}
                  type="button"
                  onClick={() => applyPreset(combo.categories)}
                  aria-pressed={active}
                  className={
                    'flex flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border px-1 py-2 text-center transition-colors ' +
                    (active
                      ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
                      : 'border-[var(--line)] hover:bg-[var(--surface-2)]')
                  }
                >
                  <span aria-hidden className="flex items-center justify-center -space-x-1.5">
                    {combo.categories.map((category) => (
                      <StructureThumbnail
                        key={category}
                        structure={systemSamples.get(category) ?? null}
                        size={24}
                        className="ring-1 ring-[var(--surface-1)]"
                      />
                    ))}
                  </span>
                  <span className="text-[0.68rem] leading-tight text-[var(--ink-soft)]">{combo.label}</span>
                </button>
              );
            })}
          </div>
          <Button size="sm" variant="ghost" className="mt-1.5 shrink-0 justify-start" onClick={hideAll}>
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
