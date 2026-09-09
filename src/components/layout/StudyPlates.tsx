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
 *  - `hidden lg:block` : en dessous de 1024 px il n'y a aucune marge où les
 *    poser, elles passeraient derrière le texte.
 *
 * Le dessin est anatomiquement orienté (crâne de profil, cerveau en vue
 * latérale, molaire en coupe, arcade maxillaire à seize dents) sans prétendre
 * à la valeur d'une planche de cours : c'est un ornement, `aria-hidden`, que
 * personne ne doit réviser dessus.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Crâne de profil, orienté vers la gauche. */
function Skull() {
  return (
    <svg viewBox="0 0 180 180" className="h-full w-full" {...{ 'aria-hidden': true }}>
      <g {...STROKE}>
        {/* Voûte crânienne, du front à l'occiput. */}
        <path d="M28 86 C26 44 58 16 100 16 C144 16 172 46 170 88 C169 108 160 120 148 127" />
        {/* Front descendant vers la racine du nez. */}
        <path d="M28 86 C28 102 33 114 43 121" />
        {/* Orbite. */}
        <ellipse cx="64" cy="94" rx="18" ry="16" />
        {/* Ouverture piriforme. */}
        <path d="M90 100 L100 122 L84 126 Z" />
        {/* Arcade zygomatique. */}
        <path d="M94 106 C114 102 134 104 148 111" />
        {/* Maxillaire et ligne des dents supérieures. */}
        <path d="M52 130 C74 144 112 148 142 140" />
        {/* Mandibule. */}
        <path d="M48 128 C45 152 62 168 90 170 C120 172 142 160 150 140" />
        {/* Branche montante et condyle. */}
        <path d="M146 128 C152 138 152 152 146 160" />
      </g>
    </svg>
  );
}

/** Cerveau en vue latérale, hémisphère gauche. */
function Brain() {
  return (
    <svg viewBox="0 0 190 150" className="h-full w-full" {...{ 'aria-hidden': true }}>
      <g {...STROKE}>
        {/* Contour de l'hémisphère. */}
        <path d="M20 82 C10 50 36 20 74 14 C116 8 166 22 176 56 C184 84 166 110 132 118 C98 126 42 118 20 82 Z" />
        {/* Sillons — quelques traits, pas une carte complète. */}
        <path d="M44 46 C64 58 88 46 104 60" />
        <path d="M60 28 C74 46 100 40 114 56" />
        <path d="M88 98 C106 86 128 94 144 80" />
        <path d="M126 28 C138 46 156 44 166 62" />
        <path d="M36 66 C52 76 62 92 60 108" />
        {/* Cervelet. */}
        <path d="M132 104 C150 100 164 102 170 88" />
        {/* Tronc cérébral. */}
        <path d="M98 118 C104 130 96 140 86 142" />
      </g>
    </svg>
  );
}

/** Molaire en coupe : couronne, collet, deux racines, chambre pulpaire. */
function Molar() {
  return (
    <svg viewBox="0 0 120 170" className="h-full w-full" {...{ 'aria-hidden': true }}>
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
    <svg viewBox="0 0 180 130" className="h-full w-full" {...{ 'aria-hidden': true }}>
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
      </g>
    </svg>
  );
}

export function StudyPlates() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 hidden select-none overflow-hidden text-[var(--ink)] opacity-[0.06] lg:block dark:text-[var(--accent)] dark:opacity-[0.11]"
    >
      {/*
        Chaque planche est presque ENTIÈREMENT dans l'écran, avec un léger
        débord seulement. Une première version les enfonçait de 6 à 7 vh hors
        cadre : il n'en restait qu'une poignée d'arcs, qui ne se lisaient plus
        comme un crâne ou un cerveau mais comme des traits au hasard — la même
        erreur que les étiquettes flottantes qu'elles remplacent.
      */}

      {/*
        Crâne — en bas, juste à DROITE du rail de navigation.
        `left-0` le plaçait sous le rail, qui est opaque (`--bg-elevated`) :
        les neuf dixièmes du dessin disparaissaient derrière, et il n'en
        restait qu'un arc dépassant à droite. Le décalage vaut la largeur du
        rail (13,5 rem), qui n'existe qu'à partir de `md` — or ces planches ne
        s'affichent qu'à partir de `lg`, donc le rail est toujours là.
      */}
      <div className="absolute bottom-[3vh] left-[14.5rem] h-[36vh] w-[36vh]">
        <Skull />
      </div>

      {/* Cerveau — en haut à droite. */}
      <div className="absolute right-[1vh] top-[5vh] h-[24vh] w-[30vh]">
        <Brain />
      </div>

      {/* Arcade dentaire — en bas à droite. */}
      <div className="absolute right-[2vh] bottom-[4vh] h-[21vh] w-[29vh]">
        <DentalArch />
      </div>

      {/*
        Molaire — plus petite, à mi-hauteur à droite, entre le cerveau et
        l'arcade. À gauche elle se serait retrouvée collée au rail de
        navigation, qui est opaque : on n'en aurait vu que la moitié.
      */}
      <div className="absolute right-[1vh] top-[40vh] hidden h-[19vh] w-[13vh] xl:block">
        <Molar />
      </div>
    </div>
  );
}
