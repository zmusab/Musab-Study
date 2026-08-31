import { Suspense, useEffect, useMemo, useRef, useState, useCallback, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { computeVisibility, type SystemVisibility } from '@/services/anatomy/visibility';
import type { AnatomyCategory, AnatomyStructure, ID } from '@/types';

/**
 * Le moteur 3D — la seule partie du fichier qui connaît Three.js. Tout le
 * reste de la fonctionnalité Anatomie (recherche, panneau info, IA,
 * flashcards) ne dépend que de `structureId`/`AnatomyStructure`, jamais de
 * Three.js directement : remplacer ce composant par un autre moteur plus
 * tard n'affecterait aucun autre fichier.
 *
 * Un fichier `.glb` par système (voir `public/anatomy/`, généré par
 * `scripts/anatomy/convert-headneck.mjs` depuis des données réelles
 * BodyParts3D — voir `src/data/anatomy/SOURCES.md`), chargé au premier
 * moment où ce système est activé et jamais reléchargé ensuite
 * (`useGLTF` met en cache par URL).
 */

const SYSTEM_FILES: Partial<Record<AnatomyCategory, string>> = {
  squelette: '/anatomy/squelette.glb',
  muscles: '/anatomy/muscles.glb',
  vaisseaux: '/anatomy/vaisseaux.glb',
  organes: '/anatomy/organes.glb',
  // 'nerfs' : aucun maillage réel disponible dans le jeu de données intégré — voir SOURCES.md.
};

export interface Anatomy3DViewerProps {
  structures: AnatomyStructure[];
  activeSystems: SystemVisibility;
  selectedId: ID | null;
  isolated: boolean;
  onSelectStructure: (id: ID | null) => void;
  /** Incrémenté à chaque fois qu'un vol de caméra vers `selectedId` est demandé (recherche, marqueur, fil d'Ariane). */
  flyToToken: number;
  reducedMotion: boolean;
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
  registerMesh,
}: {
  url: string;
  category: AnatomyCategory;
  structuresById: Map<ID, AnatomyStructure>;
  activeSystems: SystemVisibility;
  selectedId: ID | null;
  isolated: boolean;
  onSelectStructure: (id: ID | null) => void;
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

  if (activeSystems[category] !== true) return null;
  return <primitive object={cloned} onClick={handleClick} />;
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

function CameraRig({
  controlsRef,
  meshRegistry,
  selectedId,
  flyToToken,
  reducedMotion,
  hasFramed,
  setHasFramed,
}: {
  controlsRef: RefObject<CameraControls | null>;
  meshRegistry: RefObject<Map<ID, THREE.Object3D>>;
  selectedId: ID | null;
  flyToToken: number;
  reducedMotion: boolean;
  hasFramed: boolean;
  setHasFramed: (v: boolean) => void;
}) {
  const { scene } = useThree();

  // Premier cadrage automatique une fois que la scène a du contenu réel —
  // pas de position de caméra codée en dur : elle s'adapte à la bounding
  // box réelle des maillages chargés. `useFrame` plutôt que `useEffect` :
  // les maillages arrivent via `useGLTF`/Suspense, profond dans un autre
  // sous-arbre — sa résolution ne relance pas le rendu de CE composant
  // (sibling hors du Suspense), alors que la boucle de rendu r3f, elle,
  // continue de tourner et voit la scène se remplir dès qu'elle a du contenu.
  useFrame(() => {
    if (hasFramed || !controlsRef.current) return;
    const box = new THREE.Box3().setFromObject(scene);
    if (!Number.isFinite(box.min.x) || box.isEmpty()) return;
    void controlsRef.current.fitToBox(box, false, { paddingLeft: 0.3, paddingRight: 0.3, paddingTop: 0.3, paddingBottom: 0.3 });
    setHasFramed(true);
  });

  useEffect(() => {
    if (!selectedId || !controlsRef.current) return;
    const object = meshRegistry.current.get(selectedId);
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    void controlsRef.current.fitToBox(box, !reducedMotion, {
      paddingLeft: 0.6,
      paddingRight: 0.6,
      paddingTop: 0.6,
      paddingBottom: 0.6,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToToken]);

  return null;
}

export function Anatomy3DViewer({
  structures,
  activeSystems,
  selectedId,
  isolated,
  onSelectStructure,
  flyToToken,
  reducedMotion,
}: Anatomy3DViewerProps) {
  const controlsRef = useRef<CameraControls | null>(null);
  const meshRegistry = useRef<Map<ID, THREE.Object3D>>(new Map());
  const [hasFramed, setHasFramed] = useState(false);
  const [everActivated, setEverActivated] = useState<Set<AnatomyCategory>>(new Set());

  const structuresById = useMemo(() => new Map(structures.map((s) => [s.id, s])), [structures]);

  useEffect(() => {
    setEverActivated((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const [category, active] of Object.entries(activeSystems) as [AnatomyCategory, boolean][]) {
        if (active && !next.has(category)) {
          next.add(category);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeSystems]);

  const registerMesh = useCallback((id: ID, object: THREE.Object3D) => {
    meshRegistry.current.set(id, object);
  }, []);

  const resetView = () => {
    setHasFramed(false);
    void controlsRef.current?.reset(!reducedMotion);
  };

  return (
    <div
      className="relative h-full w-full"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #182338 0%, #0a0f1c 70%, #05070d 100%)' }}
    >
      <Canvas
        camera={{ fov: 45, near: 1, far: 5000 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={() => onSelectStructure(null)}
      >
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
          <Suspense fallback={null}>
            {Object.entries(SYSTEM_FILES).map(([category, url]) =>
              everActivated.has(category as AnatomyCategory) ? (
                <SystemModel
                  key={category}
                  url={url}
                  category={category as AnatomyCategory}
                  structuresById={structuresById}
                  activeSystems={activeSystems}
                  selectedId={selectedId}
                  isolated={isolated}
                  onSelectStructure={onSelectStructure}
                  registerMesh={registerMesh}
                />
              ) : null,
            )}
          </Suspense>
        </AxisCorrection>
        <CameraRig
          controlsRef={controlsRef}
          meshRegistry={meshRegistry}
          selectedId={selectedId}
          flyToToken={flyToToken}
          reducedMotion={reducedMotion}
          hasFramed={hasFramed}
          setHasFramed={setHasFramed}
        />
      </Canvas>

      <div className="absolute bottom-3 right-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={resetView}
          data-touch-target
          aria-label="Revenir à la vue initiale"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60"
        >
          ⟲
        </button>
      </div>
    </div>
  );
}
