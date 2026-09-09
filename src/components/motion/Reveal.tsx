import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';

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
 * Bloc qui monte en fondu à son entrée dans la fenêtre. À réserver aux
 * SECTIONS : appliqué à chaque ligne d'une liste, l'effet devient un défilé.
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
  const [ref, seen] = useSeen<HTMLElement>();
  const Component = as === 'section' ? motion.section : motion.div;

  return (
    <Component
      ref={ref}
      className={className}
      initial={false}
      animate={seen ? { opacity: 1, y: 0 } : { opacity: 0, y: reduced ? 0 : 16 }}
      transition={
        reduced
          ? { duration: 0 }
          : { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }
      }
    >
      {children}
    </Component>
  );
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
  duration = 700,
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
      // Décélération cubique : rapide au début, posée à l'arrivée.
      setDisplay(Math.round(value * (1 - (1 - t) ** 3)));
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
