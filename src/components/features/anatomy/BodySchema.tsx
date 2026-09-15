import { useEffect, useMemo, useRef, useState } from 'react';
import schemaMap from '@/data/anatomy/schemaMap.json';
import { spreadPositions } from '@/services/anatomy/markerLayout';

interface Zone {
  id: string;
  pixels: number;
  box: [number, number, number, number];
  anchor: [number, number];
}

const MAP = schemaMap as { width: number; height: number; regions: Zone[]; subregions: Zone[] };

const ZONES: Record<'region' | 'sub', Map<string, Zone>> = {
  region: new Map(MAP.regions.map((z) => [z.id, z])),
  sub: new Map(MAP.subregions.map((z) => [z.id, z])),
};

/** Une zone n'existe que si le rendu réel du corps la fait apparaître. */
export function schemaHasZone(kind: 'region' | 'sub', id: string): boolean {
  return ZONES[kind].has(id);
}

/**
 * Cadre de la région, en pixels du schéma — sert à ZOOMER sur elle quand on
 * explore ses sous-régions. Sans ce zoom, les six zones de la tête et du cou
 * se superposeraient : elles tiennent dans ~35 px de la vue corps entier.
 */
export function schemaRegionBox(id: string): [number, number, number, number] | null {
  return ZONES.region.get(id)?.box ?? null;
}

/** Marge autour du cadre (en pixels du schéma), pour ne pas coller la région au bord. */
const CROP_PADDING = 24;

/**
 * Taille d'un point d'accroche. Elle est CALCULÉE, pas fixe, pour deux
 * raisons :
 *
 *  - sur écran tactile, une règle globale impose `min-height: 44px` à tout
 *    `button` (cible Apple). Un point de 12 px y devient donc haut de 44 px
 *    et recouvre ses voisins alors que le calcul d'écartement, lui, croyait
 *    12 px. Il faut que l'écartement et la taille RÉELLE coïncident ;
 *  - le même composant sert au rail étroit (≈160 px de haut) et au schéma
 *    agrandi (≈500 px). Une taille unique serait trop grosse ici ou
 *    ridicule là.
 *
 * On prend donc la plus grande taille qui laisse tenir toutes les zones sans
 * chevauchement, plafonnée à la cible tactile confortable.
 */
const DOT_MIN = 14;
const DOT_MAX = 44;

/**
 * Schéma anatomique interactif.
 *
 * L'image n'est pas un dessin : `scripts/anatomy/build-schema.mjs` rastérise
 * les 931 maillages BodyParts3D dans une seule projection antérieure et
 * mémorise, pour chaque pixel, la région et la sous-région de la structure
 * qui l'occupe. Les points d'accroche affichés ici viennent de cette carte —
 * chaque zone cliquable correspond donc à une anatomie réellement rendue, et
 * la surbrillance est la vraie silhouette de la zone.
 *
 * Une zone invisible de face (l'encéphale derrière le crâne, le dos derrière
 * le thorax) n'a volontairement PAS de point sur le schéma : le parent
 * l'affiche à part plutôt que de placer un repère arbitraire.
 */
