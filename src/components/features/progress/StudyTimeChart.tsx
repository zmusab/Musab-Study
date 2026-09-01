import { useEffect, useState } from 'react';
import { formatDuration, type DayBucket } from '@/core/progress';

const LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Temps de révision de la semaine, jour par jour.
 *
 * Le seul temps que l'application MESURE est celui passé à répondre aux
 * cartes (`ReviewLog.elapsedMs`, chronométré entre l'affichage de la question
 * et la note). C'est donc ce qui est tracé — pas un « temps d'étude » global
 * qui inclurait une lecture de PDF que rien ne chronomètre.
 *
 * Une journée sans révision garde une barre résiduelle grise : elle montre que
 * le jour existe et qu'il est vide, au lieu de disparaître du graphique.
 */
export function StudyTimeChart({ week, todayIndex }: { week: DayBucket[]; todayIndex: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const max = Math.max(...week.map((bucket) => bucket.ms), 1);
  const hasAny = week.some((bucket) => bucket.ms > 0);

  return (
    <div>
      <div className="flex h-32 items-end justify-between gap-2" data-progress-week-chart>
        {week.map((bucket, index) => {
          const ratio = bucket.ms / max;
          const height = bucket.ms === 0 ? 3 : Math.max(6, Math.round(ratio * 116));
          const isToday = index === todayIndex;
          return (
            <div key={bucket.day} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-[0.68rem] tabular-nums text-[var(--ink-faint)]">
                {bucket.ms > 0 ? formatDuration(bucket.ms) : ''}
              </span>
              <div
                title={`${bucket.day} — ${formatDuration(bucket.ms)}, ${bucket.reviews} réponse${bucket.reviews > 1 ? 's' : ''}`}
                className="w-full rounded-t-[5px]"
                style={{
                  height: mounted ? height : 3,
                  backgroundColor:
                    bucket.ms === 0 ? 'var(--line)' : isToday ? 'var(--accent)' : 'var(--accent-soft, var(--accent))',
                  opacity: bucket.ms === 0 ? 1 : isToday ? 1 : 0.55,
                  transition: 'height 650ms cubic-bezier(0.22, 0.61, 0.36, 1)',
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between gap-2">
        {week.map((bucket, index) => (
          <span
            key={bucket.day}
            className={
              'min-w-0 flex-1 text-center text-[0.72rem] ' +
              (index === todayIndex ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink-faint)]')
            }
          >
            {LABELS[index]}
          </span>
        ))}
      </div>
      {!hasAny && (
        <p className="mt-3 text-[0.83rem] leading-relaxed text-[var(--ink-faint)]">
          Aucune révision cette semaine. Chaque réponse donnée est chronométrée et vient remplir ce graphique.
        </p>
      )}
    </div>
  );
}
