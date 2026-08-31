import type { Transition, Variants } from 'motion/react';

/**
 * Vocabulaire d'animation de l'application.
 *
 * Deux règles tenues partout :
 *  1. on n'anime QUE `opacity` et `transform` — ce sont les seules propriétés
 *     que le navigateur peut composer sur le GPU. Animer `height`, `top` ou
 *     `background` provoque un recalcul de mise en page à chaque image et fait
 *     tomber le défilement sous les 60 images/seconde sur iPad ;
 *  2. les déplacements restent courts (4 à 12 px). Une interface premium
 *     suggère le mouvement, elle ne le met pas en scène.
 */

/** Ressort discret pour l'entrée d'éléments. */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 38,
  mass: 0.9,
};

/** Ressort plus vif pour les retours directs à une action (bouton, bascule). */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 620,
  damping: 34,
  mass: 0.7,
};

export const easeOutSoft: Transition = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1],
};

/** Apparition d'un bloc : léger fondu montant. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -6, transition: { duration: 0.14 } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutSoft },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

/** Ouverture d'une fenêtre modale : fondu + très légère montée d'échelle. */
export const modalPop: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, scale: 0.98, y: 6, transition: { duration: 0.14 } },
};

/**
 * Conteneur d'une liste dont les enfants entrent en cascade.
 * 40 ms d'écart : perceptible comme un enchaînement, jamais comme une attente.
 */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
  exit: {},
};

/** Transition entre deux pages : le sortant s'efface avant l'entrant. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { ...springSoft, staggerChildren: 0.04 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.13 } },
};

/** Retournement d'une flashcard lors de la révélation de la réponse. */
export const revealAnswer: Variants = {
  hidden: { opacity: 0, y: -6, scaleY: 0.96 },
  visible: { opacity: 1, y: 0, scaleY: 1, transition: springSoft },
};
