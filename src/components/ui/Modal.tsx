import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { modalPop } from '@/components/motion/transitions';
import { cn } from '@/lib/cn';

/**
 * Fenêtre modale accessible.
 *
 * Trois exigences tenues, absentes du prototype qui utilisait `alert()` :
 *  - Échap ferme, et le clic sur le voile ferme ;
 *  - le défilement de la page derrière est bloqué (sur iOS, sans cela, le
 *    contenu défile sous la modale au moindre glissement) ;
 *  - le focus revient à l'élément déclencheur à la fermeture.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  theme,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /**
   * Thème forcé pour cette modale. La modale est rendue dans un PORTAIL sur
   * `document.body` : elle sort donc du sous-arbre qui porte `data-theme`, et
   * une section sombre (Anatomie) obtenait sinon une modale blanche.
   */
  theme?: 'light' | 'dark';
}) {
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // `onClose` est presque toujours une fonction fléchée en ligne côté appelant
  // (`onClose={() => setCreating(false)}`), recréée à chaque rendu du parent —
  // y compris à chaque frappe dans un champ contrôlé par ce même parent. La
  // garder dans les dépendances de l'effet ci-dessous relançait donc l'effet à
  // chaque lettre tapée : sa fonction de nettoyage renvoyait alors
  // immédiatement le focus vers l'élément qui avait ouvert la modale, éjectant
  // l'utilisateur du champ après chaque caractère. La ref maintient toujours
  // la dernière version de `onClose` sans jamais faire partie des dépendances.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    // Laisse l'animation d'entrée démarrer avant de déplacer le focus,
    // sinon Safari saute brutalement au panneau.
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 40);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      window.clearTimeout(focusTimer);
      previouslyFocused.current?.focus();
    };
    // `open` seul suffit : l'effet ne doit s'exécuter qu'à l'ouverture et à la
    // fermeture, jamais à chaque rendu du contenu affiché à l'intérieur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          data-theme={theme}
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
        >
          <motion.div
            className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.16 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={cn(
              'relative w-full bg-[var(--surface)] shadow-[var(--shadow-lift)] outline-none',
              // `overflow-x-hidden` explicite : `overflow-y-auto` seul fait
              // calculer `overflow-x: auto` par la spec, et le moindre
              // dépassement d'un pixel rend la fenêtre pannable de côté sur
              // iPad — le contenu part alors en biais au défilement.
              'max-h-[88vh] overflow-y-auto overflow-x-hidden overscroll-contain scroll-contain pb-safe',
              // Feuille ancrée en bas sur mobile, carte centrée sur grand écran.
              'rounded-t-2xl sm:rounded-[var(--radius-card)]',
              widths[size],
            )}
            variants={
              reduced
                ? { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } }
                : modalPop
            }
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="min-w-0 p-6">
              <h2 className="text-[1.15rem]">{title}</h2>
              {description && (
                <p className="mt-1.5 text-[0.88rem] leading-relaxed text-[var(--ink-soft)]">
                  {description}
                </p>
              )}
              {children && <div className="mt-5 min-w-0">{children}</div>}
              {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
