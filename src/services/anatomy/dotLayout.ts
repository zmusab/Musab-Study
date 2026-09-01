/**
 * Placement des POINTS interactifs sur le modèle 3D.
 *
 * Principe : le modèle reste propre. Chaque structure disponible porte un
 * petit point à sa position réelle — pas une étiquette texte. Le nom
 * n'apparaît que pour le point sélectionné (ou survolé), avec une ligne de
 * rappel courte.
 *
 * Deux problèmes concrets sont réglés ici, et uniquement ici, en logique
 * PURE (aucune dépendance à Three.js ni au DOM, donc testable sans WebGL) :
 *
 *  1. **Densité.** Sur un crâne, une centaine d'ancres tombent dans quelques
 *     centaines de pixels. Poser un point par structure donnerait une bouillie
 *     inclickable. Les points trop proches sont donc REGROUPÉS : un seul point
 *     reste, et il porte le nombre de structures qu'il masque (« +N »).
 *  2. **Placement du nom.** L'étiquette du point sélectionné doit rester dans
 *     le cadre, du côté où il y a de la place.
 *
 * Rien n'est inventé : un point n'existe que si une structure réelle du
 * catalogue lui correspond, et un regroupement ne fait que masquer des points
 * réels — il n'en crée jamais.
 */

export interface DotAnchor {
  id: string;
  /** Coordonnées écran (px) du centre de la structure. */
  x: number;
  y: number;
  /** `true` si l'ancre est devant la caméra et dans le cadre. */
  onScreen: boolean;
  /** Importance relative — en pratique la taille apparente de la structure. */
  priority: number;
}

export interface PlacedDot {
  id: string;
  x: number;
  y: number;
  /** Structures regroupées sous ce point (hors `id`) — d'où le « +N ». */
  merged: string[];
}

export interface DotLayoutOptions {
  width: number;
  height: number;
  /**
   * Distance minimale entre deux points (px). Doit rester au moins égale au
   * diamètre de la cible tactile, sinon deux points voisins deviennent
   * impossibles à distinguer au doigt sur iPad.
   */
  minDistance?: number;
  /** Plafond de points affichés — garde-fou de lisibilité et de coût DOM. */
  maxDots?: number;
  /**
   * Toujours conservés comme points à part entière, jamais fondus dans un
   * groupe. Plusieurs sont nécessaires : la correction du mode apprentissage
   * doit montrer EN MÊME TEMPS la bonne structure et la réponse cliquée.
   */
  pinnedIds?: readonly (string | null | undefined)[];
}

export const DEFAULT_MIN_DISTANCE = 30;
export const DEFAULT_MAX_DOTS = 60;

/**
 * Regroupe les ancres trop proches. Les structures les plus grandes portent
 * le point du groupe : ce sont elles qu'on vise naturellement à l'écran.
 */
export function layoutDots(anchors: readonly DotAnchor[], options: DotLayoutOptions): PlacedDot[] {
  const minDistance = options.minDistance ?? DEFAULT_MIN_DISTANCE;
  const maxDots = options.maxDots ?? DEFAULT_MAX_DOTS;
  const pinned = new Set((options.pinnedIds ?? []).filter((id): id is string => Boolean(id)));
  const minSquared = minDistance * minDistance;

  const visible = anchors.filter((a) => a.onScreen);

  // Ordre déterministe : la sélection d'abord (elle doit rester un point
  // distinct), puis la taille apparente, puis l'identifiant pour que deux
  // structures de même taille ne changent jamais de place d'une image à
  // l'autre.
  const ranked = [...visible].sort((a, b) => {
    const pa = pinned.has(a.id) ? 1 : 0;
    const pb = pinned.has(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });

  const dots: PlacedDot[] = [];
  for (const anchor of ranked) {
    if (pinned.has(anchor.id)) {
      dots.push({ id: anchor.id, x: anchor.x, y: anchor.y, merged: [] });
      continue;
    }

    let nearest: PlacedDot | null = null;
    let nearestDistance = Infinity;
    for (const dot of dots) {
      const d = (dot.x - anchor.x) ** 2 + (dot.y - anchor.y) ** 2;
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = dot;
      }
    }

    // Trop proche d'un point déjà posé, ou plafond atteint : on fusionne dans
    // le point le plus proche plutôt que de perdre la structure.
    if (nearest && (nearestDistance < minSquared || dots.length >= maxDots)) {
      nearest.merged.push(anchor.id);
      continue;
    }
    dots.push({ id: anchor.id, x: anchor.x, y: anchor.y, merged: [] });
  }

  return dots;
}

export interface LabelPlacement {
  x: number;
  y: number;
  side: 'left' | 'right';
}

/**
 * Place l'étiquette d'UN point (le sélectionné ou le survolé) : à droite si
 * la place suffit, à gauche sinon, et toujours dans le cadre.
 */
export function placeDotLabel(
  dot: { x: number; y: number },
  options: { width: number; height: number; labelWidth: number; labelHeight: number; offset?: number },
): LabelPlacement {
  const offset = options.offset ?? 18;
  const margin = 8;
  const fitsRight = dot.x + offset + options.labelWidth + margin <= options.width;
  const side: 'left' | 'right' = fitsRight ? 'right' : 'left';
  const rawX = side === 'right' ? dot.x + offset : dot.x - offset - options.labelWidth;
  const x = Math.min(Math.max(margin, rawX), Math.max(margin, options.width - options.labelWidth - margin));
  const y = Math.min(
    Math.max(margin + options.labelHeight / 2, dot.y),
    Math.max(margin + options.labelHeight / 2, options.height - options.labelHeight / 2 - margin),
  );
  return { x, y, side };
}
