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
import {
  computeVisibility,
  type SystemVisibility,
  type LearningState,
  type LearningFeedbackKind,
} from '@/services/anatomy/visibility';
import assetManifest from '@/data/anatomy/assetManifest.json';
import { layoutDots, placeDotLabel, type DotAnchor } from '@/services/anatomy/dotLayout';
import type { AnatomyCategory, AnatomyStructure, ID } from '@/types';

/**
 * Le moteur 3D — la seule partie du fichier qui connaît Three.js. Tout le
 * reste de la fonctionnalité Anatomie (recherche, panneau info, IA,
 * flashcards) ne dépend que de `structureId`/`AnatomyStructure`, jamais de
 * Three.js directement : remplacer ce composant par un autre moteur plus
 * tard n'affecterait aucun autre fichier.
 *
 * Un fichier `.glb` par couple (sous-région, système) — voir
 * `public/anatomy/`, généré par `scripts/anatomy/convert-meshes.mjs`
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
 * `scripts/anatomy/convert-meshes.mjs` : le client ne devine jamais un nom
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

/** Teintes de la correction du mode apprentissage, appliquées au maillage. */
const FEEDBACK_EMISSIVE: Record<string, string> = {
  correct: '#2f9e44',
  incorrect: '#d64545',
  none: '#000000',
};

/**
 * Distance minimale entre deux points à l'écran.
 *
 * Réglée à 36 px pour deux raisons : la cible tactile fait 44 px (viser au
 * doigt doit rester sans ambiguïté), et un modèle criblé de points devient
 * illisible. C'est aussi ce qui rend les points CONTEXTUELS : de loin, les
 * structures voisines se fondent en un seul point ; en zoomant, elles
 * s'écartent à l'écran et réapparaissent une à une, sans réglage manuel.
 */
const DOT_MIN_DISTANCE = 36;

/**
 * Direction caméra → cible pour chaque vue anatomique, dans le repère
 * APRÈS correction d'axe (données Z-haut ramenées en Y-haut). Les vues
 * supérieure et inférieure sont légèrement inclinées : une direction
 * exactement verticale ferait perdre son cap au contrôleur d'orbite.
 */
const VIEW_DIRECTIONS: Record<AnatomicalView, [number, number, number]> = {
  anterieure: [0, 0, 1],
  posterieure: [0, 0, -1],
  droite: [-1, 0, 0],
  gauche: [1, 0, 0],
  superieure: [0, 1, 0.001],
  inferieure: [0, -1, 0.001],
};



/** Vues anatomiques standard (§13). */
export type AnatomicalView = 'anterieure' | 'posterieure' | 'droite' | 'gauche' | 'superieure' | 'inferieure';

