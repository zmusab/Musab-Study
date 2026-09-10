/**
 * PLANCHES DE FOND — crâne, cerveau, molaire, arcade dentaire.
 *
 * Historique de ce fichier, parce qu'il explique sa forme :
 *
 *  1. Une première version posait six ÉTIQUETTES de texte (« pH 5,5 »,
 *     « n. trigeminus »…) à des positions fixes du viewport. Rejeté, et à
 *     raison : de petits mots flottant dans le vide ne se rattachent à rien,
 *     chevauchent le bord des cartes, et sur un écran peu rempli ressemblent
 *     à des débris tombés au milieu de la page.
 *  2. Le quadrillage de cahier a remplacé l'aplat (voir `styles/index.css`).
 *     Il donne la SURFACE, mais une page de cahier vierge reste vierge.
 *  3. Ce fichier ajoute ce qui manquait : de vraies planches, comme celles
 *     imprimées en filigrane sur un cahier d'anatomie.
 *
 * Ce qui les distingue de la tentative ratée :
 *
 *  - Elles sont GRANDES (30 à 46 vh) et peu nombreuses (trois). Un dessin
 *    reconnaissable se lit comme une intention ; six petits mots éparpillés se
 *    lisent comme un accident.
 *  - Elles sont ancrées aux COINS et débordent volontairement hors de l'écran,
 *    à la manière d'un filigrane d'imprimeur. Aucune ne peut donc se retrouver
 *    isolée au milieu d'une zone vide.
 *  - Le trait seul, jamais de remplissage, à très basse opacité : elles
 *    passent DERRIÈRE les cartes, qui sont opaques, et n'apparaissent que dans
 *    les marges et les zones libres.
 *  - SEUIL D'AFFICHAGE. Les planches principales apparaissent dès `md`
 *    (768 px). Les trois planches de la colonne latérale — molaire, formules
 *    de l'application, lois de physique — étaient à `xl`, soit 1280 px.
 *    Un iPad Pro 11 en PAYSAGE fait 1194 px : elles ne s'affichaient donc
 *    JAMAIS sur l'appareil de travail, et « les calculs n'apparaissent
 *    toujours pas » était exact. Elles sont à `lg` (1024 px), seuil auquel la
 *    colonne latérale existe réellement.
 *
 * Le dessin est anatomiquement orienté (crâne de profil, cerveau en vue
 * latérale, molaire en coupe, arcade maxillaire à seize dents) sans prétendre
 * à la valeur d'une planche de cours : c'est un ornement, `aria-hidden`, que
 * personne ne doit réviser dessus.
 */

import type { ReactNode } from 'react';

/**
 * PLANCHES FOURNIES — une vraie image l'emporte toujours sur un dessin.
 *
 * Les dessins de ce fichier sont un DÉFAUT, pas un choix : ils existent pour
 * que le fond ne soit pas nu tant qu'aucune planche n'a été fournie. Dès
 * qu'un fichier `crane`, `cerveau`, `dent` ou `arcade` est déposé dans
 * `src/assets/plates/`, c'est lui qui s'affiche, sans une ligne de code à
 * changer (voir le README de ce dossier).
 *
 * La résolution se fait à la COMPILATION (`import.meta.glob`), jamais au
 * chargement : pas de requête vers un fichier absent, donc pas de 404 dans la
 * console, et les images fournies sont hachées et pré-mises en cache par le
 * service worker comme le reste des ressources.
 */
