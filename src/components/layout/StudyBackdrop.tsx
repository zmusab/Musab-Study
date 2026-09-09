/**
 * FOND D'ÉTUDE — des annotations scientifiques dans les marges.
 *
 * Le fond était une surface unie : correct, mais muet. Ces marques donnent à
 * l'application l'air d'un carnet de cours annoté plutôt que d'un outil de
 * gestion, sans jamais entrer en concurrence avec le contenu.
 *
 * Trois règles tiennent tout l'effet :
 *
 *  1. TOUT EST VRAI. Ce ne sont pas des glyphes décoratifs : la formule est
 *     bien celle de l'hydroxyapatite, le pH critique de déminéralisation de
 *     l'émail est bien 5,5, V1/V2/V3 sont bien les trois branches du
 *     trijumeau, et 18-17-16 est bien la numérotation FDI du secteur
 *     supérieur droit. Un étudiant en dentisterie les lira ; y glisser une
 *     approximation serait pire que de ne rien mettre.
 *
 *  2. ÇA RESTE UN FOND. Opacité très basse, positions dans les MARGES, jamais
 *     derrière un bloc de texte dense. `aria-hidden` et `pointer-events: none`
 *     : ni le lecteur d'écran ni le doigt ne les rencontrent.
 *
 *  3. RIEN SUR PETIT ÉCRAN. Sur iPhone il n'y a pas de marge où les poser ;
 *     elles passeraient derrière le contenu. Elles n'apparaissent qu'à partir
 *     de la largeur où le rail latéral existe déjà.
 */

interface Mark {
  text: string;
  /** Position en pourcentage du viewport — pensée pour tomber dans les marges. */
  top: string;
  left?: string;
  right?: string;
  size: string;
  rotate: string;
}

const MARKS: Mark[] = [
  { text: 'Ca₁₀(PO₄)₆(OH)₂', top: '12%', right: '3%', size: '1.05rem', rotate: '-4deg' },
  { text: 'pH 5,5', top: '27%', right: '7%', size: '0.9rem', rotate: '3deg' },
  { text: 'V₁ · V₂ · V₃', top: '44%', right: '4%', size: '1rem', rotate: '-2deg' },
  { text: 'n. trigeminus', top: '58%', right: '8%', size: '0.85rem', rotate: '5deg' },
  { text: '18 17 16 15', top: '73%', right: '5%', size: '0.95rem', rotate: '-3deg' },
  { text: 'm. masseter', top: '87%', right: '9%', size: '0.85rem', rotate: '2deg' },
];

export function StudyBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 hidden select-none overflow-hidden md:block"
    >
      {MARKS.map((mark) => (
        <span
          key={mark.text}
          className="absolute whitespace-nowrap font-serif italic text-[var(--ink)] opacity-[0.045] dark:opacity-[0.07]"
          style={{
            top: mark.top,
            left: mark.left,
            right: mark.right,
            fontSize: mark.size,
            transform: `rotate(${mark.rotate})`,
          }}
        >
          {mark.text}
        </span>
      ))}
    </div>
  );
}