export interface Anatomy3DViewerHandle {
  /** Cadre la caméra sur la boîte englobante réelle des structures données (sous-région, résultat de recherche). */
  flyToStructures: (ids: ID[]) => void;
  /** Oriente la caméra selon une vue anatomique, sans changer la distance ni la cible. */
  setView: (view: AnatomicalView) => void;
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
  /**
   * Question en cours du mode apprentissage. Une fois répondu
   * (`answeredId` non nul), la correction s'affiche SUR LE MODÈLE : bonne
   * structure en vert, réponse erronée en rouge.
   */
  learning?: LearningState | null;
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
  /**
   * Sous-région ouverte : la caméra s'y recadre dès que ses maillages sont
   * chargés. `null` = cadrage par défaut sur la tête et le cou.
   */
  focusedSubregion?: string | null;
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
  learning,
  onSelectStructure,
  onHover,
  registerMesh,
  unregisterMesh,
  groupKey,
  onReady,
}: {
  url: string;
  category: AnatomyCategory;
  structuresById: Map<ID, AnatomyStructure>;
  activeSystems: SystemVisibility;
  selectedId: ID | null;
  isolated: boolean;
  learning: LearningState | null;
  onSelectStructure: (id: ID | null) => void;
  onHover: (id: ID | null) => void;
  registerMesh: (id: ID, object: THREE.Object3D) => void;
  unregisterMesh: (id: ID) => void;
  /** Clé du groupe, signalée une fois le fichier RÉELLEMENT téléchargé et analysé. */
  groupKey: string;
  onReady: (key: string) => void;
}) {
  // `useGLTF` suspend : tout ce qui suit ne s'exécute qu'une fois le fichier
  // téléchargé et analysé. C'est donc ici, et pas au montage du parent, que
  // l'on sait qu'un groupe est vraiment arrivé.
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
    onReady(groupKey);
    // Au démontage (région quittée), les maillages doivent quitter le
    // registre : sinon des ancres de points pointeraient vers des objets
    // détachés de la scène.
    const registered: ID[] = [];
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name) registered.push(child.name);
    });
    return () => {
      for (const id of registered) unregisterMesh(id);
    };
    // `onReady` et `registerMesh` sont stables (useCallback sans dépendance) :
    // l'effet ne doit tourner qu'à l'arrivée d'un nouveau maillage. Une
    // version antérieure passait ici une fonction fléchée recréée à chaque
    // rendu, ce qui relançait l'effet en boucle — `registerMesh` incrémente
    // un compteur d'état, la page ne rendait plus la main.
  }, [cloned, registerMesh, unregisterMesh, groupKey, onReady]);

  useEffect(() => {
    cloned.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.name) return;
      const structure = structuresById.get(child.name);
      if (!structure) return;
      const visual = computeVisibility(structure, { activeSystems, selectedId, isolated, learning });
      child.visible = visual.opacity > 0.001;
      const material = child.material as THREE.MeshStandardMaterial;
      material.opacity = visual.opacity;
      material.depthWrite = visual.opacity > 0.6;
      // La correction du mode apprentissage se lit SUR LE MODÈLE : la bonne
      // structure vire au vert, la mauvaise réponse au rouge. Hors
      // apprentissage, on garde la mise en évidence ambrée de la sélection.
      material.emissive = new THREE.Color(FEEDBACK_EMISSIVE[visual.feedback ?? 'none'] ?? '#000000');
      if (visual.feedback) material.emissiveIntensity = 0.85;
      else {
        material.emissive = new THREE.Color(visual.highlighted ? '#ffd166' : '#000000');
        material.emissiveIntensity = visual.highlighted ? 0.35 : 0;
      }
    });
  }, [cloned, structuresById, activeSystems, selectedId, isolated, learning]);

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
 * Projection des ancres vers l'écran, À L'INTÉRIEUR du Canvas.
 *
 * Ce composant ne rend RIEN : à chaque image il projette la position monde de
 * chaque structure, délègue le regroupement des points à `layoutDots`
 * (fonction pure testée à part) puis écrit DIRECTEMENT dans le DOM de la
 * couche de points via des refs. Passer par un `setState` à 60 Hz
 * re-rendrait tout l'arbre React à chaque image.
 *
 * La couche elle-même est rendue HORS du Canvas (`DotOverlay`) : le
 * `<Html fullscreen>` de drei applique sa propre transformation au conteneur,
 * dont l'origine ne coïncide pas avec le coin haut-gauche du canevas — les
 * points se retrouvaient positionnés hors du cadre visible.
 */