const PLATE_FILES = import.meta.glob('/src/assets/plates/*.{svg,png,webp,avif,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

type PlateSlot = 'crane' | 'cerveau' | 'dent' | 'arcade';

function suppliedPlate(slot: PlateSlot): string | null {
  for (const [path, url] of Object.entries(PLATE_FILES)) {
    const base = path.split('/').pop() ?? '';
    if (base.replace(/\.[^.]+$/, '').toLowerCase() === slot) return url;
  }
  return null;
}

/**
 * Affiche la planche fournie si elle existe, sinon le dessin de secours.
 *
 * L'image est ramenée au MONOCHROME : le fond est un filigrane à ~8 %
 * d'opacité, et une planche en couleurs y deviendrait une tache. En thème
 * sombre elle est aussi inversée, pour que les traits noirs d'une planche
 * imprimée ressortent en clair comme le reste du dessin.
 */
function Plate({ slot, children }: { slot: PlateSlot; children: ReactNode }) {
  const url = suppliedPlate(slot);
  if (url === null) return <>{children}</>;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      className="h-full w-full object-contain [filter:grayscale(1)_contrast(1.15)] dark:[filter:grayscale(1)_contrast(1.15)_invert(1)]"
    />
  );
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * LÉGENDE — ce qui fait la différence entre un dessin et un SCHÉMA.
 *
 * Un contour au trait montre une forme ; un schéma NOMME ses parties. C'est
 * exactement le reproche fait à la version précédente de ce fichier (« t'as
 * mis juste des dessins »).
 *
 * Et c'est l'inverse de la toute première tentative, rejetée elle aussi : ces
 * mots ne FLOTTENT pas. Chacun part d'un point précis du dessin, suivi d'une
 * ligne de rappel et d'un petit disque de repère — comme une planche
 * d'anatomie. Un mot rattaché à un trait se lit comme une annotation ; un mot
 * posé dans le vide se lit comme un débris.
 *
 * Les termes sont ceux du cours (latin anatomique ou français), jamais
 * approximatifs : le fond d'un outil de dentisterie ne peut pas afficher une
 * dénomination fausse, même en filigrane.
 */
function Label({
  from,
  to,
  text,
  anchor = 'start',
}: {
  /** Point du dessin que la légende désigne. */
  from: [number, number];
  /** Extrémité de la ligne de rappel, où se pose le texte. */
  to: [number, number];
  text: string;
  anchor?: 'start' | 'end';
}) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  return (
    <g>
      <circle cx={x1} cy={y1} r={1.8} fill="currentColor" stroke="none" />
      <path
        d={`M${x1} ${y1} L${x2} ${y2}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.9}
        strokeLinecap="round"
      />
      <text
        x={anchor === 'start' ? x2 + 3 : x2 - 3}
        y={y2 + 3}
        textAnchor={anchor}
        fill="currentColor"
        stroke="none"
        fontSize={8}
        fontStyle="italic"
        fontFamily="var(--font-serif, Georgia, serif)"
      >
        {text}
      </text>
    </g>
  );
}

/**
 * COTE — la double flèche des planches techniques. Elle dit qu'une dimension a
 * été mesurée, ce qu'aucun contour ne peut exprimer seul.
 */
function Dimension({ from, to, text }: { from: [number, number]; to: [number, number]; text: string }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  return (
    <g stroke="currentColor" strokeWidth={0.9} fill="none">
      <path d={`M${x1} ${y1} L${x2} ${y2}`} />
      <path d={`M${x1 - 3} ${y1} L${x1 + 3} ${y1}`} />
      <path d={`M${x2 - 3} ${y2} L${x2 + 3} ${y2}`} />
      <text
        x={x1 + 6}
        y={(y1 + y2) / 2 + 3}
        fill="currentColor"
        stroke="none"
        fontSize={7.5}
        fontStyle="italic"
        fontFamily="var(--font-serif, Georgia, serif)"
      >
        {text}
      </text>
    </g>
  );
}

/**
 * HACHURES — le remplissage conventionnel d'une COUPE. Sans elles, une dent
 * en coupe ressemble à une dent vue de face avec des traits en trop : c'est la
 * hachure qui dit « ce plan est tranché ».
 */
function Hatching({ id, angle = 45, gap = 4 }: { id: string; angle?: number; gap?: number }) {
  return (
    <pattern
      id={id}
      width={gap}
      height={gap}
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${angle})`}
    >
      <line x1="0" y1="0" x2="0" y2={gap} stroke="currentColor" strokeWidth={0.7} />
    </pattern>
  );
}