export function BodySchema({
  kind,
  zones,
  activeId,
  onSelect,
  hint,
  crop,
}: {
  kind: 'region' | 'sub';
  /** Zones proposées, dans l'ordre d'affichage. Celles absentes du rendu sont ignorées. */
  zones: { id: string; label: string; detail?: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Texte affiché sous le schéma tant qu'aucune zone n'est survolée. */
  hint: string;
  /** Cadre à agrandir (`schemaRegionBox`) — sinon le corps entier. */
  crop?: [number, number, number, number] | null;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = zones.filter((z) => ZONES[kind].has(z.id));
  const highlight = hovered ?? activeId;
  const prefix = kind === 'region' ? 'region' : 'sub';
  const legend = shown.find((z) => z.id === highlight);

  // Fenêtre affichée, en pixels du schéma. Les images sont agrandies et
  // décalées en CSS : une seule image sert donc au corps entier comme à
  // chaque région, sans rendu supplémentaire.
  const view = crop
    ? {
        x: Math.max(0, crop[0] - CROP_PADDING),
        y: Math.max(0, crop[1] - CROP_PADDING),
        w: Math.min(MAP.width, crop[2] + CROP_PADDING) - Math.max(0, crop[0] - CROP_PADDING),
        h: Math.min(MAP.height, crop[3] + CROP_PADDING) - Math.max(0, crop[1] - CROP_PADDING),
      }
    : { x: 0, y: 0, w: MAP.width, h: MAP.height };

  // Taille réellement rendue : nécessaire pour écarter les points qui se
  // chevauchent (six zones de la tête tiennent dans quelques pixels).
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Points d'accroche placés à l'écran.
   *
   * L'ancre RÉELLE de chaque zone vient du rendu (barycentre de ses pixels).
   * Quand deux ancres sont trop proches pour être cliquables, le point est
   * décalé verticalement — jamais silencieusement : une ligne le relie à sa
   * position réelle, comme les marqueurs du modèle 3D. On réutilise
   * `spreadPositions`, la fonction pure déjà testée pour ces marqueurs.
   */
  const dotSize = Math.round(
    Math.max(DOT_MIN, Math.min(DOT_MAX, box.h / Math.max(1, shown.length + 0.5))),
  );

  const placed = useMemo(() => {
    if (box.h === 0) return [];
    const pts = shown
      .map((zone) => {
        const anchor = ZONES[kind].get(zone.id)!.anchor;
        return {
          zone,
          anchorX: ((anchor[0] - view.x) / view.w) * box.w,
          anchorY: ((anchor[1] - view.y) / view.h) * box.h,
        };
      })
      .sort((a, b) => a.anchorY - b.anchorY);
    const ys = spreadPositions(
      pts.map((p) => p.anchorY),
      dotSize,
      dotSize / 2,
      Math.max(dotSize / 2, box.h - dotSize / 2),
    );
    return pts.map((p, i) => ({ ...p, dotX: p.anchorX, dotY: ys[i]! }));
    // `view` est recalculé à chaque rendu mais dérive de `crop` : on dépend de ses champs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, kind, box.w, box.h, view.x, view.y, view.w, view.h, dotSize]);

  const imageStyle = {
    position: 'absolute' as const,
    width: `${(MAP.width / view.w) * 100}%`,
    height: `${(MAP.height / view.h) * 100}%`,
    left: `${(-view.x / view.w) * 100}%`,
    top: `${(-view.y / view.h) * 100}%`,
    maxWidth: 'none' as const,
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center"
      role="group"
      aria-label="Schéma anatomique interactif"
    >
      <div
        ref={boxRef}
        className="relative w-full flex-1 shrink-0 overflow-hidden"
        // `minHeight` est un GARDE-FOU : sans lui, quand le reste de la carte
        // déborde (légende sur deux lignes, pastilles de zones invisibles de
        // face), l'algorithme flex écrase cette boîte à quelques pixels et le
        // schéma devient inutilisable. Le plancher force la carte à défiler
        // plutôt qu'à réduire le corps à un trait.
        style={{ aspectRatio: `${view.w} / ${view.h}`, minHeight: '10rem', maxWidth: `${(view.w / view.h) * 22}rem` }}
      >
        <img
          src="/anatomy/schema/body.png"
          alt="Schéma anatomique du corps, rendu depuis les maillages 3D réels"
          style={imageStyle}
          draggable={false}
        />
        {highlight && ZONES[kind].has(highlight) && (
          <img
            src={`/anatomy/schema/${prefix}-${highlight}.png`}
            alt=""
            aria-hidden
            className="pointer-events-none"
            style={imageStyle}
            draggable={false}
          />
        )}

        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {placed
            .filter((p) => Math.abs(p.dotY - p.anchorY) > 1.5)
            .map((p) => (
              <line
                key={p.zone.id}
                x1={p.anchorX}
                y1={p.anchorY}
                x2={p.dotX}
                y2={p.dotY}
                stroke="var(--accent)"
                strokeWidth={1}
                strokeOpacity={0.7}
              />
            ))}
        </svg>

        {placed.map(({ zone, dotX, dotY }) => {
          const isActive = activeId === zone.id;
          return (
            <button
              key={zone.id}
              type="button"
              onClick={() => onSelect(zone.id)}
              onPointerEnter={() => setHovered(zone.id)}
              onPointerLeave={() => setHovered((h) => (h === zone.id ? null : h))}
              onFocus={() => setHovered(zone.id)}
              onBlur={() => setHovered((h) => (h === zone.id ? null : h))}
              aria-label={zone.label}
              aria-pressed={isActive}
              title={zone.label}
              // `minHeight` explicite : sans lui, la règle tactile globale
              // (`min-height: 44px` sur tout bouton) casserait l'écartement
              // calculé et ferait se recouvrir les zones.
              style={{ left: dotX, top: dotY, width: dotSize, height: dotSize, minHeight: dotSize }}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
            >
              <span
                aria-hidden
                style={{ width: Math.max(9, Math.round(dotSize * 0.42)), height: Math.max(9, Math.round(dotSize * 0.42)) }}
                className={
                  'block rounded-full border transition-transform duration-150 ' +
                  (isActive
                    ? 'border-white bg-[var(--accent)] shadow-[0_0_0_2px_var(--accent)]'
                    : 'border-white/90 bg-[var(--accent)]/85 shadow')
                }
              />
            </button>
          );
        })}
      </div>

      {/* Légende à hauteur fixe : nommer la zone survolée sans faire sauter
          la mise en page à chaque survol. */}
      <p className="mt-1 h-8 shrink-0 text-center text-[0.7rem] leading-tight text-[var(--ink-soft)]">
        {legend ? (
          <>
            <span className="font-medium text-[var(--ink)]">{legend.label}</span>
            {legend.detail ? <span className="block text-[var(--ink-faint)]">{legend.detail}</span> : null}
          </>
        ) : (
          <span className="text-[var(--ink-faint)]">{hint}</span>
        )}
      </p>
    </div>
  );
}
