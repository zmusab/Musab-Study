import {
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useCallback,
  forwardRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { computeVisibility, type SystemVisibility } from '@/services/anatomy/visibility';
import assetManifest from '@/data/anatomy/assetManifest.json';
import { layoutMarkers, type MarkerAnchor } from '@/services/anatomy/markerLayout';
import type { AnatomyCategory, AnatomyStructure, ID } from '@/types';

/**
 * Le moteur 3D — la seule partie du fichier qui connaît Three.js. Tout le
 * reste de la fonctionnalité Anatomie (recherche, panneau info, IA,
 * flashcards) ne dépend que de `structureId`/`AnatomyStructure`, jamais de
 * Three.js directement : remplacer ce composant par un autre moteur plus
 * tard n'affecterait aucun autre fichier.
 *
 * Un fichier `.glb` par couple (sous-région, système) — voir
 * `public/anatomy/`, généré par `scripts/anatomy/convert-headneck.mjs`
 * depuis des données réelles BodyParts3D (voir `src/data/anatomy/SOURCES.md`).
 * Un groupe n'est téléchargé qu'au premier moment où sa région est dans le
 * périmètre ET son système actif, puis jamais retéléchargé (`useGLTF` met en
 * cache par URL).
 *
 * C'est ce chargement sélectif — et non une réduction du nombre de triangles —
 * qui tient le budget de performance : la géométrie source est conservée
 * intégralement (4,29 M triangles sur 267 structures).
 */

/**
 * Groupes d'assets réellement produits par le pipeline — un fichier par
 * couple (sous-région, système). Le manifeste est GÉNÉRÉ par
 * `scripts/anatomy/convert-headneck.mjs` : le client ne devine jamais un nom
 * de fichier, il ne demande que des groupes dont l'existence est attestée.
 */
interface AssetGroup {
  key: string;
  subregion: string;
  category: AnatomyCategory;
  structures: number;
  triangles: number;
}
const ASSET_GROUPS = assetManifest as AssetGroup[];
const assetUrl = (key: string) => `/anatomy/${key}.glb`;

/** Au-delà, les étiquettes secondaires sont masquées et comptées (§8). */
const DEFAULT_MAX_LABELS = 8;

export interface Anatomy3DViewerHandle {
  /** Cadre la caméra sur la boîte englobante réelle des structures données (sous-région, résultat de recherche). */
  flyToStructures: (ids: ID[]) => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  toggleFullscreen: () => void;
}

export interface Anatomy3DViewerProps {
  structures: AnatomyStructure[];
  activeSystems: SystemVisibility;
  selectedId: ID | null;
  isolated: boolean;
  onSelectStructure: (id: ID | null) => void;
  /** Incrémenté à chaque fois qu'un vol de caméra vers `selectedId` est demandé (recherche, marqueur, fil d'Ariane). */
  flyToToken: number;
  /** Structures dont le point interactif doit être affiché (sous-région actuellement ouverte) — vide = aucun marqueur. */
  markerStructureIds: ID[];
  /**
   * Sous-régions dont les assets doivent être chargés. Seuls les fichiers
   * correspondant à ces régions ET à un système actif sont téléchargés —
   * c'est le levier de performance, à la place de toute simplification.
   */
  loadedSubregions: readonly string[];
  reducedMotion: boolean;
  onFullscreenChange?: (isFullscreen: boolean) => void;
  /** Signale la progression du chargement des groupes d'assets. */
  onLoadProgress?: (loaded: number, total: number) => void;
}

/** Un système chargé : applique la visibilité calculée à chaque maillage nommé, matériaux clonés (jamais partagés entre structures). */
function SystemModel({
  url,
  category,
  structuresById,
  activeSystems,
  selectedId,
  isolated,
  onSelectStructure,
  onHover,
  registerMesh,
}: {
  url: string;
  category: AnatomyCategory;
  structuresById: Map<ID, AnatomyStructure>;
  activeSystems: SystemVisibility;
  selectedId: ID | null;
  isolated: boolean;
  onSelectStructure: (id: ID | null) => void;
  onHover: (id: ID | null) => void;
  registerMesh: (id: ID, object: THREE.Object3D) => void;
}) {
  const { scene } = useGLTF(url);

  // Clone la scène ET chaque matériau : les structures d'un même système
  // partagent quelques matériaux (une couleur par catégorie/type de
  // vaisseau) dans le fichier exporté — sans clonage, changer l'opacité
  // d'UNE structure changerait celle de toutes les autres qui partagent le
  // même matériau.
  const cloned = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = (child.material as THREE.Material).clone();
        (child.material as THREE.MeshStandardMaterial).transparent = true;
      }
    });
    return clone;
  }, [scene]);

  useEffect(() => {
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name) registerMesh(child.name, child);
    });
  }, [cloned, registerMesh]);

  useEffect(() => {
    cloned.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.name) return;
      const structure = structuresById.get(child.name);
      if (!structure) return;
      const visual = computeVisibility(structure, { activeSystems, selectedId, isolated });
      child.visible = visual.opacity > 0.001;
      const material = child.material as THREE.MeshStandardMaterial;
      material.opacity = visual.opacity;
      material.depthWrite = visual.opacity > 0.6;
      material.emissive = visual.highlighted ? new THREE.Color('#ffd166') : new THREE.Color('#000000');
      material.emissiveIntensity = visual.highlighted ? 0.35 : 0;
    });
  }, [cloned, structuresById, activeSystems, selectedId, isolated]);

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      const name = event.object.name;
      if (name && structuresById.has(name)) onSelectStructure(name);
    },
    [structuresById, onSelectStructure],
  );

  const handlePointerOver = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const name = event.object.name;
      if (name && structuresById.has(name)) {
        onHover(name);
        document.body.style.cursor = 'pointer';
      }
    },
    [structuresById, onHover],
  );
  const handlePointerOut = useCallback(() => {
    onHover(null);
    document.body.style.cursor = 'auto';
  }, [onHover]);

  if (activeSystems[category] !== true) return null;
  return (
    <primitive
      object={cloned}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    />
  );
}