/**
 * CRÂNE DE PROFIL, tourné vers la gauche.
 *
 * Le viewBox est volontairement plus large que le dessin : les légendes
 * doivent tenir DEDANS. Une version précédente les envoyait vers l'extérieur
 * et le SVG les coupait — « orbita » s'affichait « bita », ce qui est pire que
 * pas de légende du tout.
 *
 * Repères du profil, de haut en bas : voûte, os frontal descendant vers la
 * glabelle, orbite, ouverture piriforme, arcade zygomatique, maxillaire,
 * mandibule avec sa branche montante et son condyle.
 */
function Skull() {
  return (
    <svg viewBox="-62 8 402 200" className="h-full w-full" {...{ 'aria-hidden': true }}>
      <g {...STROKE}>
        {/*
          VUE ANTÉRIEURE, et non plus de profil — décision prise après quatre
          tentatives de profil qui se lisaient toutes comme un disque.
          Le profil d'un crâne repose sur des rapports de courbure subtils :
          raté de peu, il devient une forme ronde quelconque. La vue de face
          repose au contraire sur quatre repères francs et symétriques —
          deux orbites, l'ouverture piriforme, les pommettes, le menton — que
          l'œil identifie immédiatement, même à 8 % d'opacité derrière le
          contenu. C'est aussi la vue sous laquelle un étudiant en dentisterie
          voit son patient.
        */}
        {/* Contour : voûte, temporal resserré, pommettes larges, menton étroit. */}
        <path
          d="M140 28
             C100 28 76 56 76 96
             C76 116 82 130 92 140
             C96 152 100 161 104 169
             C110 183 122 191 140 191
             C158 191 170 183 176 169
             C180 161 184 152 188 140
             C198 130 204 116 204 96
             C204 56 180 28 140 28 Z"
        />
        {/* Orbites. */}
        <ellipse cx="112" cy="92" rx="18" ry="16" />
        <ellipse cx="168" cy="92" rx="18" ry="16" />
        {/* Ouverture piriforme, en cœur inversé. */}
        <path d="M140 112 C133 122 128 130 128 136 C128 141 133 144 140 144 C147 144 152 141 152 136 C152 130 147 122 140 112 Z" />
        {/* Os zygomatiques. */}
        <path d="M90 106 C97 116 104 122 112 124" />
        <path d="M190 106 C183 116 176 122 168 124" />
        {/* Arcade dentaire supérieure, puis la mandibule en dessous. */}
        <path d="M108 156 C124 164 156 164 172 156" />
        <path d="M106 164 C122 174 158 174 174 164" strokeDasharray="3 3" opacity={0.7} />
        {/* Symphyse mentonnière. */}
        <path d="M140 176 V190" opacity={0.7} />
        {/* Suture métopique — l'axe de symétrie, repère de planche. */}
        <path d="M140 28 V72" strokeDasharray="3 4" opacity={0.6} />
      </g>
      <g opacity={0.9}>
        <Label from={[112, 92]} to={[30, 66]} text="orbita" anchor="end" />
        <Label from={[190, 108]} to={[262, 88]} text="os zygomaticum" />
        <Label from={[140, 130]} to={[26, 138]} text="apert. piriformis" anchor="end" />
        <Label from={[150, 186]} to={[236, 200]} text="mandibula" />
      </g>
    </svg>
  );
}

/**
 * CERVEAU en vue latérale, hémisphère gauche. Même règle que le crâne : le
 * cadre est plus large que le dessin pour que les légendes ne soient pas
 * rognées.
 */
