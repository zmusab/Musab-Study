/**
 * Placement des étiquettes de marqueurs à l'écran (§8).
 *
 * Logique PURE et déterministe, volontairement séparée du composant 3D : elle
 * ne connaît que des coordonnées écran déjà projetées, donc elle se teste sans
 * WebGL ni navigateur.
 *
 * Problème résolu : sur une région dense (14 structures sur un crâne), poser
 * chaque étiquette au centre de sa structure produit un tas illisible. Ici,
 * les étiquettes sont rejetées sur les bords, reliées à leur structure par une
 * ligne de rappel, et espacées verticalement pour ne jamais se recouvrir.
 */

export interface MarkerAnchor {
  id: string;
  /** Coordonnées écran (px) du point d'ancrage sur la structure. */
  x: number;
  y: number;
  /** `true` si l'ancre est devant la caméra et dans le cadre. */
  onScreen: boolean;
  /**
   * Importance relative — sert à choisir qui reste affiché quand il y a trop
   * d'étiquettes. En pratique : la taille apparente de la structure.
   */
  priority: number;
}

export interface PlacedLabel {
  id: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  side: 'left' | 'right';
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Nombre maximum d'étiquettes affichées simultanément. */
  maxLabels: number;
  /**
   * Espacement vertical minimal entre deux étiquettes (px). Doit rester
   * supérieur à la HAUTEUR RÉELLE d'une étiquette, sinon deux étiquettes
   * consécutives se recouvrent malgré l'espacement : les marqueurs portent
   * `data-touch-target`, qui impose 44 px de haut pour rester cliquables au
   * doigt sur iPad.
   */
  spacing?: number;
  /** Marge horizontale entre le bord du viewport et l'étiquette (px). */
  margin?: number;
  /** Marge verticale conservée en haut et en bas (px). */
  verticalPadding?: number;
  /** Toujours affichée, quel que soit son rang de priorité. */
  pinnedId?: string | null;
}

export interface LayoutResult {
  placed: PlacedLabel[];
  /** Identifiants écartés faute de place — comptés pour proposer « voir plus ». */
  hiddenIds: string[];
}

/**
 * Répartit une série de positions désirées en respectant un espacement
 * minimal, en restant aussi proche que possible des positions d'origine et
 * dans les bornes [min, max]. Deux passes : on pousse vers le bas, puis on
 * corrige le débordement en remontant depuis la fin.
 */
export function spreadPositions(desired: number[], spacing: number, min: number, max: number): number[] {
  if (desired.length === 0) return [];
  const out = [...desired];

  for (let i = 1; i < out.length; i++) {
    if (out[i]! < out[i - 1]! + spacing) out[i] = out[i - 1]! + spacing;
  }
  const overflow = out[out.length - 1]! - max;
  if (overflow > 0) {
    for (let i = 0; i < out.length; i++) out[i] = out[i]! - overflow;
  }
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i]! > out[i + 1]! - spacing) out[i] = out[i + 1]! - spacing;
  }
  // Si l'ensemble ne tient pas dans la hauteur disponible, on borne : le
  // dépassement résiduel est assumé plutôt que de superposer les étiquettes.
  for (let i = 0; i < out.length; i++) out[i] = Math.max(min, out[i]!);
  return out;
}

export function layoutMarkers(anchors: readonly MarkerAnchor[], options: LayoutOptions): LayoutResult {
  const { width, height, maxLabels, pinnedId = null } = options;
  const spacing = options.spacing ?? 48;
  const margin = options.margin ?? 8;
  const verticalPadding = options.verticalPadding ?? 14;

  const candidates = anchors.filter((a) => a.onScreen);

  // La structure sélectionnée passe toujours devant : c'est celle que
  // l'utilisateur regarde.
  const ranked = [...candidates].sort((a, b) => {
    if (pinnedId) {
      if (a.id === pinnedId) return -1;
      if (b.id === pinnedId) return 1;
    }
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id); // départage stable
  });

  const kept = ranked.slice(0, Math.max(0, maxLabels));
  const hiddenIds = ranked.slice(Math.max(0, maxLabels)).map((a) => a.id);

  const centerX = width / 2;
  const bySide = { left: [] as MarkerAnchor[], right: [] as MarkerAnchor[] };
  for (const anchor of kept) {
    (anchor.x < centerX ? bySide.left : bySide.right).push(anchor);
  }

  const placed: PlacedLabel[] = [];
  for (const side of ['left', 'right'] as const) {
    const group = bySide[side].sort((a, b) => a.y - b.y);
    const ys = spreadPositions(
      group.map((a) => a.y),
      spacing,
      verticalPadding,
      Math.max(verticalPadding, height - verticalPadding),
    );
    group.forEach((anchor, i) => {
      placed.push({
        id: anchor.id,
        anchorX: anchor.x,
        anchorY: anchor.y,
        labelX: side === 'left' ? margin : width - margin,
        labelY: ys[i]!,
        side,
      });
    });
  }

  return { placed, hiddenIds };
}
