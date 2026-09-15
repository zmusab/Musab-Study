import { motion, useReducedMotion } from 'motion/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { springSnappy } from '@/components/motion/transitions';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--on-accent)] border-transparent hover:bg-[var(--accent-hover)] shadow-[var(--shadow-soft)]',
  secondary:
    'bg-[var(--surface)] text-[var(--ink)] border-[var(--line)] hover:bg-[var(--surface-hover)]',
  ghost:
    'bg-transparent text-[var(--ink-soft)] border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
  danger:
    'bg-transparent text-[var(--danger)] border-transparent hover:bg-[var(--danger-tint)]',
};

const SIZES: Record<ButtonSize, string> = {
  // Hauteurs pensées pour le doigt autant que pour le curseur.
  sm: 'min-h-9 px-3 text-[0.85rem] gap-1.5 rounded-[0.5rem]',
  md: 'min-h-11 px-4 text-[0.92rem] gap-2 rounded-[var(--radius-control)]',
  lg: 'min-h-13 px-5 text-[0.98rem] gap-2 rounded-[var(--radius-control)]',
};

/**
 * Les gestionnaires d'animation et de glisser du DOM sont retirés : React et
 * Motion définissent `onAnimationStart` et `onDrag*` avec des signatures
 * incompatibles. Motion fournit les siens, ce sont ceux qui comptent ici.
 */
type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | 'children'
  | 'onAnimationStart'
  | 'onAnimationEnd'
  | 'onAnimationIteration'
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
>;

export interface ButtonProps extends NativeButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * Bouton avec retour tactile.
 *
 * Le `whileTap` à 0.97 est délibérément faible : sur iPad, un enfoncement plus
 * marqué se lit comme un défaut d'affichage plutôt que comme une réponse. Le
 * ressort ramène le bouton sans rebond visible.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const reduced = useReducedMotion();
  const isDisabled = disabled || loading;

  return (
    <motion.button
      type={type}
      disabled={isDisabled}
      whileTap={reduced || isDisabled ? undefined : { scale: 0.97 }}
      transition={springSnappy}
      data-touch-target
      className={cn(
        'inline-flex items-center justify-center border font-semibold',
        'transition-colors duration-150 select-none',
        'disabled:opacity-50 disabled:pointer-events-none',
        // Supprime le flash bleu de sélection sur iOS.
        '[-webkit-tap-highlight-color:transparent]',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon}
      {children}
    </motion.button>
  );
}