function Brain() {
  return (
    <svg viewBox="-40 0 380 190" className="h-full w-full" {...{ 'aria-hidden': true }}>
      <g {...STROKE}>
        {/* Contour de l'hémisphère. */}
        <path d="M62 100 C52 68 78 38 116 32 C158 26 208 40 218 74 C226 102 208 128 174 136 C140 144 84 136 62 100 Z" />
        {/* Sillons — quelques traits, pas une carte complète. */}
        <path d="M86 64 C106 76 130 64 146 78" />
        <path d="M102 46 C116 64 142 58 156 74" />
        <path d="M130 116 C148 104 170 112 186 98" />
        <path d="M168 46 C180 64 198 62 208 80" />
        <path d="M78 84 C94 94 104 110 102 126" />
        {/* Scissure de Sylvius — le repère majeur d'une vue latérale. */}
        <path d="M78 106 C104 96 138 100 160 112" strokeDasharray="4 4" opacity={0.7} />
        {/* Cervelet. */}
        <path d="M174 122 C192 118 206 120 212 106" />
        {/* Tronc cérébral. */}
        <path d="M140 136 C146 148 138 158 128 160" />
      </g>
      <g opacity={0.9}>
        <Label from={[94, 58]} to={[36, 38]} text="lobus frontalis" anchor="end" />
        <Label from={[190, 58]} to={[248, 42]} text="lobus parietalis" />
        <Label from={[194, 118]} to={[246, 142]} text="cerebellum" />
        <Label from={[134, 150]} to={[62, 170]} text="truncus cerebri" anchor="end" />
      </g>
    </svg>
  );
}

/**
 * MOLAIRE EN COUPE — la planche la plus « schéma » des quatre.
 *
 * Les hachures ne sont pas décoratives : ce sont elles qui disent que le plan
 * est TRANCHÉ. Sans elles, les traits de la chambre pulpaire et des canaux se
 * lisent comme des lignes de surface sur une dent vue de face.
 *
 * Trois trames d'inclinaisons différentes, comme sur une planche imprimée :
 * l'émail, la dentine et la pulpe ne se confondent pas.
 */
function Molar() {
  return (
    <svg viewBox="-46 -8 212 190" className="h-full w-full" {...{ 'aria-hidden': true }}>
      <defs>
        <Hatching id="plate-enamel" angle={45} gap={3.2} />
        <Hatching id="plate-dentin" angle={-45} gap={5} />
        <Hatching id="plate-pulp" angle={90} gap={3} />
      </defs>

      {/* Zones hachurées, POSÉES AVANT les contours pour que le trait reste net. */}
      <g stroke="none" opacity={0.75}>
        {/* Émail : la coiffe de la couronne, jusqu'au collet. */}
        <path
          d="M18 68 C17 40 26 22 40 16 Q50 28 60 19 Q70 28 80 16 C94 22 103 40 102 68 L92 68 C93 44 86 30 76 26 Q60 38 44 26 C34 30 27 44 28 68 Z"
          fill="url(#plate-enamel)"
        />
        {/* Dentine : tout le corps de la dent, chambre pulpaire évidée. */}
        <path
          d="M28 68 C29 44 34 30 44 26 Q60 38 76 26 C86 30 91 44 92 68 L28 68 Z M44 42 Q60 54 76 42 L73 64 Q60 70 47 64 Z"
          fill="url(#plate-dentin)"
          fillRule="evenodd"
        />
        {/* Pulpe : la chambre elle-même. */}
        <path d="M44 42 Q60 54 76 42 L73 64 Q60 70 47 64 Z" fill="url(#plate-pulp)" />
      </g>

      <g {...STROKE}>
        {/* Couronne, avec le creux entre les deux cuspides. */}
        <path d="M18 68 C17 40 26 22 40 16 Q50 28 60 19 Q70 28 80 16 C94 22 103 40 102 68" />
        {/* Collet. */}
        <path d="M18 68 H102" />
        {/* Racine mésiale. */}
        <path d="M22 68 C24 106 34 134 42 156 C48 134 55 104 55 68" />
        {/* Racine distale. */}
        <path d="M65 68 C65 104 72 134 78 156 C86 134 96 106 98 68" />
        {/* Chambre pulpaire. */}
        <path d="M44 42 Q60 54 76 42 L73 64 Q60 70 47 64 Z" />
        {/* Canaux radiculaires. */}
        <path d="M50 68 C50 98 46 124 42 144" />
        <path d="M70 68 C70 98 74 124 78 144" />
      </g>
      <g opacity={0.9}>
        <Label from={[24, 34]} to={[-16, 22]} text="émail" anchor="end" />
        <Label from={[96, 54]} to={[126, 40]} text="dentine" />
        <Label from={[60, 52]} to={[124, 78]} text="pulpe" />
        <Label from={[78, 128]} to={[122, 148]} text="canal" />
        {/* La longueur de travail : une vraie cote, une vraie valeur de cours. */}
        <Dimension from={[-38, 16]} to={[-38, 156]} text="≈ 22 mm" />
      </g>
    </svg>
  );
}