/**
 * En mode `demand`, rien n'est redessiné tant que personne ne le demande :
 * ce composant redemande une image à chaque changement d'état qui modifie
 * l'apparence de la scène (visibilité, sélection, arrivée d'un groupe
 * d'assets). Les mouvements de caméra, eux, invalident déjà d'eux-mêmes.
 */
function Invalidator({ deps }: { deps: unknown[] }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
    // Deux images : la seconde laisse le temps aux effets de visibilité de
    // s'appliquer sur les maillages avant le rendu définitif.
    const id = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return null;
}

/** Corrige l'axe vertical des données BodyParts3D (Z-haut) vers la convention Three.js (Y-haut). */
function AxisCorrection({ children }: { children: ReactNode }) {
  return <group rotation={[-Math.PI / 2, 0, 0]}>{children}</group>;
}

/** Tonemapping filmique — passé en propriété de rendu directement plutôt que via `gl={...}` du Canvas, dont le passage de ces propriétés au renderer WebGL sous-jacent n'est pas garanti selon la version. */
function ToneMapping() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.15;
  }, [gl]);
  return null;
}

/** Ancre d'un marqueur : position MONDE réelle du maillage + taille apparente. */
interface MarkerAnchorWorld {
  id: ID;
  world: THREE.Vector3;
  radius: number;
}

/**
 * Projection des ancres vers l'écran (§8), À L'INTÉRIEUR du Canvas.
 *
 * Ce composant ne rend RIEN : il calcule à chaque image la position écran de
 * chaque ancre, délègue le placement à `layoutMarkers` (fonction pure testée
 * à part) puis écrit DIRECTEMENT dans le DOM de la couche d'étiquettes via
 * des refs. Passer par un `setState` à 60 Hz re-rendrait tout l'arbre React à
 * chaque image.
 *
 * Les étiquettes elles-mêmes sont rendues HORS du Canvas (`MarkerOverlay`) :
 * `<Html fullscreen>` de drei applique sa propre transformation au conteneur,
 * dont l'origine ne coïncide pas avec le coin haut-gauche du canevas — les
 * étiquettes se retrouvaient positionnées hors du cadre visible.
 */
