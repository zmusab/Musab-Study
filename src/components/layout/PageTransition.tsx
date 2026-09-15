import { motion, useReducedMotion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { pageTransition } from '@/components/motion/transitions';
import { notationFor } from './notations';

/**
 * Enveloppe d'une page.
 *
 * Le sortant s'efface AVANT que l'entrant n'arrive (`mode="wait"` côté
 * `AnimatePresence`) : deux pages superposées pendant la transition
 * provoqueraient un saut de hauteur du document, donc un sursaut du
 * défilement — l'effet le plus désagréable qui soit sur iPad.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      variants={
        reduced
          ? { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } }
          : pageTransition
      }
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

/**
 * Titre de page, cohérent partout.
 *
 * Le surtitre est la notation scientifique de la section (voir
 * `notations.ts`). Il est posé AU-DESSUS du titre plutôt qu'en flottant dans
 * la page : à cet endroit il ne peut ni recouvrir une carte, ni entrer en
 * concurrence avec le bouton d'action à droite, ni se retrouver seul au milieu
 * d'un écran vide. Il est `aria-hidden` — c'est un ornement, pas une
 * information : un lecteur d'écran n'a rien à faire de « Ca dix P O quatre ».
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  const { pathname } = useLocation();
  const notation = pathname === '/' ? notationFor(pathname) : null;

  return (
    <header className="mb-6 border-b border-[var(--line)] pb-5">
      {/*
        Le bloc d'actions passe À LA LIGNE quand il ne tient plus à côté du
        titre, au lieu de comprimer celui-ci.
        Sans `flex-wrap` ni largeur minimale sur la colonne de texte, un
        `shrink-0` réclamait toute sa largeur intrinsèque : sur le Calendrier
        (trois boutons), la colonne du titre tombait à quelques dizaines de
        pixels sur un iPad en portrait, le sous-titre s'écrivait un mot par
        ligne sur quinze lignes, et les boutons débordaient par-dessus. La
        grille du mois commençait alors sous la ligne de flottaison.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-[15rem] flex-1">
          {notation && (
            <p
              aria-hidden
              className="mb-1.5 font-serif text-[0.74rem] italic tracking-[0.06em] text-[var(--ink-faint)] opacity-80"
            >
              {notation}
            </p>
          )}
          <h1 className="text-[1.9rem] leading-[1.15]">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 max-w-prose text-[0.9rem] leading-relaxed text-[var(--ink-soft)]">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="shrink-0 max-w-full">{action}</div>}
      </div>
    </header>
  );
}