/**
 * Arcade maxillaire — seize dents réparties sur une parabole.
 *
 * Les positions sont CALCULÉES plutôt que dessinées à la main : seize
 * rectangles arrondis placés à la main auraient dérivé, et la denture aurait
 * eu l'air de travers exactement là où un étudiant en dentisterie le
 * remarquerait.
 */
function DentalArch() {
  const teeth = Array.from({ length: 16 }, (_, index) => {
    // t va de -1 (dernière molaire d'un côté) à +1 (de l'autre).
    const t = (index / 15) * 2 - 1;
    const x = 90 + t * 74;
    const y = 26 + t * t * 82;
    // Chaque dent pointe vers le centre de l'arcade.
    const angle = (Math.atan2(2 * 82 * t, 74) * 180) / Math.PI;
    // Incisives étroites au centre, molaires larges au fond.
    const width = 7 + Math.abs(t) * 6;
    const height = 11 + Math.abs(t) * 3;
    return { x, y, angle, width, height, key: index };
  });

  return (
    <svg viewBox="-56 -14 336 164" className="h-full w-full" {...{ 'aria-hidden': true }}>
      <g {...STROKE}>
        {teeth.map((tooth) => (
          <rect
            key={tooth.key}
            x={tooth.x - tooth.width / 2}
            y={tooth.y - tooth.height / 2}
            width={tooth.width}
            height={tooth.height}
            rx={3}
            transform={`rotate(${tooth.angle} ${tooth.x} ${tooth.y})`}
          />
        ))}
        {/* Ligne de l'arcade, en pointillé : c'est un repère, pas un os. */}
        <path d="M16 108 Q90 -6 164 108" strokeDasharray="4 6" opacity={0.7} />
        {/* Ligne médiane — l'axe qui sépare les deux quadrants. */}
        <path d="M90 4 V126" strokeDasharray="3 5" opacity={0.6} />
      </g>
      {/* Numérotation ISO des quadrants maxillaires, et les trois familles
          de dents nommées : c'est la lecture d'une planche, pas d'un dessin. */}
      <g opacity={0.85}>
        <Label from={[74, 26]} to={[-6, 2]} text="incisives" anchor="end" />
        <Label from={[132, 56]} to={[194, 34]} text="prémolaires" />
        <Label from={[164, 104]} to={[196, 130]} text="molaires" />
        <text
          x={62}
          y={120}
          fill="currentColor"
          stroke="none"
          fontSize={9}
          fontStyle="italic"
          fontFamily="var(--font-serif, Georgia, serif)"
        >
          1
        </text>
        <text
          x={114}
          y={120}
          fill="currentColor"
          stroke="none"
          fontSize={9}
          fontStyle="italic"
          fontFamily="var(--font-serif, Georgia, serif)"
        >
          2
        </text>
      </g>
    </svg>
  );
}

/**
 * PLANCHE DE CALCULS — les formules réellement utilisées par l'application,
 * écrites comme dans la marge d'un cahier.
 *
 * Ce ne sont pas des équations d'ambiance : chacune est celle qu'un module du
 * projet applique vraiment — l'intervalle SM-2 et ses paliers, la pondération
 * BM25 de la recherche, la courbe d'oubli qui sous-tend « Progression », la
 * formule de l'hydroxyapatite et le pH critique de déminéralisation. Écrire
 * ici une formule fausse ou décorative dans un outil de dentisterie serait
 * exactement le genre de détail qu'un étudiant remarque.
 */