function MarkerProjector({
  anchors,
  labelRefs,
  lineRefs,
  selectedId,
  showAll,
  onHiddenCountChange,
}: {
  anchors: MarkerAnchorWorld[];
  labelRefs: RefObject<Map<ID, HTMLButtonElement>>;
  lineRefs: RefObject<Map<ID, SVGPathElement>>;
  selectedId: ID | null;
  showAll: boolean;
  onHiddenCountChange: (n: number) => void;
}) {
  const { camera, size } = useThree();
  const lastHidden = useRef(-1);
  const scratch = useRef(new THREE.Vector3());

  useFrame(() => {
    if (anchors.length === 0) return;

    const screenAnchors: MarkerAnchor[] = anchors.map(({ id, world, radius }) => {
      scratch.current.copy(world).project(camera);
      const x = (scratch.current.x * 0.5 + 0.5) * size.width;
      const y = (-scratch.current.y * 0.5 + 0.5) * size.height;
      return {
        id,
        x,
        y,
        onScreen: scratch.current.z < 1 && x > -40 && x < size.width + 40 && y > -40 && y < size.height + 40,
        // Priorité = taille apparente : les grosses structures portent le
        // repérage, les petites cèdent la place quand ça se bouscule.
        priority: radius,
      };
    });

    const { placed, hiddenIds } = layoutMarkers(screenAnchors, {
      width: size.width,
      height: size.height,
      maxLabels: showAll ? screenAnchors.length : DEFAULT_MAX_LABELS,
      // 48 px > 44 px de hauteur d'étiquette (cible tactile) : en dessous,
      // deux étiquettes voisines se recouvriraient.
      spacing: 48,
      pinnedId: selectedId,
    });

    if (hiddenIds.length !== lastHidden.current) {
      lastHidden.current = hiddenIds.length;
      onHiddenCountChange(hiddenIds.length);
    }

    const placedIds = new Set(placed.map((p) => p.id));
    for (const [id, el] of labelRefs.current) if (!placedIds.has(id)) el.style.display = 'none';
    for (const [id, el] of lineRefs.current) if (!placedIds.has(id)) el.style.display = 'none';

    for (const p of placed) {
      const label = labelRefs.current.get(p.id);
      if (label) {
        label.style.display = '';
        // Côté droit : l'étiquette est ancrée par son bord droit pour rester
        // collée à la marge.
        label.style.transform =
          p.side === 'left'
            ? `translate(${p.labelX}px, ${p.labelY}px) translate(0, -50%)`
            : `translate(${p.labelX}px, ${p.labelY}px) translate(-100%, -50%)`;
      }
      const line = lineRefs.current.get(p.id);
      if (line) {
        line.style.display = '';
        // Coude horizontal court près de l'étiquette, puis segment direct
        // vers la structure : lisible et sans croisement inutile.
        const elbowX = p.side === 'left' ? p.labelX + 10 : p.labelX - 10;
        line.setAttribute('d', `M ${elbowX} ${p.labelY} L ${(elbowX + p.anchorX) / 2} ${p.labelY} L ${p.anchorX} ${p.anchorY}`);
      }
    }
  });

  return null;
}

