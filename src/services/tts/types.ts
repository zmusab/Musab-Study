import type { PodcastSpeakerId } from '@/types';

/**
 * Abstraction de synthèse vocale.
 *
 * Un seul fournisseur existe aujourd'hui (`webSpeechProvider`, l'API native du
 * navigateur — voir `webSpeech.ts`). Cette interface est le point d'extension
 * prévu pour brancher plus tard un fournisseur cloud (voix plus naturelles,
 * cohérentes sur tous les appareils) sans toucher au lecteur ni au pipeline de
 * génération : seul un nouveau fichier implémentant `TtsProvider` serait
 * nécessaire.
 */

export interface TtsVoiceProfile {
  /** Nom de la voix système choisie, pour affichage/diagnostic. */
  voiceName: string | null;
  pitch: number;
  rate: number;
}

export interface TtsUtteranceHandle {
  cancel: () => void;
}

export interface TtsProvider {
  readonly id: string;
  /** Faux si aucune voix française n'est disponible sur cet appareil. */
  isAvailable(): boolean;
  /** Attribue une voix distincte à chaque personnage, si l'appareil le permet. */
  resolveVoices(): Promise<Record<PodcastSpeakerId, TtsVoiceProfile>>;
  speak(
    text: string,
    voice: TtsVoiceProfile,
    volume: number,
    playbackRate: number,
    onEnd: (interrupted: boolean) => void,
  ): TtsUtteranceHandle;
  stop(): void;
}
