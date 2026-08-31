import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Chip } from '@/components/ui';
import { springSoft } from '@/components/motion/transitions';
import { cn } from '@/lib/cn';
import type { PodcastEpisode, PodcastSegment } from '@/types';

/**
 * Transcription synchronisée.
 *
 * La réplique en cours de lecture est mise en évidence et défile
 * automatiquement dans la vue — la granularité est la RÉPLIQUE, pas le mot :
 * la Web Speech API ne fournit pas de découpage fiable au mot près entre
 * navigateurs, une synchronisation plus fine serait donc trompeuse.
 */

const SPEAKER_STYLE = {
  A: { align: 'items-start', bubble: 'bg-[var(--surface)] border-[var(--line)]', badge: 'var(--accent)' },
  B: { align: 'items-end', bubble: 'bg-[var(--accent-tint)] border-[var(--accent)]/30', badge: 'var(--success)' },
} as const;

const TYPE_LABEL: Partial<Record<PodcastSegment['type'], string>> = {
  pitfall: '⚠️ Piège',
  example: '💡 Exemple',
  quiz: '❓ À toi de jouer',
  recap: '🔁 Récap',
};

function SegmentBubble({
  segment,
  active,
}: {
  segment: PodcastSegment;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const [showSources, setShowSources] = useState(false);
  const style = SPEAKER_STYLE[segment.speaker];
  const typeLabel = TYPE_LABEL[segment.type];

  return (
    <div className={cn('flex flex-col gap-1', style.align)}>
      <span className="px-1 text-[0.72rem] font-semibold text-[var(--ink-faint)]">
        {segment.speaker === 'A' ? 'Locuteur A' : 'Locuteur B'}
        {typeLabel && <span className="ml-1.5">{typeLabel}</span>}
      </span>

      <motion.div
        animate={active ? { scale: 1.015 } : { scale: 1 }}
        transition={reduced ? { duration: 0 } : springSoft}
        className={cn(
          'max-w-[88%] rounded-2xl border px-4 py-2.5 text-[0.9rem] leading-relaxed transition-shadow duration-200',
          style.bubble,
          active && 'shadow-[var(--shadow-lift)] ring-2 ring-[var(--accent)]/50',
        )}
      >
        {segment.text}
      </motion.div>

      {segment.provenance === 'course' && segment.citations.length > 0 && (
        <div className={cn('px-1', style.align === 'items-end' && 'self-end')}>
          <button
            type="button"
            onClick={() => setShowSources((v) => !v)}
            className="text-[0.72rem] font-semibold text-[var(--ink-faint)] underline underline-offset-2 hover:text-[var(--ink-soft)]"
          >
            📚 {showSources ? 'Masquer' : 'Voir'} la source
          </button>
          <AnimatePresence initial={false}>
            {showSources && (
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={reduced ? { duration: 0 } : springSoft}
                className="mt-1 max-w-xs overflow-hidden rounded-[var(--radius-control)] border-l-2 border-[var(--accent)] bg-[var(--surface-2)] px-3 py-2"
              >
                <p className="font-mono text-[0.68rem] text-[var(--ink-faint)]">
                  {segment.citations[0]!.chapterName} › {segment.citations[0]!.documentName}
                </p>
                <p className="mt-1 text-[0.78rem] italic text-[var(--ink-soft)]">
                  « {segment.citations[0]!.excerpt} »
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {segment.provenance === 'internet' && (
        <Chip color="var(--accent)" className={style.align === 'items-end' ? 'self-end' : undefined}>
          🌐 Complément internet — à vérifier
        </Chip>
      )}
    </div>
  );
}

export function TranscriptView({
  episode,
  activeIndex,
  onSelectSegment,
}: {
  episode: PodcastEpisode;
  activeIndex: number;
  onSelectSegment: (index: number) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  return (
    <div className="flex flex-col gap-4">
      {episode.segments.map((segment, index) => (
        <div
          key={segment.id}
          ref={index === activeIndex ? activeRef : undefined}
          role="button"
          tabIndex={0}
          onClick={() => onSelectSegment(index)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onSelectSegment(index);
          }}
          className="cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <SegmentBubble segment={segment} active={index === activeIndex} />
        </div>
      ))}
    </div>
  );
}
