import { useState } from 'react';
import { FadeUp } from '@/components/motion/Motion';
import { randomQuote } from '@/data/quotes';
import { cn } from '@/lib/cn';

/**
 * Un petit encart de citation, pour donner un peu de chaleur à l'écran de
 * révision plutôt qu'une simple liste de boutons. Une citation par montage
 * du composant — donc une nouvelle à chaque fois qu'on revient sur l'écran,
 * sans changer sous les yeux pendant qu'on la lit.
 */
export function WisdomQuote({ className }: { className?: string }) {
  const [quote] = useState(randomQuote);

  return (
    <FadeUp
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3.5',
        className,
      )}
    >
      <p className="text-[0.85rem] italic leading-relaxed text-[var(--ink-soft)]">« {quote.text} »</p>
      <p className="mt-1.5 text-[0.72rem] font-semibold tracking-wide text-[var(--ink-faint)]">
        — {quote.author}
      </p>
    </FadeUp>
  );
}