function DotProjector({
  anchors,
  dotRefs,
  badgeRefs,
  labelRef,
  lineRef,
  activeId,
  pinnedIds,
}: {
  anchors: MarkerAnchorWorld[];
  dotRefs: RefObject<Map<ID, HTMLButtonElement>>;
  badgeRefs: RefObject<Map<ID, HTMLSpanElement>>;
  labelRef: RefObject<HTMLDivElement | null>;
  lineRef: RefObject<SVGPathElement | null>;
  /** Point dont le nom est affiché : la sélection, ou le survol à défaut. */
  activeId: ID | null;
  /** Points qui ne doivent jamais être fondus dans un groupe. */
  pinnedIds: readonly (ID | null)[];
}) {
  const { camera, size } = useThree();
  const scratch = useRef(new THREE.Vector3());

  useFrame(() => {
    if (anchors.length === 0) return;

    const screenAnchors: DotAnchor[] = anchors.map(({ id, world, radius }) => {
      scratch.current.copy(world).project(camera);
      const x = (scratch.current.x * 0.5 + 0.5) * size.width;
      const y = (-scratch.current.y * 0.5 + 0.5) * size.height;
      return {
        id,
        x,
        y,
        onScreen: scratch.current.z < 1 && x > 0 && x < size.width && y > 0 && y < size.height,
        // Priorité = taille apparente : dans un groupe serré, c'est la grosse
        // structure qui porte le point, celle qu'on vise naturellement.
        priority: radius,
      };
    });

    const dots = layoutDots(screenAnchors, {
      width: size.width,
      height: size.height,
      minDistance: DOT_MIN_DISTANCE,
      pinnedIds,
    });

    const placedIds = new Set(dots.map((d) => d.id));
    for (const [id, el] of dotRefs.current) if (!placedIds.has(id)) el.style.display = 'none';

    let activeDot: { x: number; y: number } | null = null;
    for (const dot of dots) {
      const el = dotRefs.current.get(dot.id);
      if (el) {
        el.style.display = '';
        el.style.transform = `translate(${dot.x}px, ${dot.y}px) translate(-50%, -50%)`;
      }
      // Point de REGROUPEMENT : un anneau discret, jamais un compteur. Des
      // dizaines de « +3 » au-dessus du modèle le transformaient en tableau
      // de bord technique. Le nombre exact reste annoncé aux lecteurs
      // d'écran via `aria-label`, et zoomer sépare réellement le groupe.
      const ring = badgeRefs.current.get(dot.id);
      if (ring) ring.style.display = dot.merged.length > 0 ? '' : 'none';
      if (el) el.setAttribute('data-anatomy-cluster', dot.merged.length > 0 ? String(dot.merged.length + 1) : '');
      if (dot.id === activeId) activeDot = dot;
    }

    // Une seule étiquette à l'écran : celle du point actif. Le modèle reste
    // propre, contrairement à une étiquette par structure.
    const label = labelRef.current;
    const line = lineRef.current;
    if (!activeDot || !activeId) {
      if (label) label.style.display = 'none';
      if (line) line.style.display = 'none';
      return;
    }
    if (label) {
      const rect = label.getBoundingClientRect();
      const placement = placeDotLabel(activeDot, {
        width: size.width,
        height: size.height,
        labelWidth: rect.width || 160,
        labelHeight: rect.height || 32,
      });
      label.style.display = '';
      label.style.transform = `translate(${placement.x}px, ${placement.y}px) translate(0, -50%)`;
      if (line) {
        line.style.display = '';
        const endX = placement.side === 'right' ? placement.x : placement.x + (rect.width || 160);
        line.setAttribute('d', `M ${activeDot.x} ${activeDot.y} L ${endX} ${placement.y}`);
      }
    }
  });

  return null;
}

/**
 * Couche DOM des POINTS interactifs, superposée au canevas.
 *
 * Un point par structure disponible, sans texte : le modèle reste lisible.
 * Le nom n'apparaît que pour le point actif (sélectionné, ou survolé), relié
 * par une ligne de rappel. Les points trop proches sont regroupés par
 * `layoutDots` et le point survivant affiche « +N ».
 *
 * `feedbackById` porte la correction du mode apprentissage : le point de la
 * bonne structure passe en vert, celui d'une réponse erronée en rouge — la
 * correction est donc lisible SUR le modèle, à l'endroit exact.
 */
