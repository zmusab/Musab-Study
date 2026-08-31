import { motion, useReducedMotion } from 'motion/react';

/**
 * Indicateur d'attente. Sous `prefers-reduced-motion`, il cesse de tourner et
 * devient un point pulsant très lent — présent, mais sans rotation continue.
 */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      role="status"
      aria-label="Chargement"
      className={className}
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        borderRadius: '50%',
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        opacity: 0.75,
      }}
      animate={reduced ? { opacity: [0.35, 0.8, 0.35] } : { rotate: 360 }}
      transition={
        reduced
          ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.7, repeat: Infinity, ease: 'linear' }
      }
    />
  );
}