function Calculations() {
  const lines = [
    'I(n) = I(n−1) × EF',
    'EF ∈ [1,3 ; 3,2]',
    '1 · 3 · 7 · 14 · 30 · 60 j',
    'R = e^(−t / S)',
    'BM25 : k₁ = 1,5 ; b = 0,75',
    'Ca₁₀(PO₄)₆(OH)₂',
    'pH critique ≈ 5,5',
  ];
  return (
    <svg viewBox="0 0 150 130" className="h-full w-full" {...{ 'aria-hidden': true }}>
      {/* Filet de marge, comme sur une page de cahier. */}
      <path d="M6 2 V128" stroke="currentColor" strokeWidth={0.9} fill="none" opacity={0.7} />
      <g fill="currentColor" stroke="none" fontFamily="var(--font-serif, Georgia, serif)" fontStyle="italic">
        {lines.map((line, index) => (
          <text key={line} x={13} y={14 + index * 17} fontSize={9.5}>
            {line}
          </text>
        ))}
      </g>
      {/* Accolade de regroupement — le geste d'un cahier de notes. */}
      <path
        d="M142 8 C147 8 147 14 147 30 C147 46 150 46 150 46 C150 46 147 46 147 62 C147 78 142 78 142 78"
        fill="none"
        stroke="currentColor"
        strokeWidth={0.9}
        opacity={0.6}
      />
    </svg>
  );
}

/**
 * PLANCHE DE PHYSIQUE — les lois qui gouvernent réellement ce qu'un dentiste
 * manipule.
 *
 * Aucune n'est décorative et aucune n'est inventée : ce sont des lois
 * établies, écrites sous leur forme standard, avec la grandeur qu'elles
 * décrivent et le domaine de dentisterie ou de physiologie où elles servent.
 * Dans un outil d'étude, une formule fausse en filigrane serait pire
 * qu'un fond vide — un étudiant finit par la lire, et par la retenir.
 *
 * Les valeurs numériques citées sont des ordres de grandeur classiques de
 * la littérature (module de Young de l'émail et de la dentine, pKa du
 * couple bicarbonate), signalés comme approximatifs par le signe ≈.
 */
