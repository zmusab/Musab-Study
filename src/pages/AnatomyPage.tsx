import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Spinner } from '@/components/ui';
import { Anatomy3DViewer, type Anatomy3DViewerHandle, type AnatomicalView } from '@/components/features/anatomy/Anatomy3DViewer';
import { SystemToggleBar } from '@/components/features/anatomy/SystemToggleBar';
import { RegionBreadcrumb } from '@/components/features/anatomy/RegionBreadcrumb';
import { AnatomySearchBar } from '@/components/features/anatomy/AnatomySearchBar';
import { StructureInfoPanel } from '@/components/features/anatomy/StructureInfoPanel';
import { RegionExplorerCard } from '@/components/features/anatomy/RegionExplorerCard';
import { IsolationCard } from '@/components/features/anatomy/IsolationCard';
import { CombinationsCard } from '@/components/features/anatomy/CombinationsCard';
import { CourseIntegrationCard } from '@/components/features/anatomy/CourseIntegrationCard';
import { pickRepresentative } from '@/services/anatomy/representative';
import { LearningModeCard } from '@/components/features/anatomy/LearningModeCard';
import { seedBodyCatalog, getAnatomySheet } from '@/data/repositories/anatomy';
import { useAnatomyStructures, useAnatomyStructure } from '@/hooks/useAnatomy';
import { useProfile } from '@/hooks/useProfile';
import {
  structuresInSubregion,
  DEFAULT_LOADED_SUBREGIONS,
  PRIORITY_SUBREGIONS,
} from '@/services/anatomy/regions';
import { pickLearningTarget, evaluateGuess, type LearningResult } from '@/services/anatomy/learning';
import assetManifest from '@/data/anatomy/assetManifest.json';
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

