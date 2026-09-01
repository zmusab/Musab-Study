import { useEffect, useRef, useState } from 'react';
import type { TrendPoint } from '@/core/progress';

/**
 * Évolution de la maîtrise, semaine par semaine.
 *
 * Les points ne sont PAS des instantanés stockés — l'application n'en garde
 * pas. Ils sont reconstruits en rejouant le journal de révisions dans
 * l'algorithme de planification, qui est déterministe (voir `masteryTrend`).
 * La courbe est donc un calcul sur des données réelles ; en l'absence de
 * révisions, elle ne s'affiche pas du tout.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [progress, setProgress] = useState(0);
  const pathRef = useRef<SVGPolylineElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setProgress(1));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (points.length < 2) return null;

  const width = 100;
  const height = 40;
  const padY = 4;
  const values = points.map((point) => point.masteryPct);
  const max = Math.max(...values, 10);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 10);

  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - padY - ((point.masteryPct - min) / span) * (height - padY * 2);
    return { x, y, point };
  });

  const line = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const delta = last.masteryPct - first.masteryPct;

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-[1.9rem] font-semibold leading-none tabular-nums text-[var(--ink)]">
          {last.masteryPct} %
        </span>
        <span
          data-progress-trend-delta
          className={
            'text-[0.85rem] font-medium ' +
            (delta > 0
              ? 'text-[var(--success)]'
              : delta < 0
                ? 'text-[var(--danger)]'
                : 'text-[var(--ink-faint)]')
          }
        >
          {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '='} pt
          {Math.abs(delta) > 1 ? 's' : ''} depuis {first.label.toLowerCase()}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-3 h-28 w-full"
        role="img"
        aria-label={`Maîtrise : ${points.map((p) => `${p.label} ${p.masteryPct} %`).join(', ')}`}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#trend-fill)" style={{ opacity: progress, transition: 'opacity 700ms ease' }} />
        <polyline
          ref={pathRef}
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{
            // Le tracé se dessine de gauche à droite : `stroke-dashoffset`
            // est composé par le GPU, il n'entraîne aucun recalcul de mise
            // en page, contrairement à une animation de largeur.
            strokeDasharray: 400,
            strokeDashoffset: 400 * (1 - progress),
            transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 0.61, 0.36, 1)',
          }}
        />
        {coords.map((c) => (
          <circle
            key={c.point.day}
            cx={c.x}
            cy={c.y}
            r={1.6}
            fill="var(--surface)"
            stroke="var(--accent)"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
            style={{ opacity: progress, transition: 'opacity 700ms ease 200ms' }}
          />
        ))}
      </svg>

      <div className="mt-1 flex justify-between text-[0.72rem] text-[var(--ink-faint)]">
        <span>{first.label}</span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}
