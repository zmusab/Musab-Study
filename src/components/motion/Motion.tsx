import { motion, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { fadeUp, staggerContainer } from './transitions';

/**
 * Primitives d'animation réutilisables.
 *
 * Chacune consulte `useReducedMotion`. Quand l'utilisateur a désactivé les
 * animations dans iOS ou macOS, les variantes deviennent des transitions
 * d'opacité instantanées : l'interface reste PARFAITEMENT fonctionnelle,
 * simplement immobile. Aucune fonctionnalité ne dépend d'une animation.
 */

/**
 * Composants animés créés UNE FOIS au chargement du module.
 * Appeler `motion.create()` pendant le rendu produirait un type de composant
 * différent à chaque image : React démonterait puis remonterait tout le
 * sous-arbre, ce qui perd le focus, l'état des champs et la fluidité.
 */
const MOTION_TAGS = {
  div: motion.div,
  ul: motion.ul,
  li: motion.li,
  section: motion.section,
  nav: motion.nav,
} as const;

export type MotionTag = keyof typeof MOTION_TAGS;

/** Neutralise les déplacements tout en conservant les états visible/caché. */
const STILL: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};

/** Variante « immobile » du conteneur : la cascade disparaît, pas les enfants. */
const STILL_CONTAINER: Variants = {
  hidden: {},
  visible: { transition: { duration: 0 } },
  exit: {},
};

interface AnimatedProps {
  children: ReactNode;
  className?: string;
  as?: MotionTag;
  variants?: Variants;
  delay?: number;
}

/** Bloc qui apparaît en fondu montant. */
export function FadeUp({
  children,
  className,
  as = 'div',
  variants = fadeUp,
  delay = 0,
}: AnimatedProps) {
  const reduced = useReducedMotion();
  const Component = MOTION_TAGS[as];
  return (
    <Component
      className={className}
      variants={reduced ? STILL : variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={delay && !reduced ? { delay } : undefined}
    >
      {children}
    </Component>
  );
}

/**
 * Conteneur dont les enfants `<StaggerItem>` entrent en cascade.
 *
 * La cascade se déclenche à l'ENTRÉE DANS LA FENÊTRE, plus au montage.
 * Elle jouait jusqu'ici pour toute la liste dès l'arrivée sur la page : sur
 * une bibliothèque de quarante cartes ou une liste de notes qui descend sur
 * trois écrans, les trois quarts de l'animation se terminaient hors champ.
 * Le mouvement existait dans le code, jamais à l'écran — le même défaut que
 * « Progression » avant `Reveal`.
 *
 * `amount: 0.05` est délibérément bas : ce qui est DÉJÀ visible à l'arrivée
 * s'anime immédiatement, exactement comme avant. Seul ce qui est plus bas
 * attend d'être atteint. `once: true` : une donnée ne se ré-anime pas à
 * chaque aller-retour de défilement.
 *
 * Sous « animation réduite », `STILL_CONTAINER` neutralise la cascade et les
 * enfants restent pleinement visibles.
 */
export function Stagger({ children, className, as = 'div' }: AnimatedProps) {
  const reduced = useReducedMotion();
  const Component = MOTION_TAGS[as];
  return (
    <Component
      className={className}
      variants={reduced ? STILL_CONTAINER : staggerContainer}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.05 }}
      exit="exit"
    >
      {children}
    </Component>
  );
}

/** Enfant d'un `<Stagger>`. */
export function StaggerItem({ children, className, as = 'div' }: AnimatedProps) {
  const reduced = useReducedMotion();
  const Component = MOTION_TAGS[as];
  return (
    <Component className={className} variants={reduced ? STILL : fadeUp}>
      {children}
    </Component>
  );
}
