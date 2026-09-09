import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * APPARITION AU DÉFILEMENT — et pourquoi le montage ne suffisait pas.
 *
 * Les barres, les graphiques et les anneaux de « Progression » s'animaient
 * déjà, mais tous au MONTAGE de la page. Sur un écran de 6 000 px, cela veut
 * dire que l'animation du bas de page s'est jouée — et terminée — pendant que
 * l'utilisateur regardait encore le haut. Le mouvement existait dans le code,
 * jamais à l'écran.
 *
 * Ce module déclenche l'animation quand l'élément ENTRE dans la fenêtre.
 *
 * Deux garde-fous non négociables :
 *
 *  1. Une animation ne porte JAMAIS une valeur. Un bloc masqué reste dans le
 *     DOM avec son texte exact (on n'anime qu'`opacity` et `transform`) : un
 *     pourcentage qui vaudrait « 0 % » tant qu'on n'a pas fait défiler serait
 *     un mensonge, pas un effet.
 *  2. Un repli temporisé. Si l'`IntersectionObserver` n'existe pas ou ne se
 *     déclenche jamais (élément dans un conteneur masqué, navigateur exotique),
 *     tout devient visible au bout de 1,2 s. Une page blanche par faute
 *     d'observateur serait une régression bien pire que l'absence d'effet.
 */

/*
 * Filet de sécurité, pas minuterie de révélation.
 *
 * Une première version armait ce délai à 1,2 s dans TOUS les cas — ce qui
 * annulait l'effet recherché : au bout d'une seconde et demie, les huit
 * sections de la page étaient révélées, y compris celles situées quatre écrans
 * plus bas, et le défilement ne déclenchait donc plus rien. Le repli ne doit
 * couvrir que la panne : un `IntersectionObserver` qui n'existe pas (traité
 * séparément, immédiatement) ou qui ne se déclenche jamais. Dix secondes sans
 * la moindre intersection : quelque chose ne va pas, on montre le contenu.
 */
const FALLBACK_MS = 10_000;

/**
 * `true` dès que l'élément a été vu une fois — et jamais remis à `false` :
 * une donnée ne doit pas se ré-animer à chaque aller-retour de défilement.
 */
export function useSeen<T extends Element = HTMLElement>(): readonly [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;

    // Navigateur sans `IntersectionObserver` : rien à observer, tout est
    // visible tout de suite. Mieux vaut perdre l'effet que le contenu.
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }

    if (!node) return;

    const timer = window.setTimeout(() => setSeen(true), FALLBACK_MS);

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      // Seuil 0 : un seul pixel visible suffit. Un seuil en pourcentage ne se
      // déclencherait jamais sur un bloc plus haut que la fenêtre.
      { threshold: 0 },
    );
    observer.observe(node);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [node, seen]);

  return [setNode, seen] as const;
}

/**
 * Visibilité EN CONTINU, contrairement à `useSeen` : passe à `false` quand
 * l'élément ressort de la fenêtre. C'est ce qui fait qu'une section
 * s'estompe quand on remonte, et réapparaît quand on redescend.
 *
 * La marge basse négative retarde légèrement l'entrée : un bloc n'apparaît
 * qu'une fois franchement dans l'écran, pas dès que son premier pixel pointe.
 */
export function useInView<T extends Element = HTMLElement>(): readonly [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setInView(entry.isIntersecting);
      },
      { threshold: 0, rootMargin: '0px 0px -6% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, inView] as const;
}