function DotOverlay({
  anchors,
  structuresById,
  selectedId,
  activeId,
  feedbackById,
  onSelectStructure,
  onHoverDot,
  dotRefs,
  badgeRefs,
  labelRef,
  lineRef,
}: {
  anchors: MarkerAnchorWorld[];
  structuresById: Map<ID, AnatomyStructure>;
  selectedId: ID | null;
  activeId: ID | null;
  feedbackById: ReadonlyMap<ID, LearningFeedbackKind>;
  onSelectStructure: (id: ID) => void;
  onHoverDot: (id: ID | null) => void;
  dotRefs: RefObject<Map<ID, HTMLButtonElement>>;
  badgeRefs: RefObject<Map<ID, HTMLSpanElement>>;
  labelRef: RefObject<HTMLDivElement | null>;
  lineRef: RefObject<SVGPathElement | null>;
}) {
  if (anchors.length === 0) return null;
  const activeStructure = activeId ? structuresById.get(activeId) : null;
  const activeFeedback = activeId ? (feedbackById.get(activeId) ?? null) : null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <path
          ref={lineRef}
          fill="none"
          stroke={
            activeFeedback === 'correct'
              ? '#2f9e44'
              : activeFeedback === 'incorrect'
                ? '#d64545'
                : 'var(--accent)'
          }
          strokeWidth={1.5}
          style={{ display: 'none' }}
        />
      </svg>

      {anchors.map(({ id }) => {
        const structure = structuresById.get(id);
        if (!structure) return null;
        const isSelected = selectedId === id;
        const feedback = feedbackById.get(id) ?? null;
        return (
          <button
            key={id}
            type="button"
            ref={(el) => {
              if (el) dotRefs.current.set(id, el);
              else dotRefs.current.delete(id);
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelectStructure(id);
            }}
            onPointerEnter={() => onHoverDot(id)}
            onPointerLeave={() => onHoverDot(null)}
            onFocus={() => onHoverDot(id)}
            onBlur={() => onHoverDot(null)}
            aria-label={
              feedback === 'correct'
                ? `Bonne réponse : ${structure.name}`
                : feedback === 'incorrect'
                  ? `Réponse incorrecte : ${structure.name}`
                  : structure.name
            }
            data-anatomy-dot
            data-anatomy-feedback={feedback ?? undefined}
            // Cible tactile CARRÉE de 44 px (recommandation Apple), imposée
            // explicitement : la règle globale `min-height: 44px` sur tout
            // bouton ne fixait que la hauteur, et le point devenait un ovale.
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              display: 'none',
              pointerEvents: 'auto',
              width: 44,
              height: 44,
              minWidth: 44,
              minHeight: 44,
            }}
            className="flex items-center justify-center rounded-full"
          >
            {/* Anneau de regroupement — discret, sans chiffre. */}
            <span
              ref={(el) => {
                if (el) badgeRefs.current.set(id, el);
                else badgeRefs.current.delete(id);
              }}
              aria-hidden
              style={{ display: 'none', width: 20, height: 20 }}
              className="pointer-events-none absolute rounded-full border border-white/30"
            />
            {/* Pastille visible : petite au repos, franche à la sélection. */}
            <span
              aria-hidden
              className={
                'block rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.35)] transition-all duration-150 ' +
                (feedback === 'correct'
                  ? 'h-3.5 w-3.5 bg-[#3ec46d] ring-2 ring-white'
                  : feedback === 'incorrect'
                    ? 'h-3.5 w-3.5 bg-[#e05a5a] ring-2 ring-white'
                    : isSelected
                      ? 'h-3.5 w-3.5 bg-[var(--accent)] ring-2 ring-white'
                      : 'h-2 w-2 bg-white/70 hover:h-3 hover:w-3 hover:bg-[var(--accent)]')
              }
            />
          </button>
        );
      })}

      <div
        ref={labelRef}
        data-anatomy-dot-label
        style={{ position: 'absolute', top: 0, left: 0, display: 'none' }}
        className={
          'pointer-events-none max-w-[16rem] rounded-[var(--radius-control)] border px-2.5 py-1 text-[0.78rem] font-medium leading-tight text-white shadow-lg backdrop-blur ' +
          (activeFeedback === 'correct'
            ? 'border-[#2f9e44] bg-[#2f9e44]'
            : activeFeedback === 'incorrect'
              ? 'border-[#d64545] bg-[#d64545]'
              : 'border-white/25 bg-black/75')
        }
      >
        {activeFeedback === 'correct' ? '✓ ' : activeFeedback === 'incorrect' ? '✗ ' : ''}
        {activeStructure?.name ?? ''}
      </div>
    </div>
  );
}

/**
 * Choisit entre l'union des deux côtés et un seul côté.
 *
 * Critère GÉOMÉTRIQUE : les deux demi-boîtes ne se recouvrent pas en X, et
 * l'espace vide qui les sépare représente une part notable de la largeur
 * totale. C'est exactement la signature d'une paire écartée — deux mains,
 * deux pieds, deux orbites — dont l'union laisserait un grand trou au
 * milieu de l'image. On cadre alors le côté le mieux fourni.
 *
 * Une première version comparait largeur et hauteur : elle ratait les pieds,
 * dont les tendons remontent et rendent la boîte aussi haute que large.
 * Une région d'un seul tenant (thorax, crâne) n'a pas d'écart central et
 * garde son cadrage d'ensemble.
 */
