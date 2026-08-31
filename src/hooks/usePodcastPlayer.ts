import { useCallback, useEffect, useRef, useState } from 'react';
import { webSpeechProvider } from '@/services/tts/webSpeech';
import type { TtsProvider, TtsVoiceProfile } from '@/services/tts/types';
import type { PodcastEpisode, PodcastSpeakerId } from '@/types';

/**
 * Lecteur du podcast, au-dessus de l'API de synthèse vocale du navigateur.
 *
 * Deux limites de la Web Speech API, assumées plutôt que masquées :
 *
 *  - Pas de pause/reprise fiable au milieu d'une réplique selon les
 *    navigateurs (particulièrement Safari). « Pause » arrête donc la réplique
 *    en cours ; « Lecture » la reprend depuis son DÉBUT, pas depuis le point
 *    exact d'arrêt. C'est un compromis prévisible plutôt qu'un comportement
 *    qui varie selon l'appareil.
 *  - Pas de défilement au milieu d'une réplique. « ⏮ / ⏭ » déplacent donc
 *    d'une réplique entière, ce qui reste un geste naturel dans une
 *    conversation à deux voix.
 */

export interface PodcastPlayerState {
  available: boolean;
  currentIndex: number;
  playing: boolean;
  finished: boolean;
  volume: number;
  playbackRate: number;
  /** Secondes écoulées dans la réplique en cours (estimation, non exacte). */
  elapsedInSegment: number;
  totalElapsedEstimate: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekToSegment: (index: number) => void;
  setVolume: (value: number) => void;
  setPlaybackRate: (value: number) => void;
}

const TICK_MS = 200;

export function usePodcastPlayer(
  episode: PodcastEpisode | null,
  provider: TtsProvider = webSpeechProvider,
): PodcastPlayerState {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [elapsedInSegment, setElapsedInSegment] = useState(0);
  const [voices, setVoices] = useState<Record<PodcastSpeakerId, TtsVoiceProfile> | null>(null);

  const handleRef = useRef<{ cancel: () => void } | null>(null);
  const tickRef = useRef<number | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const segments = episode?.segments ?? [];

  // Réinitialise le lecteur à chaque nouvel épisode, en reprenant à la
  // réplique où l'écoute s'était arrêtée plutôt qu'au début. Volontairement
  // ancré sur `episode?.id` seul : `lastSegmentIndex` change à chaque
  // progression persistée par l'appelant (voir PodcastEpisodePage), et le
  // réinclure ici relancerait le lecteur au milieu de sa propre écoute.
  useEffect(() => {
    provider.stop();
    setCurrentIndex(episode?.lastSegmentIndex ?? 0);
    setPlaying(false);
    setFinished(false);
    setElapsedInSegment(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.id, provider]);

  useEffect(() => {
    let cancelled = false;
    void provider.resolveVoices().then((resolved) => {
      if (!cancelled) setVoices(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const stopTick = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const speakSegment = useCallback(
    (index: number) => {
      const segment = segments[index];
      if (!segment || !voices) return;

      handleRef.current?.cancel();
      stopTick();
      setElapsedInSegment(0);

      const startedAt = Date.now();
      tickRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        setElapsedInSegment(Math.min(elapsed, segment.estimatedDurationSec));
      }, TICK_MS);

      handleRef.current = provider.speak(
        segment.text,
        voices[segment.speaker],
        volume,
        playbackRate,
        (interrupted) => {
          stopTick();
          // Une réplique interrompue volontairement (pause, saut, arrêt) ne
          // doit jamais déclencher l'avance automatique vers la suivante.
          if (interrupted || !playingRef.current) return;

          if (index + 1 < segments.length) {
            setCurrentIndex(index + 1);
          } else {
            setPlaying(false);
            setFinished(true);
          }
        },
      );
    },
    [segments, voices, volume, playbackRate, provider, stopTick],
  );

  // Fait parler le segment courant tant que la lecture est active.
  //
  // `volume` et `playbackRate` sont inclus dans les dépendances à dessein :
  // la Web Speech API ne permet pas de modifier ces réglages sur une réplique
  // déjà lancée, donc un changement doit relancer la réplique courante. Les
  // passer par un effet (plutôt que d'appeler `speakSegment` directement
  // depuis les fonctions `setVolume`/`setPlaybackRate`) évite de capturer une
  // valeur de fermeture obsolète : l'effet ne s'exécute qu'une fois l'état
  // réellement mis à jour.
  useEffect(() => {
    if (playing && voices) speakSegment(currentIndex);
    return () => {
      handleRef.current?.cancel();
      stopTick();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentIndex, voices, volume, playbackRate]);

  useEffect(() => () => provider.stop(), [provider]);

  const play = useCallback(() => {
    if (segments.length === 0) return;
    setFinished(false);
    setPlaying(true);
  }, [segments.length]);

  const pause = useCallback(() => {
    setPlaying(false);
    handleRef.current?.cancel();
    stopTick();
  }, [stopTick]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, pause, play]);

  const seekToSegment = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), Math.max(segments.length - 1, 0));
      handleRef.current?.cancel();
      stopTick();
      setElapsedInSegment(0);
      setFinished(false);
      setCurrentIndex(clamped);
    },
    [segments.length, stopTick],
  );

  const next = useCallback(() => seekToSegment(currentIndex + 1), [currentIndex, seekToSegment]);
  const previous = useCallback(() => seekToSegment(currentIndex - 1), [currentIndex, seekToSegment]);

  const totalElapsedEstimate =
    segments.slice(0, currentIndex).reduce((sum, segment) => sum + segment.estimatedDurationSec, 0) +
    elapsedInSegment;

  return {
    available: provider.isAvailable(),
    currentIndex,
    playing,
    finished,
    volume,
    playbackRate,
    elapsedInSegment,
    totalElapsedEstimate,
    play,
    pause,
    toggle,
    next,
    previous,
    seekToSegment,
    setVolume: setVolumeState,
    setPlaybackRate: setPlaybackRateState,
  };
}