/**
 * Bloc qui monte en fondu à son entrée dans la fenêtre, et s'estompe quand il
 * en ressort. À réserver aux SECTIONS : appliqué à chaque ligne d'une liste,
 * l'effet devient un défilé.
 *
 * L'estompage au retour n'est PAS un masquage : le texte reste dans le DOM,
 * seule l'opacité descend — et jamais à zéro. Un bloc entièrement invisible
 * en remontant donnerait l'impression que le contenu a disparu.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as = 'section',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Balise rendue — `section` par défaut, pour ne pas perdre le repère
      structurel des blocs qu'on enveloppe. */
  as?: 'div' | 'section';
}) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLElement>();
  const [seenRef, seen] = useSeen<HTMLElement>();
  const Component = as === 'section' ? motion.section : motion.div;

  // Deux observateurs sur le même nœud : l'un dit « déjà vu » (première
  // entrée, avec son filet de sécurité), l'autre « visible en ce moment ».
  const attach = (node: HTMLElement | null) => {
    ref(node);
    seenRef(node);
  };

  // Avant la toute première apparition : effacé et décalé vers le bas. Ensuite,
  // en remontant : simplement estompé, sans redescendre — un bloc qui replonge
  // vers le bas quand on remonte donne un mouvement à contresens du doigt.
  const hidden = seen ? { opacity: 0.15, y: 0 } : { opacity: 0, y: reduced ? 0 : 16 };

  return (
    <Component
      ref={attach}
      className={className}
      initial={false}
      animate={inView ? { opacity: 1, y: 0 } : hidden}
      transition={
        reduced
          ? { duration: 0 }
          : { duration: inView ? 0.5 : 0.35, delay: inView ? delay : 0, ease: [0.22, 1, 0.36, 1] }
      }
    >
      {children}
    </Component>
  );
}

/**
 * CASCADE D'UNE LISTE, déclenchée à l'entrée de la liste dans la fenêtre.
 *
 * `Reveal` anime un bloc entier ; appliqué à chaque ligne il faudrait autant
 * d'observateurs que d'éléments. Ici un SEUL observateur surveille le
 * conteneur, et les enfants s'échelonnent en CSS pur (`--reveal-index`) :
 * aucun rendu React supplémentaire, aucune animation par ligne à orchestrer
 * en JavaScript.
 *
 * Tant que la liste n'a pas été vue, ses lignes sont transparentes — pas
 * absentes. Le texte, les pourcentages et les liens sont dans le DOM dès le
 * premier rendu : c'est la même règle que partout ailleurs ici, une animation
 * ne porte jamais une valeur. Et `useSeen` garde son repli de 10 s, donc une
 * panne d'`IntersectionObserver` finit par tout montrer.
 *
 * Sous « animation réduite », rien n'est masqué une seule image : on renvoie
 * des propriétés vides.
 */
export function useCascade<T extends Element = HTMLElement>(): readonly [
  (node: T | null) => void,
  (index: number) => { className?: string; style?: CSSProperties },
] {
  const reduced = useReducedMotion();
  const [ref, seen] = useSeen<T>();

  const itemProps = (index: number) => {
    if (reduced) return {};
    if (!seen) return { style: { opacity: 0 } };
    // Les déclarations d'animation l'emportent sur le style en ligne dans la
    // cascade CSS : `.cascade` ramène donc bien l'opacité à 1, sans qu'il
    // faille retirer l'`opacity: 0` d'abord (ce qui provoquerait un éclair).
    return { className: 'cascade', style: { '--reveal-index': index } as CSSProperties };
  };

  return [ref, itemProps] as const;
}

/**
 * Nombre qui monte de 0 à sa valeur.
 *
 * Il démarre au MONTAGE, pas à l'entrée dans la fenêtre — c'est délibéré. Un
 * compteur lié au défilement afficherait « 0 » tant qu'on n'a pas atteint la
 * section : le chiffre serait faux pour quiconque lit la page sans la
 * parcourir, et pour tout ce qui l'inspecte automatiquement. La valeur exacte
 * est donc atteinte en 700 ms, vue ou non.
 */
export function CountUp({
  value,
  suffix = '',
  duration = 900,
}: {
  value: number;
  suffix?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(() => (reduced ? value : 0));

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      /*
       * Montée QUASI LINÉAIRE, avec un simple adoucissement sur le dernier
       * cinquième. Une décélération cubique passait l'essentiel du temps à
       * flotter autour de la valeur finale : on ne voyait pas un compteur
       * défiler, on voyait un chiffre hésiter. Ici les valeurs défilent
       * franchement, puis se posent.
       */
      const eased = t < 0.8 ? t * 1.05 : 1 - (1 - t) ** 2 * 1.25;
      setDisplay(Math.round(value * Math.min(1, Math.max(0, eased))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return (
    <>
      {display}
      {suffix}
    </>
  );
}
