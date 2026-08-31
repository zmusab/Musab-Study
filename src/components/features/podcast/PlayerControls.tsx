import { motion } from 'motion/react';
import { Button, Icon } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/services/podcast/plan';
import type { PodcastPlayerState } from '@/hooks/usePodcastPlayer';

const RATES = [0.75, 1, 1.25, 1.5, 2];

/**
 * Barre de contrôle du lecteur.
 *
 * « ⏮ / ⏭ » déplacent d'une réplique entière plutôt que de 15 secondes fixes :
 * la Web Speech API ne permet pas de reprendre une synthèse vocale au milieu
 * d'une phrase. C'est un choix honnête plutôt qu'un faux réglage qui donnerait
 * l'illusion d'un vrai positionnement temporel.
 */
export function PlayerControls({
  player,
  totalDurationSec,
}: {
  player: PodcastPlayerState;
  totalDurationSec: number;
}) {
  const progress = totalDurationSec > 0 ? Math.min(1, player.totalElapsedEstimate / totalDurationSec) : 0;

  if (!player.available) {
    return (
      <div className="surface-card p-4 text-center text-[0.85rem] text-[var(--ink-soft)]">
        ⚠️ La lecture audio n'est pas disponible sur ce navigateur (aucune voix française détectée). La
        transcription ci-dessous reste consultable et sourcée normalement.
      </div>
    );
  }

  return (
    <div className="surface-card p-4">
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <motion.div
          className="h-full rounded-full bg-[var(--accent)]"
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.15 }}
        />
      </div>
      <div className="mb-3 flex justify-between font-mono text-[0.72rem] text-[var(--ink-faint)]">
        <span>{formatDuration(player.totalElapsedEstimate)}</span>
        <span>{formatDuration(totalDurationSec)}</span>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          aria-label="Réplique précédente"
          data-touch-target
          onClick={player.previous}
          className="rounded-full p-2.5 text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          <Icon name="skipBack" size={22} />
        </button>

        <button
          type="button"
          aria-label={player.playing ? 'Pause' : 'Lecture'}
          data-touch-target
          onClick={player.toggle}
          className="rounded-full bg-[var(--accent)] p-3.5 text-white shadow-[var(--shadow-soft)] transition-transform active:scale-95"
        >
          <Icon name={player.playing ? 'pause' : 'play'} size={22} />
        </button>

        <button
          type="button"
          aria-label="Réplique suivante"
          data-touch-target
          onClick={player.next}
          className="rounded-full p-2.5 text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          <Icon name="skipForward" size={22} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="volume" size={16} className="text-[var(--ink-faint)]" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={player.volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
            aria-label="Volume"
            className="h-1.5 w-20 accent-[var(--accent)]"
          />
        </div>

        <div className="flex gap-1">
          {RATES.map((rate) => (
            <Button
              key={rate}
              size="sm"
              variant={player.playbackRate === rate ? 'primary' : 'ghost'}
              className={cn('min-w-11 px-2 font-mono text-[0.74rem]')}
              onClick={() => player.setPlaybackRate(rate)}
            >
              {rate}×
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
