import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { masteryBand } from '@/core/progress';

/**
 * Briques visuelles de « Progression ».
 *
 * Toutes suivent la même règle : une valeur ABSENTE ne se dessine pas comme
 * un zéro. Une barre sans donnée reste vide et grise, un anneau sans donnée
 * affiche « — » ; c'est la différence entre « tu n'as rien acquis » et « on
 * ne sait pas encore », et cette page ne doit jamais confondre les deux.
 */

/**
 * Déclenche l'animation d'entrée une image après le montage. Les barres
 * partent de zéro et rejoignent leur valeur : la progression se voit, sans
 * animer autre chose que `width`/`height`/`stroke-dashoffset`. La règle
 * globale `prefers-reduced-motion` ramène toutes ces transitions à 0,01 ms,
 * la valeur finale reste donc correcte et immédiate.
 */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return mounted;
}

export function SectionTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[1.15rem] leading-tight">{children}</h2>
        {hint && <p className="mt-1 text-[0.84rem] leading-snug text-[var(--ink-soft)]">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Pastille de palier — le code couleur de toute la page, en un seul endroit. */
export function BandDot({ pct, size = 8 }: { pct: number | null; size?: number }) {
  const color = pct === null ? 'var(--line-strong)' : masteryBand(pct).colorVar;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}

export function StatTile({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** Teinte du détail : seulement quand elle porte une information réelle. */
  tone?: 'neutral' | 'up' | 'down' | 'warning';
  icon?: ReactNode;
}) {
  const toneClass =
    tone === 'up'
      ? 'text-[var(--success)]'
      : tone === 'down'
        ? 'text-[var(--danger)]'
        : tone === 'warning'
          ? 'text-[var(--warning)]'
          : 'text-[var(--ink-faint)]';
  return (
    <div className="surface-card flex h-full min-h-[7.5rem] flex-col justify-between p-4">
      <div className="flex items-center gap-2 text-[0.8rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        {icon && <span className="text-[var(--ink-soft)]">{icon}</span>}
        {label}
      </div>
      <div>
        <p className="text-[1.75rem] font-semibold leading-none tabular-nums text-[var(--ink)]">{value}</p>
        {detail && <p className={cn('mt-1.5 text-[0.82rem] leading-snug', toneClass)}>{detail}</p>}
      </div>
    </div>
  );
}

/** Barre de maîtrise horizontale, colorée par palier. */
export function MasteryBar({ pct, height = 6 }: { pct: number | null; height?: number }) {
  const mounted = useMounted();
  const color = pct === null ? 'var(--line-strong)' : masteryBand(pct).colorVar;
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
      style={{ height }}
      role="presentation"
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${mounted ? (pct ?? 0) : 0}%`,
          backgroundColor: color,
          transition: 'width 700ms cubic-bezier(0.22, 0.61, 0.36, 1)',
        }}
      />
    </div>
  );
}

/** Barre d'objectif — même mécanique, teinte d'accent, valeur plafonnée à 100 %. */
export function GoalBar({ pct }: { pct: number }) {
  const mounted = useMounted();
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div
        className="h-full rounded-full bg-[var(--accent)]"
        style={{
          width: `${mounted ? Math.min(100, pct) : 0}%`,
          transition: 'width 700ms cubic-bezier(0.22, 0.61, 0.36, 1)',
        }}
      />
    </div>
  );
}

/**
 * État vide d'une section : il dit ce qui sera mesuré ET comment déclencher la
 * mesure. Jamais « fonctionnalité en construction ».
 */
export function EmptyHint({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--line)] bg-[var(--surface-2)]/40 p-4">
      <p className="text-[0.9rem] font-medium text-[var(--ink-soft)]">{title}</p>
      <p className="mt-1 text-[0.83rem] leading-relaxed text-[var(--ink-faint)]">{children}</p>
    </div>
  );
}
