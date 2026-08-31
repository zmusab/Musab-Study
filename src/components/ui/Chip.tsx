import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Chip({
  children,
  color,
  className,
}: {
  children: ReactNode;
  /** Couleur d'accent explicite (variable CSS ou hexadécimal). */
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        'rounded-full border px-2.5 py-1',
        'font-mono text-[0.72rem] leading-none',
        className,
      )}
      style={
        color
          ? { borderColor: color, color, backgroundColor: 'transparent' }
          : { borderColor: 'var(--line)', color: 'var(--ink-soft)' }
      }
    >
      {children}
    </span>
  );
}

/** Pastille de couleur d'une matière. */
export function Swatch({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}
