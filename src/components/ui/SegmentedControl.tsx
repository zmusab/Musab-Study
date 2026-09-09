import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import { cn } from '@/lib/cn';
import { springSoft } from '@/components/motion/transitions';

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

/**
 * Sélecteur segmenté.
 *
 * L'indicateur actif est un `layoutId` partagé : Motion interpole donc sa
 * position d'un segment à l'autre au lieu de le faire disparaître puis
 * réapparaître. C'est ce glissement qui donne la sensation « Apple ».
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  className,
  size = 'md',
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const reduced = useReducedMotion();
  const layoutId = useId();

  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex flex-wrap gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)] p-1',
        className,
      )}
    >
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            role="tab"
            type="button"
            aria-selected={active}
            data-touch-target
            onClick={() => onChange(segment.value)}
            className={cn(
              'relative rounded-full font-semibold transition-colors duration-150',
              '[-webkit-tap-highlight-color:transparent]',
              size === 'sm' ? 'px-3 py-1.5 text-[0.8rem]' : 'px-4 py-2 text-[0.86rem]',
              active ? 'text-[var(--on-accent)]' : 'text-[var(--ink-soft)] hover:text-[var(--ink)]',
            )}
          >
            {active && (
              <motion.span
                layoutId={reduced ? undefined : layoutId}
                className="absolute inset-0 rounded-full bg-[var(--accent)]"
                transition={springSoft}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5 whitespace-nowrap">
              {segment.icon && <span aria-hidden>{segment.icon}</span>}
              {segment.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