/** Couche DOM des étiquettes + lignes de rappel, superposée au canevas. */
function MarkerOverlay({
  anchors,
  structuresById,
  selectedId,
  onSelectStructure,
  labelRefs,
  lineRefs,
}: {
  anchors: MarkerAnchorWorld[];
  structuresById: Map<ID, AnatomyStructure>;
  selectedId: ID | null;
  onSelectStructure: (id: ID) => void;
  labelRefs: RefObject<Map<ID, HTMLButtonElement>>;
  lineRefs: RefObject<Map<ID, SVGPathElement>>;
}) {
  if (anchors.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {anchors.map(({ id }) => (
          <path
            key={id}
            ref={(el) => {
              if (el) lineRefs.current.set(id, el);
              else lineRefs.current.delete(id);
            }}
            fill="none"
            stroke={id === selectedId ? 'var(--accent)' : 'rgba(255,255,255,0.32)'}
            strokeWidth={id === selectedId ? 1.6 : 1}
            style={{ display: 'none' }}
          />
        ))}
      </svg>
      {anchors.map(({ id }) => {
        const structure = structuresById.get(id);
        if (!structure) return null;
        const isSelected = selectedId === id;
        return (
          <button
            key={id}
            type="button"
            ref={(el) => {
              if (el) labelRefs.current.set(id, el);
              else labelRefs.current.delete(id);
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelectStructure(id);
            }}
            aria-label={structure.name}
            data-touch-target
            style={{ position: 'absolute', top: 0, left: 0, display: 'none', pointerEvents: 'auto' }}
            className={
              'flex max-w-[9rem] items-center gap-1.5 rounded-full border px-2 py-1 text-[0.7rem] font-medium leading-tight shadow-lg backdrop-blur transition-colors duration-150 ' +
              (isSelected
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-white/30 bg-black/60 text-white hover:border-[var(--accent)]')
            }
          >
            <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (isSelected ? 'bg-white' : 'bg-[var(--accent)]')} />
            <span className="truncate">{structure.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function CameraRig({
  controlsRef,
  meshRegistry,
  selectedId,
  flyToToken,
  reducedMotion,
  hasFramed,
  setHasFramed,
  framingIds,
}: {
  controlsRef: RefObject<CameraControls | null>;
  meshRegistry: RefObject<Map<ID, THREE.Object3D>>;
  selectedId: ID | null;
  flyToToken: number;
  reducedMotion: boolean;
  hasFramed: boolean;
  setHasFramed: (v: boolean) => void;
  framingIds: ID[];
}) {
  const { scene, invalidate } = useThree();

  // En mode `demand`, aucune image n'est produite spontanément : tant que le
  // cadrage initial n'a pas pu se faire (les .glb arrivent de façon
  // asynchrone), on redemande une image régulièrement. La boucle s'arrête
  // d'elle-même dès que le cadrage a réussi — elle ne tourne donc que
  // pendant le chargement, pas pendant l'utilisation.
  useEffect(() => {
    if (hasFramed) return undefined;
    const id = window.setInterval(invalidate, 120);
    return () => window.clearInterval(id);
  }, [hasFramed, invalidate]);

  // Premier cadrage automatique une fois que la scène a du contenu réel —
  // pas de position de caméra codée en dur : elle s'adapte à la bounding
  // box réelle des maillages chargés. `useFrame` plutôt que `useEffect` :
  // les maillages arrivent via `useGLTF`/Suspense, profond dans un autre
  // sous-arbre — sa résolution ne relance pas le rendu de CE composant
  // (sibling hors du Suspense), alors que la boucle de rendu r3f, elle,
  // continue de tourner et voit la scène se remplir dès qu'elle a du contenu.
  useFrame(() => {
    if (hasFramed || !controlsRef.current) return;

    // Cadrage initial sur les structures de CADRAGE (crâne, face, mâchoire,
    // dents) plutôt que sur la boîte englobante de toute la scène : la
    // trachée et l'œsophage descendent bien plus bas que la tête et
    // rétréciraient la zone réellement intéressante. On retombe sur la
    // scène entière tant qu'aucune structure de référence n'est chargée.
    const framingBox = new THREE.Box3();
    let framingCount = 0;
    for (const id of framingIds) {
      const object = meshRegistry.current.get(id);
      if (!object || !object.visible) continue;
      framingBox.expandByObject(object);
      framingCount++;
    }
    const box = framingCount > 0 && !framingBox.isEmpty()
      ? framingBox
      : new THREE.Box3().setFromObject(scene);
    if (!Number.isFinite(box.min.x) || box.isEmpty()) return;

    void controlsRef.current.fitToBox(box, false, { paddingLeft: 0.08, paddingRight: 0.08, paddingTop: 0.08, paddingBottom: 0.08 });
    setHasFramed(true);
  });

  useEffect(() => {
    if (!selectedId || !controlsRef.current) return;
    const object = meshRegistry.current.get(selectedId);
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    // On élargit la boîte autour de son centre avant de cadrer : coller au
    // plus près de la structure la fait remplir tout le viewport et fait
    // perdre le repère anatomique (on ne sait plus OÙ elle se trouve). Un
    // facteur constant garde la structure dominante tout en laissant voir ce
    // qui l'entoure.
    const CONTEXT_FACTOR = 2.2;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(CONTEXT_FACTOR / 2);
    const framed = new THREE.Box3(center.clone().sub(size), center.clone().add(size));

    void controlsRef.current.fitToBox(framed, !reducedMotion, {
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToToken]);

  return null;
}

export const Anatomy3DViewer = forwardRef<Anatomy3DViewerHandle, Anatomy3DViewerProps>(function Anatomy3DViewer(
  {
    structures,
    activeSystems,
    selectedId,
    isolated,
    onSelectStructure,
    flyToToken,
    markerStructureIds,
    loadedSubregions,
    reducedMotion,
    onFullscreenChange,
    onLoadProgress,
  },
  forwardedRef,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<CameraControls | null>(null);
  const meshRegistry = useRef<Map<ID, THREE.Object3D>>(new Map());
  const [hasFramed, setHasFramed] = useState(false);
  const [everLoaded, setEverLoaded] = useState<Set<string>>(new Set());
  const [registryVersion, setRegistryVersion] = useState(0);
  const [hoveredId, setHoveredId] = useState<ID | null>(null);
  // Étiquettes secondaires masquées quand la région est dense (§8) : on
  // compte celles qui n'ont pas pu être placées pour proposer de les révéler.
  const [showAllMarkers, setShowAllMarkers] = useState(false);
  const [hiddenMarkerCount, setHiddenMarkerCount] = useState(0);
  const labelRefs = useRef<Map<ID, HTMLButtonElement>>(new Map());
  const lineRefs = useRef<Map<ID, SVGPathElement>>(new Map());

  const structuresById = useMemo(() => new Map(structures.map((s) => [s.id, s])), [structures]);

  // Structures servant de repère au cadrage initial : la tête proprement
  // dite. Sans cela, la trachée et l'œsophage — bien réels et conservés —
  // étireraient la boîte englobante vers le bas et afficheraient un crâne
  // minuscule à l'ouverture.
  // Ancres MONDE des marqueurs : centre réel de la boîte englobante de chaque
  // maillage chargé, jamais une coordonnée inventée.
  const markerAnchors = useMemo<MarkerAnchorWorld[]>(() => {
    const box = new THREE.Box3();
    const out: MarkerAnchorWorld[] = [];
    for (const id of markerStructureIds) {
      const object = meshRegistry.current.get(id);
      if (!object || !object.visible) continue;
      box.setFromObject(object);
      if (box.isEmpty()) continue;
      out.push({
        id,
        world: box.getCenter(new THREE.Vector3()),
        radius: box.getSize(new THREE.Vector3()).length(),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerStructureIds, registryVersion]);

  const framingIds = useMemo(
    () => structures.filter((s) => ['crane', 'face', 'machoire', 'dents'].includes(s.subregion ?? '')).map((s) => s.id),
    [structures],
  );

  // Un groupe déjà téléchargé reste monté même si son système est désactivé :
  // `useGLTF` met en cache par URL, le re-cocher est donc instantané, et la
  // visibilité par structure suffit à le masquer. On ne télécharge en
  // revanche jamais un groupe qui n'a pas été demandé au moins une fois.
  useEffect(() => {
    setEverLoaded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const group of ASSET_GROUPS) {
        if (!loadedSubregions.includes(group.subregion)) continue;
        if (activeSystems[group.category] !== true) continue;
        if (!next.has(group.key)) {
          next.add(group.key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeSystems, loadedSubregions]);

  const groupsToLoad = useMemo(() => ASSET_GROUPS.filter((g) => everLoaded.has(g.key)), [everLoaded]);

  useEffect(() => {
    if (!onLoadProgress) return;
    const wanted = ASSET_GROUPS.filter(
      (g) => loadedSubregions.includes(g.subregion) && activeSystems[g.category] === true,
    ).length;
    onLoadProgress(groupsToLoad.length, wanted);
  }, [groupsToLoad, loadedSubregions, activeSystems, onLoadProgress]);

  const registerMesh = useCallback((id: ID, object: THREE.Object3D) => {
    meshRegistry.current.set(id, object);
    setRegistryVersion((v) => v + 1);
  }, []);

  const resetView = useCallback(() => {
    setHasFramed(false);
    void controlsRef.current?.reset(!reducedMotion);
  }, [reducedMotion]);

  useImperativeHandle(
    forwardedRef,
    (): Anatomy3DViewerHandle => ({
      flyToStructures: (ids) => {
        if (!controlsRef.current) return;
        const box = new THREE.Box3();
        let found = false;
        for (const id of ids) {
          const object = meshRegistry.current.get(id);
          if (!object) continue;
          box.union(new THREE.Box3().setFromObject(object));
          found = true;
        }
        if (!found || box.isEmpty()) return;
        void controlsRef.current.fitToBox(box, !reducedMotion, {
          paddingLeft: 0.4,
          paddingRight: 0.4,
          paddingTop: 0.4,
          paddingBottom: 0.4,
        });
      },
      resetView,
      zoomIn: () => void controlsRef.current?.dolly(40, !reducedMotion),
      zoomOut: () => void controlsRef.current?.dolly(-40, !reducedMotion),
      toggleFullscreen: () => {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          void wrapperRef.current?.requestFullscreen();
        }
      },
    }),
    [resetView, reducedMotion],
  );

  useEffect(() => {
    const onChange = () => onFullscreenChange?.(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [onFullscreenChange]);

  const hoveredStructure = hoveredId ? structuresById.get(hoveredId) : null;

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #182338 0%, #0a0f1c 70%, #05070d 100%)' }}
    >
      {/* `frameloop="demand"` : la scène est STATIQUE tant que l'utilisateur
          n'interagit pas. Rendre 4,3 M de triangles 60 fois par seconde pour
          une image identique saturait le thread principal (FPS mesuré à 0) ;
          on ne redessine donc que sur invalidation explicite — déplacement de
          caméra, changement de sélection, de visibilité ou de chargement.
          C'est la contrepartie du choix de conserver toute la géométrie. */}
      <Canvas
        frameloop="demand"
        camera={{ fov: 45, near: 1, far: 5000 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => onSelectStructure(null)}
      >
        <Invalidator deps={[activeSystems, selectedId, isolated, groupsToLoad.length, markerStructureIds]} />
        <ToneMapping />
        {/* Éclairage à trois points : chaude en clé (avant-haut), froide en
            remplissage (côté opposé) et une lumière de contour derrière pour
            détacher les structures du fond, plutôt qu'un ambiant plat. */}
        <ambientLight intensity={0.32} />
        <directionalLight position={[350, 500, 450]} intensity={1.4} color="#fff4e6" />
        <directionalLight position={[-450, 150, -200]} intensity={0.55} color="#a9c7ff" />
        <directionalLight position={[0, 300, -600]} intensity={0.9} color="#6fa8ff" />
        <CameraControls ref={controlsRef} smoothTime={reducedMotion ? 0 : 0.35} dollyToCursor={false} />
        <AxisCorrection>
          {/* Un <Suspense> PAR groupe : chaque fichier apparaît dès qu'il est
              prêt, au lieu d'attendre que tous les groupes soient téléchargés
              — c'est ce qui rend le chargement réellement progressif. */}
          {groupsToLoad.map((group) => (
            <Suspense key={group.key} fallback={null}>
              <SystemModel
                url={assetUrl(group.key)}
                category={group.category}
                structuresById={structuresById}
                activeSystems={activeSystems}
                selectedId={selectedId}
                isolated={isolated}
                onSelectStructure={onSelectStructure}
                onHover={setHoveredId}
                registerMesh={registerMesh}
              />
            </Suspense>
          ))}
        </AxisCorrection>
        {/* Hors du groupe `AxisCorrection` : `Markers` calcule déjà des
            positions MONDE (`Box3.setFromObject`, post-correction) — les
            re-nester dans le groupe appliquerait la rotation une seconde
            fois et enverrait chaque marqueur hors champ. */}
        {markerAnchors.length > 0 && (
          <MarkerProjector
            anchors={markerAnchors}
            labelRefs={labelRefs}
            lineRefs={lineRefs}
            selectedId={selectedId}
            showAll={showAllMarkers}
            onHiddenCountChange={setHiddenMarkerCount}
          />
        )}
        <CameraRig
          controlsRef={controlsRef}
          meshRegistry={meshRegistry}
          selectedId={selectedId}
          flyToToken={flyToToken}
          reducedMotion={reducedMotion}
          hasFramed={hasFramed}
          setHasFramed={setHasFramed}
          framingIds={framingIds}
        />
      </Canvas>

      <MarkerOverlay
        anchors={markerAnchors}
        structuresById={structuresById}
        selectedId={selectedId}
        onSelectStructure={onSelectStructure}
        labelRefs={labelRefs}
        lineRefs={lineRefs}
      />

      {hoveredStructure && !selectedId && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-[0.8rem] font-medium text-white backdrop-blur">
          {hoveredStructure.name}
        </div>
      )}

      {/* Révélation des étiquettes secondaires (§8) — n'apparaît que si des
          étiquettes ont réellement été écartées faute de place. */}
      {markerAnchors.length > 0 && (hiddenMarkerCount > 0 || showAllMarkers) && (
        <button
          type="button"
          onClick={() => setShowAllMarkers((v) => !v)}
          data-touch-target
          className="absolute bottom-3 left-3 rounded-full border border-white/25 bg-black/60 px-3 py-1.5 text-[0.72rem] font-medium text-white backdrop-blur transition-colors hover:border-[var(--accent)]"
        >
          {showAllMarkers ? 'Réduire les étiquettes' : `+${hiddenMarkerCount} étiquette${hiddenMarkerCount > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
});