function Physics() {
  const laws: readonly { name: string; formula: string; note: string }[] = [
    { name: 'Beer–Lambert', formula: 'I = I₀ · e^(−μx)', note: 'atténuation des rayons X' },
    { name: 'Bragg', formula: 'n λ = 2 d sin θ', note: 'diffraction, hydroxyapatite' },
    { name: 'Young', formula: 'E = σ / ε', note: 'émail ≈ 84 GPa · dentine ≈ 18 GPa' },
    { name: 'Contrainte', formula: 'σ = F / A', note: 'charge occlusale' },
    { name: 'Henderson–Hasselbalch', formula: 'pH = pKa + log([A⁻]/[AH])', note: 'tampon salivaire, pKa ≈ 6,1' },
    { name: 'Nernst', formula: 'E = (RT / zF) · ln(Cₑ / Cᵢ)', note: 'potentiel de membrane' },
    { name: 'Fick', formula: 'J = −D · (dC/dx)', note: 'diffusion à travers la dentine' },
    { name: 'Poiseuille', formula: 'Q = π ΔP r⁴ / (8 η L)', note: 'écoulement, canal radiculaire' },
    { name: 'Planck', formula: 'E = h ν = h c / λ', note: 'h = 6,626 × 10⁻³⁴ J·s' },
    { name: 'Décroissance', formula: 'N(t) = N₀ e^(−λt)', note: 't½ = ln 2 / λ' },
  ];

  const LINE = 20;
  const height = 12 + laws.length * LINE;

  return (
    <svg viewBox={`0 0 300 ${height}`} className="h-full w-full" {...{ 'aria-hidden': true }}>
      {/* Filet de marge, comme sur une page de cahier. */}
      <path d={`M6 2 V${height - 2}`} stroke="currentColor" strokeWidth={0.9} fill="none" opacity={0.7} />
      <g fill="currentColor" stroke="none" fontFamily="var(--font-serif, Georgia, serif)">
        {laws.map((law, index) => {
          const y = 14 + index * LINE;
          return (
            <g key={law.name}>
              {/* Le nom de la loi, droit : c'est une étiquette, pas une variable. */}
              <text x={13} y={y} fontSize={7} letterSpacing="0.06em">
                {law.name.toUpperCase()}
              </text>
              <text x={13} y={y + 9} fontSize={9} fontStyle="italic">
                {law.formula}
              </text>
              {/*
                Ce que la loi sert à calculer ICI — sans quoi une formule n'est
                qu'un alignement de symboles. La colonne est posée à 160, pas
                132 : en serif italique, « pH = pKa + log([A⁻]/[AH]) » dépassait
                et les deux textes se chevauchaient.
              */}
              <text x={160} y={y + 9} fontSize={6.5} fontStyle="italic" opacity={0.75}>
                {law.note}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export function StudyPlates() {
  return (
    <div
      aria-hidden
      /*
       * PLUS REMPLI, ET PLUS TÔT.
       *
       * Deux corrections au même reproche (« dans le fond t'as mis juste des
       * dessins alors que je voudrai des schémas et un peu plus remplis ») :
       *  - `md` au lieu de `lg` : l'iPad EN PORTRAIT fait 834 px et n'en
       *    voyait donc AUCUNE. C'est pourtant l'appareil de travail — le fond
       *    y était nu.
       *  - une planche de plus (les formules réellement appliquées par
       *    l'application) et une opacité relevée d'un cran, sans jamais passer
       *    devant les cartes, qui restent opaques.
       */
      className="pointer-events-none fixed inset-0 -z-10 hidden select-none overflow-hidden text-[var(--ink)] opacity-[0.085] md:block dark:text-[var(--accent)] dark:opacity-[0.14]"
    >
      {/*
        Chaque planche est presque ENTIÈREMENT dans l'écran, avec un léger
        débord seulement. Une première version les enfonçait de 6 à 7 vh hors
        cadre : il n'en restait qu'une poignée d'arcs, qui ne se lisaient plus
        comme un crâne ou un cerveau mais comme des traits au hasard — la même
        erreur que les étiquettes flottantes qu'elles remplacent.

        Le décalage à gauche vaut la largeur du rail de navigation (13,5 rem),
        qui est opaque : posée dessous, une planche y disparaîtrait aux neuf
        dixièmes.
      */}

      {/* Crâne — en bas, juste à droite du rail. */}
      <div className="absolute bottom-[2vh] left-[13.4rem] h-[38vh] w-[62vh]">
        <Plate slot="crane">
          <Skull />
        </Plate>
      </div>

      {/* Cerveau — en haut à droite. */}
      <div className="absolute right-[1vh] top-[3vh] h-[24vh] w-[44vh]">
        <Plate slot="cerveau">
          <Brain />
        </Plate>
      </div>

      {/* Arcade dentaire — en bas à droite. */}
      <div className="absolute right-[1vh] bottom-[3vh] h-[22vh] w-[42vh]">
        <Plate slot="arcade">
          <DentalArch />
        </Plate>
      </div>

      {/*
        Molaire en coupe — à mi-hauteur à droite, entre le cerveau et l'arcade.
        À gauche elle serait collée au rail opaque : on n'en verrait que la
        moitié.
      */}
      <div className="absolute right-[2vh] top-[38vh] hidden h-[22vh] w-[24vh] lg:block">
        <Plate slot="dent">
          <Molar />
        </Plate>
      </div>

      {/*
        Formules de l'application — en haut, contre le rail. C'est une planche
        faite de texte : elle a besoin d'une zone calme, et le haut de page est
        occupé par l'en-tête, qui est étroit.
      */}
      <div className="absolute left-[14.5rem] top-[4vh] hidden h-[19vh] w-[22vh] lg:block">
        <Calculations />
      </div>

      {/*
        Lois de physique — la BANDE MÉDIANE À GAUCHE, seule zone de la page qui
        restait vide : entre l'en-tête (en haut) et le crâne (en bas), le
        contenu est centré et laisse là une colonne entière inoccupée.
        Elle n'apparaît qu'à partir de `xl` : en dessous, cette colonne
        n'existe pas et la planche passerait sous le texte.
      */}
      <div className="absolute left-[14.5rem] top-[26vh] hidden h-[46vh] w-[34vh] lg:block">
        <Physics />
      </div>
    </div>
  );
}
