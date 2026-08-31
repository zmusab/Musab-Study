import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { pageTransition } from '@/components/motion/transitions';

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

/** Titre de page, cohérent partout. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-[0.9rem] leading-relaxed text-[var(--ink-soft)]">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