function sidedFramingBox({
  framingBox,
  leftBox,
  rightBox,
  leftCount,
  rightCount,
}: {
  framingBox: THREE.Box3;
  leftBox: THREE.Box3;
  rightBox: THREE.Box3;
  leftCount: number;
  rightCount: number;
}): THREE.Box3 {
  const total = leftCount + rightCount;
  if (total === 0 || leftBox.isEmpty() || rightBox.isEmpty()) return framingBox;

  // Chaque côté doit porter une part réelle des structures : sinon il s'agit
  // d'une région d'un seul tenant qui déborde un peu de la ligne médiane.
  if (Math.min(leftCount, rightCount) / total < 0.25) return framingBox;

  const width = framingBox.getSize(new THREE.Vector3()).x;
  const gap = rightBox.min.x - leftBox.max.x;
  if (width <= 0 || gap <= 0 || gap / width < 0.15) return framingBox;

  return leftCount >= rightCount ? leftBox : rightBox;
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
  framingRequired,
  framingPending,
  framingTransition,
}: {
  controlsRef: RefObject<CameraControls | null>;
  meshRegistry: RefObject<Map<ID, THREE.Object3D>>;
  selectedId: ID | null;
  flyToToken: number;
  reducedMotion: boolean;
  hasFramed: boolean;
  setHasFramed: (v: boolean) => void;
  framingIds: ID[];
  /**
   * Vrai quand le cadrage DOIT porter sur `framingIds` (une sous-région
   * qu'on vient d'ouvrir) : on attend alors que ses maillages soient
   * réellement chargés au lieu de cadrer la scène entière par défaut.
   */
  framingRequired: boolean;
  /** Vrai tant qu'un groupe d'assets de la sous-région visée n'est pas arrivé. */
  framingPending: boolean;
  framingTransition: boolean;
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
    /*
      Cadrage d'une sous-région BILATÉRALE.

      Beaucoup de sous-régions existent en double (mains, pieds, avant-bras,
      orbites…). Cadrer l'union des deux côtés donne une image large avec un
      grand vide au milieu et deux structures minuscules aux bords. On mesure
      donc chaque côté par rapport à la ligne médiane RÉELLE du corps (centre
      de la scène), et si la région est nettement bilatérale on cadre un seul
      côté — celui qui porte le plus de structures.
    */
    const midlineX = new THREE.Box3().setFromObject(scene).getCenter(new THREE.Vector3()).x;
    const framingBox = new THREE.Box3();
    const leftBox = new THREE.Box3();
    const rightBox = new THREE.Box3();
    let framingCount = 0;
    let leftCount = 0;
    let rightCount = 0;
    const objectCenter = new THREE.Vector3();
    const objectBox = new THREE.Box3();
    for (const id of framingIds) {
      const object = meshRegistry.current.get(id);
      if (!object || !object.visible) continue;
      objectBox.setFromObject(object);
      if (objectBox.isEmpty()) continue;
      framingBox.union(objectBox);
      framingCount++;
      objectBox.getCenter(objectCenter);
      if (objectCenter.x < midlineX) {
        leftBox.union(objectBox);
        leftCount++;
      } else {
        rightBox.union(objectBox);
        rightCount++;
      }
    }
    /*
      Cadrage exigé sur une sous-région : tant que ses fichiers ne sont pas
      arrivés, on ATTEND plutôt que de cadrer la scène entière — sinon la
      caméra reste figée sur la région précédente.

      L'attente est conditionnée à l'état RÉEL du chargement, pas à un délai.
      Une version antérieure abandonnait au bout de 15 s : sur une région
      lourde analysée pendant que le fil principal est occupé, le délai
      expirait, la caméra cadrait la tête et ne revenait jamais sur le pied
      ou la main demandés. `framingPending` retombe à faux dès que tous les
      groupes de la sous-région sont chargés — ou tout de suite si elle n'en
      a aucun, auquel cas on cadre ce qui existe plutôt que d'attendre.
    */
    if (framingRequired && framingCount === 0 && framingPending) return;

    const box = framingCount > 0 && !framingBox.isEmpty()
      ? sidedFramingBox({ framingBox, leftBox, rightBox, leftCount, rightCount })
      : new THREE.Box3().setFromObject(scene);
    if (!Number.isFinite(box.min.x) || box.isEmpty()) return;

    // Marge basse plus généreuse : la barre des vues et les contrôles de
    // caméra occupent le bas du viewport ; sans elle, le sujet cadré passe
    // dessous et se retrouve coupé.
    void controlsRef.current.fitToBox(box, framingTransition, {
      paddingLeft: 0.08,
      paddingRight: 0.08,
      paddingTop: 0.08,
      paddingBottom: 0.18,
    });
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
    // perdre le repère anatomique (on ne sait plus OÙ elle se trouve).
    //
    // Un simple facteur multiplicatif ne suffit pas : ×2,2 sur un gros
    // muscle donne un bon cadrage, mais ×2,2 sur un tout petit abaisseur de
    // l'angle de la bouche colle encore la caméra dessus. On impose donc
    // AUSSI un plancher relatif à la scène chargée — la vue montre toujours
    // au moins une fraction du corps autour de la structure.
    const CONTEXT_FACTOR = 2.2;
    const MIN_CONTEXT_FRACTION = 0.16;
    const sceneSpan = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    const raw = box.getSize(new THREE.Vector3());
    const floor = Number.isFinite(sceneSpan) && sceneSpan > 0 ? sceneSpan * MIN_CONTEXT_FRACTION : 0;
    const size = new THREE.Vector3(
      Math.max(raw.x * CONTEXT_FACTOR, floor),
      Math.max(raw.y * CONTEXT_FACTOR, floor),
      Math.max(raw.z * CONTEXT_FACTOR, floor),
    ).multiplyScalar(0.5);
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
    learning = null,
    onSelectStructure,
    flyToToken,
    markerStructureIds,
    loadedSubregions,
    focusedSubregion = null,
    reducedMotion,
    onFullscreenChange,
    onLoadProgress,
  },
  forwardedRef,
) {
  /**
   * Correction du mode apprentissage par structure — vide tant que l'élève
   * n'a pas répondu. Sert à la fois aux matériaux (vert/rouge) et aux
   * étiquettes (coche/croix).
   */
  const feedbackById = useMemo(() => {
    const map = new Map<ID, LearningFeedbackKind>();
    if (learning && learning.answeredId !== null) {
      map.set(learning.targetId, 'correct');
      if (learning.answeredId !== learning.targetId) map.set(learning.answeredId, 'incorrect');
    }
    return map;
  }, [learning]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<CameraControls | null>(null);
  const meshRegistry = useRef<Map<ID, THREE.Object3D>>(new Map());
  const [hasFramed, setHasFramed] = useState(false);
  const [everLoaded, setEverLoaded] = useState<Set<string>>(new Set());
  /** Groupes montés au rendu précédent — sert à repérer ceux à purger. */
  const mountedGroupsRef = useRef<Set<string>>(new Set());
  const [registryVersion, setRegistryVersion] = useState(0);

  /**
   * Groupes RÉELLEMENT téléchargés. À distinguer de `groupsToLoad`, qui liste
   * seulement les groupes montés : un groupe monté est encore en cours de
   * téléchargement. Confondre les deux faisait afficher « chargement
   * terminé » dès le montage, alors que 11 Mo restaient à venir.
   */
  const [readyGroups, setReadyGroups] = useState<Set<string>>(new Set());
  const markGroupReady = useCallback((key: string) => {
    setReadyGroups((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const [hoveredId, setHoveredId] = useState<ID | null>(null);
  /** Point survolé — sert à afficher son nom sans avoir à le sélectionner. */
  const [hoveredDotId, setHoveredDotId] = useState<ID | null>(null);
  const dotRefs = useRef<Map<ID, HTMLButtonElement>>(new Map());
  /** Anneaux de regroupement (un par point) — voir `DotProjector`. */
  const badgeRefs = useRef<Map<ID, HTMLSpanElement>>(new Map());
  const labelRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<SVGPathElement | null>(null);

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

  /**
   * Structures servant de repère au cadrage automatique. Par défaut la tête
   * (la trachée et l'œsophage descendent bien plus bas et rétréciraient la
   * zone intéressante) ; dès qu'une sous-région est ouverte, ce sont SES
   * structures — c'est ce qui amène réellement la caméra sur la cuisse ou la
   * main qu'on vient de choisir.
   */
  const framingIds = useMemo(() => {
    const scope = focusedSubregion
      ? structures.filter((s) => s.subregion === focusedSubregion && s.model3dRef !== null)
      : structures.filter((s) => ['crane', 'face', 'machoire', 'dents'].includes(s.subregion ?? ''));
    return scope.map((s) => s.id);
  }, [structures, focusedSubregion]);

  // Changer de sous-région relance le cadrage automatique.
  useEffect(() => {
    setHasFramed(false);
  }, [focusedSubregion]);

  /*
    Quels groupes restent MONTÉS.

    Deux règles, et la seconde compte autant que la première :

    1. Un groupe déjà téléchargé reste monté même si son système est
       décoché — `useGLTF` met en cache par URL, le re-cocher est instantané
       et la visibilité par structure suffit à le masquer.

    2. Un groupe dont la sous-région SORT du périmètre est démonté et purgé
       du cache. Sans cela l'ensemble ne faisait que grossir : parcourir tête
       → thorax → abdomen → main gardait toute leur géométrie en mémoire, et
       la page finissait par ne plus répondre. Le fichier reste en cache HTTP
       et dans le service worker : y revenir ne retélécharge rien.
  */
  useEffect(() => {
    setEverLoaded((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        const group = ASSET_GROUPS.find((g) => g.key === key);
        if (group && loadedSubregions.includes(group.subregion)) next.add(key);
      }
      for (const group of ASSET_GROUPS) {
        if (!loadedSubregions.includes(group.subregion)) continue;
        if (activeSystems[group.category] !== true) continue;
        next.add(group.key);
      }
      if (next.size === prev.size && [...next].every((k) => prev.has(k))) return prev;
      return next;
    });
  }, [activeSystems, loadedSubregions]);

  /**
   * Purge du cache des groupes évincés — dans un effet DÉDIÉ, jamais dans
   * l'updater de `setEverLoaded`.
   *
   * React peut rejouer un updater d'état (rebasing) : y placer un effet de
   * bord comme `useGLTF.clear` pouvait vider le cache d'un groupe encore
   * monté, qui ne réenregistrait alors plus jamais ses maillages — la caméra
   * ne trouvait plus rien à cadrer et restait bloquée sur la région
   * précédente. Ici la comparaison se fait sur une ref, une seule fois par
   * changement réel.
   */
  useEffect(() => {
    const previous = mountedGroupsRef.current;
    for (const key of previous) {
      if (!everLoaded.has(key)) useGLTF.clear(assetUrl(key));
    }
    mountedGroupsRef.current = new Set(everLoaded);
  }, [everLoaded]);

  const groupsToLoad = useMemo(() => ASSET_GROUPS.filter((g) => everLoaded.has(g.key)), [everLoaded]);

  /**
   * Reste-t-il un fichier à charger pour la sous-région ouverte ? C'est la
   * condition d'attente du cadrage : tant qu'elle est vraie, la caméra ne
   * cadre pas la région précédente par défaut.
   */
  const framingPending = useMemo(() => {
    if (!focusedSubregion) return false;
    const groups = ASSET_GROUPS.filter(
      (g) => g.subregion === focusedSubregion && activeSystems[g.category] === true,
    );
    return groups.length > 0 && groups.some((g) => !readyGroups.has(g.key));
  }, [focusedSubregion, activeSystems, readyGroups]);


  // Un groupe évincé n'est plus « prêt » : sans cette purge, l'indicateur de
  // progression compterait des groupes qui ne sont plus montés.
  useEffect(() => {
    setReadyGroups((prev) => {
      const next = new Set([...prev].filter((key) => everLoaded.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [everLoaded]);

  useEffect(() => {
    if (!onLoadProgress) return;
    const wanted = ASSET_GROUPS.filter(
      (g) => loadedSubregions.includes(g.subregion) && activeSystems[g.category] === true,
    ).length;
    onLoadProgress(readyGroups.size, wanted);
  }, [readyGroups, loadedSubregions, activeSystems, onLoadProgress]);

  const registerMesh = useCallback((id: ID, object: THREE.Object3D) => {
    meshRegistry.current.set(id, object);
    setRegistryVersion((v) => v + 1);
  }, []);

  const unregisterMesh = useCallback((id: ID) => {
    meshRegistry.current.delete(id);
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
      setView: (view) => {
        const controls = controlsRef.current;
        if (!controls) return;
        const target = controls.getTarget(new THREE.Vector3());
        const position = controls.getPosition(new THREE.Vector3());
        // On conserve la distance courante : changer de vue ne doit pas
        // recadrer ni « dézoomer » ce que l'utilisateur regardait.
        const distance = position.distanceTo(target) || 400;
        const [dx, dy, dz] = VIEW_DIRECTIONS[view];
        void controls.setLookAt(
          target.x + dx * distance,
          target.y + dy * distance,
          target.z + dz * distance,
          target.x,
          target.y,
          target.z,
          !reducedMotion,
        );
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
  /**
   * Point dont le nom s'affiche : la sélection prime, sinon le survol. Sans
   * sélection ni survol, AUCUN nom n'est affiché — c'est ce qui garde le
   * modèle propre.
   */
  const activeDotId = selectedId ?? hoveredDotId;

  /**
   * Points protégés du regroupement : la sélection, et — pendant la
   * correction du mode apprentissage — la bonne structure ET la réponse
   * cliquée. Sans cela, le point rouge de l'erreur pouvait être absorbé par
   * un voisin et la correction devenait incomplète.
   */
  const pinnedDotIds = useMemo(
    () => [activeDotId, ...feedbackById.keys()],
    [activeDotId, feedbackById],
  );

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
        <Invalidator deps={[activeSystems, selectedId, activeDotId, isolated, learning, groupsToLoad.length, markerStructureIds]} />
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
                learning={learning}
                onSelectStructure={onSelectStructure}
                onHover={setHoveredId}
                registerMesh={registerMesh}
                unregisterMesh={unregisterMesh}
                groupKey={group.key}
                onReady={markGroupReady}
              />
            </Suspense>
          ))}
        </AxisCorrection>
        {/* Hors du groupe `AxisCorrection` : `Markers` calcule déjà des
            positions MONDE (`Box3.setFromObject`, post-correction) — les
            re-nester dans le groupe appliquerait la rotation une seconde
            fois et enverrait chaque marqueur hors champ. */}
        {markerAnchors.length > 0 && (
          <DotProjector
            anchors={markerAnchors}
            dotRefs={dotRefs}
            badgeRefs={badgeRefs}
            labelRef={labelRef}
            lineRef={lineRef}
            activeId={activeDotId}
            pinnedIds={pinnedDotIds}
          />
        )}
        <CameraRig
          controlsRef={controlsRef}
          meshRegistry={meshRegistry}
          selectedId={selectedId}
          flyToToken={flyToToken}
          reducedMotion={reducedMotion}
          hasFramed={hasFramed}
          framingRequired={focusedSubregion !== null}
          framingPending={framingPending}
          framingTransition={focusedSubregion !== null && !reducedMotion}
          setHasFramed={setHasFramed}
          framingIds={framingIds}
        />
      </Canvas>

      <DotOverlay
        anchors={markerAnchors}
        structuresById={structuresById}
        selectedId={selectedId}
        activeId={activeDotId}
        feedbackById={feedbackById}
        onSelectStructure={onSelectStructure}
        onHoverDot={setHoveredDotId}
        dotRefs={dotRefs}
        badgeRefs={badgeRefs}
        labelRef={labelRef}
        lineRef={lineRef}
      />

      {hoveredStructure && !selectedId && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-[0.8rem] font-medium text-white backdrop-blur">
          {hoveredStructure.name}
        </div>
      )}

    </div>
  );
});