/** Vues anatomiques standard proposées dans le rail (§13). */
const ANATOMICAL_VIEWS: { id: AnatomicalView; label: string; title: string }[] = [
  { id: 'anterieure', label: 'Ant.', title: 'Vue antérieure (de face)' },
  { id: 'posterieure', label: 'Post.', title: 'Vue postérieure (de dos)' },
  { id: 'droite', label: 'Droite', title: 'Vue latérale droite' },
  { id: 'gauche', label: 'Gauche', title: 'Vue latérale gauche' },
  { id: 'superieure', label: 'Sup.', title: 'Vue supérieure (de dessus)' },
  { id: 'inferieure', label: 'Inf.', title: 'Vue inférieure (de dessous)' },
];

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
    <>
      {/*
        Vues anatomiques (§13) regroupées AVEC les contrôles de caméra plutôt
        que dans le rail : elles agissent sur la caméra, leur place est ici.
        Cela libère aussi de la largeur pour le modèle, qui doit rester la
        partie dominante de l'écran.
      */}
      <div className="pointer-events-auto absolute bottom-3 left-3 flex flex-wrap gap-1.5 rounded-full bg-black/45 p-1.5 backdrop-blur">
        {ANATOMICAL_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => viewerRef.current?.setView(view.id)}
            title={view.title}
            aria-label={view.title}
            data-touch-target
            className="rounded-full px-2.5 text-[0.74rem] font-medium text-white/85 transition-colors hover:bg-white/15 hover:text-white"
          >
            {view.label}
          </button>
        ))}
      </div>

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
    </>
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
   * Périmètre de chargement, en DEUX TEMPS.
   *
   * Premier temps : uniquement ce que la caméra cadre à l'ouverture (crâne,
   * face, mâchoire, dents) — 7,1 Mo au lieu de 11,5. Le modèle est
   * manipulable bien plus tôt.
   *
   * Second temps : le contexte (cou, orbite) est demandé dès que le premier
   * lot est arrivé, ou au bout de quelques secondes si le réseau traîne. Rien
   * n'est perdu, tout arrive sans action de l'utilisateur.
   *
   * Ouvrir explicitement une région lourde l'ajoute au périmètre — c'est le
   * seul moment où ses assets sont téléchargés.
   */
  const [contextReady, setContextReady] = useState(false);

  const loadedSubregions = useMemo(() => {
    const base = contextReady ? DEFAULT_LOADED_SUBREGIONS : PRIORITY_SUBREGIONS;
    if (focusedSubregion && !base.includes(focusedSubregion)) return [...base, focusedSubregion];
    return base;
  }, [contextReady, focusedSubregion]);


  /**
   * Structures RÉELLEMENT à l'écran : maillage existant, assets de leur
   * sous-région chargés, système actif. C'est la base commune des points
   * interactifs et du mode apprentissage — sans ce filtre, le jeu demandait
   * des structures absentes de l'écran (un muscle du pied pendant qu'on
   * regarde la tête), introuvables et impossibles à corriger en vert.
   */
  const loadedVisibleStructures = useMemo(
    () =>
      (structures ?? []).filter(
        (s) =>
          s.model3dRef !== null &&
          activeSystems[s.category] === true &&
          loadedSubregions.includes(s.subregion ?? ''),
      ),
    [structures, activeSystems, loadedSubregions],
  );
  const learningCandidates = loadedVisibleStructures;

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

  /*
    Bascule vers le second temps de chargement. DEUX déclencheurs, dans deux
    effets séparés — c'est délibéré : un seul effet dépendant de la
    progression réarmait son minuteur à chaque octet reçu, si bien qu'il
    n'expirait jamais et que le cou n'arrivait qu'au bout de 13 s.
  */
  // (a) Minuteur armé UNE FOIS au montage : le lot de contexte part pendant
  //     que le lot prioritaire finit de s'analyser, sans lui disputer la
  //     bande passante des premières centaines de millisecondes.
  useEffect(() => {
    const timer = window.setTimeout(() => setContextReady(true), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  // (b) Filet de sécurité : si le lot prioritaire est complet avant le
  //     minuteur, inutile d'attendre.
  useEffect(() => {
    if (loadProgress.total > 0 && loadProgress.loaded >= loadProgress.total) setContextReady(true);
  }, [loadProgress]);

  /**
   * Dénominateur de l'indicateur : le nombre de groupes qui SERONT chargés,
   * pas seulement ceux du palier en cours. Sans cela l'indicateur
   * disparaissait entre les deux paliers puis revenait — il annonçait
   * « terminé » alors que 3,7 Mo restaient à venir.
   */
  const intendedGroupCount = useMemo(() => {
    const scope =
      focusedSubregion && !DEFAULT_LOADED_SUBREGIONS.includes(focusedSubregion)
        ? [...DEFAULT_LOADED_SUBREGIONS, focusedSubregion]
        : DEFAULT_LOADED_SUBREGIONS;
    return (assetManifest as { subregion: string; category: AnatomyCategory }[]).filter(
      (group) => scope.includes(group.subregion) && activeSystems[group.category] === true,
    ).length;
  }, [focusedSubregion, activeSystems]);

  const progressTotal = Math.max(loadProgress.total, intendedGroupCount);

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

  /**
   * Structures portant un POINT interactif sur le modèle.
   *
   * Hors apprentissage : toutes les structures réellement chargées et dont le
   * système est actif — le modèle porte donc des points dès l'ouverture, sans
   * qu'il faille d'abord ouvrir une sous-région. Ouvrir une sous-région
   * restreint les points à celle-ci, pour ne pas semer des points sur des
   * structures qu'on ne regarde pas.
   *
   * Pendant l'apprentissage, les points de TOUTES les structures candidates
   * restent affichés (c'est sur eux qu'on répond), mais aucun nom ni aucune
   * correction n'est visible avant la réponse.
   */
  const markerStructureIds = useMemo(() => {
    if (learningActive) return learningCandidates.map((s) => s.id);
    if (focusedSubregion && structures) {
      return structuresInSubregion(structures, focusedSubregion)
        .filter((s) => s.model3dRef !== null)
        .map((s) => s.id);
    }
    return loadedVisibleStructures.map((s) => s.id);
  }, [learningActive, learningCandidates, focusedSubregion, structures, loadedVisibleStructures]);

  /**
   * Citations de la fiche « cours » DÉJÀ générée pour la structure
   * sélectionnée. `undefined` = lecture en cours, `null` = aucune fiche.
   * Rien n'est fabriqué ici : la carte n'affiche que ce que la base contient.
   */
  const selectedCitations = useLiveQuery(async () => {
    if (!selectedId) return null;
    const sheet = await getAnatomySheet(selectedId, 'course');
    return sheet?.citations ?? null;
  }, [selectedId]);

  const showInfoPanel = selectedStructure && !learningActive;

  return (
    /*
      La page DÉFILE. On ne cherche plus à faire tenir le cockpit et les cinq
      cartes dans une hauteur d'écran : le cockpit reçoit une hauteur
      confortable, les cartes descendent en dessous, et l'utilisateur fait
      défiler. Comprimer les cartes les rendait illisibles.
    */
    <div className="flex min-h-full flex-col" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
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
      {/*
        COCKPIT — Systèmes | Modèle 3D | Informations | Recherche (§7).
        Hauteur explicite et généreuse : le modèle reste la partie dominante,
        et chaque colonne défile pour son compte. Sous `lg`, les colonnes
        s'empilent et la page continue simplement vers le bas.
      */}
      <div className="grid shrink-0 grid-cols-2 lg:h-[min(76vh,46rem)] lg:min-h-[34rem] lg:grid-cols-[11rem_minmax(0,1fr)_15rem_14rem] xl:grid-cols-[12rem_minmax(0,1fr)_19rem_17rem]">
        {/* Rail gauche : systèmes et vues. L'exploration par région n'y est
            plus — elle est redevenue une vraie carte, en bas, où elle a la
            place d'afficher un grand schéma. */}
        <aside className="col-span-2 flex min-h-0 shrink-0 flex-col gap-4 overflow-y-auto border-b border-[var(--line)] p-3 lg:col-span-1 lg:border-b-0 lg:border-r">
          <div className="shrink-0">
            <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">Systèmes</p>
            <SystemToggleBar structures={structures ?? []} active={activeSystems} onToggle={toggleSystem} />
          </div>

          <p
            className="mt-auto shrink-0 text-[0.68rem] leading-snug text-[var(--ink-faint)]"
            title="Les données BodyParts3D proviennent d'un spécimen unique : aucune variante homme/femme distincte n'existe dans la source, elle n'est donc pas proposée."
          >
            BodyParts3D/DBCLS — CC BY-SA
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
              {progressTotal > 0 && loadProgress.loaded < progressTotal && (
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[0.75rem] text-white backdrop-blur">
                  <Spinner size={12} />
                  Chargement de l’anatomie… {loadProgress.loaded}/{progressTotal}
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
            /*
              État vide SOIGNÉ (§6/§19) : la colonne ne doit jamais donner
              l'impression qu'une fonctionnalité manque. Elle explique les
              trois façons d'ouvrir une fiche, avec la même hiérarchie
              typographique que la fiche elle-même.
            */
            <div className="flex h-full flex-col p-5">
              <p className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.06em] text-[var(--ink-faint)]">
                Informations
              </p>
              {learningActive ? (
                <p className="text-[0.84rem] leading-relaxed text-[var(--ink-soft)]">
                  Masqué pendant le mode apprentissage — il révélerait la réponse.
                </p>
              ) : (
                <div className="flex flex-1 flex-col justify-center">
                  <svg
                    aria-hidden
                    viewBox="0 0 48 48"
                    className="mb-4 h-11 w-11 text-[var(--ink-faint)] opacity-50"
                    fill="none"
                  >
                    <circle cx="19" cy="19" r="12.5" stroke="currentColor" strokeWidth="2" />
                    <path d="M28.5 28.5 41 41" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="19" cy="19" r="3.2" fill="currentColor" />
                  </svg>
                  <p className="text-[1.02rem] font-semibold leading-tight text-[var(--ink)]">Explore l’anatomie</p>
                  <p className="mt-2 text-[0.84rem] leading-relaxed text-[var(--ink-soft)]">
                    Choisis une structure pour lire sa fiche : nom latin, provenance, passages de tes cours et
                    actions.
                  </p>
                  <ul className="mt-4 flex flex-col gap-2 text-[0.8rem] leading-snug text-[var(--ink-faint)]">
                    <li className="flex gap-2">
                      <span aria-hidden className="mt-[0.42rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      Touche un point sur le modèle
                    </li>
                    <li className="flex gap-2">
                      <span aria-hidden className="mt-[0.42rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      Cherche un nom, un latin ou « dent 36 »
                    </li>
                    <li className="flex gap-2">
                      <span aria-hidden className="mt-[0.42rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      Ouvre une région dans le schéma anatomique
                    </li>
                  </ul>
                </div>
              )}
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
      {/*
        CARTES ANATOMIQUES (§4/§19) — cinq cartes RÉELLES, visibles en même
        temps, sur deux lignes. Volontairement PAS une barre d'onglets : on
        doit comprendre d'un coup d'œil ce que la section propose. Si elles
        ne tiennent pas dans la hauteur restante, la page défile — c'est
        assumé, et préférable à des cartes écrasées.
      */}
      <div
        className="grid grid-cols-1 gap-4 border-t border-[var(--line)] p-4 sm:grid-cols-2 xl:grid-cols-3"
        // `content-visibility` : le navigateur saute la mise en page et le
        // rendu des cartes encore hors écran, sans rien retirer du DOM ni de
        // l'accessibilité. `contain-intrinsic-size` réserve leur place pour
        // que la barre de défilement ne saute pas.
        style={{ contentVisibility: 'auto', containIntrinsicSize: '1px 32rem' }}
      >
        <RegionExplorerCard
          structures={structures ?? []}
          focusedSubregion={focusedSubregion}
          onOpenSubregion={setFocusedSubregion}
          onCloseSubregion={closeSubregion}
          selectedId={selectedId}
          onSelectStructure={selectStructure}
        />

        <IsolationCard
          structure={selectedStructure}
          isolated={isolated}
          onIsolate={() => setIsolated(true)}
          onRestore={() => setIsolated(false)}
          onResetView={resetView}
        />

        <section className="anatomy-card">
          <h2 className="anatomy-card-title">Mode apprentissage</h2>
          <LearningModeCard
            active={learningActive}
            target={learningTarget}
            answered={learningAnswered}
            result={learningResult}
            streak={learningStreak}
            candidateCount={learningCandidates.length}
            onStart={startLearning}
            onStop={stopLearning}
            onNext={nextLearningQuestion}
          />
        </section>

        <CombinationsCard
          combinations={COMBINATIONS}
          allCategories={ALL_CATEGORIES}
          activeSystems={activeSystems}
          samples={systemSamples}
          onApply={applyPreset}
          onHideAll={hideAll}
        />

        <CourseIntegrationCard
          structure={selectedStructure}
          citations={selectedCitations ?? null}
          loading={selectedCitations === undefined && selectedId !== null}
        />
      </div>
    </div>
  );
}
