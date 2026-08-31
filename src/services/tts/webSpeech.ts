import type { PodcastSpeakerId } from '@/types';
import type { TtsProvider, TtsUtteranceHandle, TtsVoiceProfile } from './types';

/**
 * Synthèse vocale via l'API native du navigateur (Web Speech API).
 *
 * C'est un choix assumé plutôt qu'une solution d'attente : Anthropic ne
 * fournit pas d'API de synthèse vocale, et la consigne était explicite —
 * « ne simule pas un fichier audio qui n'existe pas ». Le navigateur produit
 * ici un VRAI son, sans clé, sans coût, hors ligne une fois les voix
 * installées. iPadOS et iOS embarquent de bonnes voix françaises (celles de
 * VoiceOver/Siri), ce qui rend ce choix particulièrement adapté à l'usage visé.
 *
 * Limite assumée : la disponibilité et la qualité des voix dépendent de
 * l'appareil et du navigateur. `isAvailable()` le détecte plutôt que de
 * prétendre à un résultat garanti.
 */

function hasSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Attend le chargement asynchrone des voix (Chrome notamment ne les expose pas immédiatement). */
function waitForVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const immediate = synth.getVoices();
    if (immediate.length > 0) {
      resolve(immediate);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(synth.getVoices());
    };
    const onVoicesChanged = () => finish();

    synth.addEventListener('voiceschanged', onVoicesChanged);
    window.setTimeout(finish, timeoutMs);
  });
}

const FEMALE_NAME_HINTS = ['amélie', 'amelie', 'audrey', 'aurélie', 'aurelie', 'léa', 'lea', 'marie', 'julie', 'chantal', 'céline', 'celine', 'virginie', 'female'];
const MALE_NAME_HINTS = ['thomas', 'nicolas', 'daniel', 'bruno', 'guillaume', 'male'];

function guessGender(voice: SpeechSynthesisVoice): 'female' | 'male' | 'unknown' {
  const name = voice.name.toLowerCase();
  if (FEMALE_NAME_HINTS.some((hint) => name.includes(hint))) return 'female';
  if (MALE_NAME_HINTS.some((hint) => name.includes(hint))) return 'male';
  return 'unknown';
}

function pickFrenchVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices.filter((voice) => voice.lang.toLowerCase().startsWith('fr'));
}

class WebSpeechProvider implements TtsProvider {
  readonly id = 'web-speech';
  private cachedVoices: SpeechSynthesisVoice[] | null = null;

  isAvailable(): boolean {
    return hasSpeechSynthesis();
  }

  async resolveVoices(): Promise<Record<PodcastSpeakerId, TtsVoiceProfile>> {
    if (!hasSpeechSynthesis()) {
      return {
        A: { voiceName: null, pitch: 1, rate: 1 },
        B: { voiceName: null, pitch: 1, rate: 1 },
      };
    }

    const french = pickFrenchVoices(this.cachedVoices ?? (await waitForVoices()));
    this.cachedVoices = french.length > 0 ? french : this.cachedVoices;

    if (french.length === 0) {
      return {
        A: { voiceName: null, pitch: 1, rate: 1 },
        B: { voiceName: null, pitch: 1, rate: 1 },
      };
    }

    const female = french.find((voice) => guessGender(voice) === 'female');
    const male = french.find((voice) => guessGender(voice) === 'male');

    // Une voix distincte par personnage quand c'est possible ; sinon la même
    // voix, différenciée par la hauteur et le débit — moins net, mais jamais
    // un silence.
    const voiceA = female ?? french[0]!;
    const voiceB = male && male !== voiceA ? male : (french.find((v) => v !== voiceA) ?? voiceA);

    return {
      A: { voiceName: voiceA.name, pitch: 1.04, rate: 0.98 },
      B: { voiceName: voiceB.name, pitch: 0.94, rate: 1.02 },
    };
  }

  speak(
    text: string,
    voice: TtsVoiceProfile,
    volume: number,
    playbackRate: number,
    onEnd: (interrupted: boolean) => void,
  ): TtsUtteranceHandle {
    if (!hasSpeechSynthesis()) {
      onEnd(true);
      return { cancel: () => {} };
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';
    utterance.pitch = voice.pitch;
    // Le débit se compose de la voix (légère différence entre A et B) et du
    // réglage utilisateur (0,75× à 2×), borné à l'intervalle accepté par l'API.
    utterance.rate = Math.min(3, Math.max(0.4, voice.rate * playbackRate));
    utterance.volume = volume;

    if (voice.voiceName) {
      const match = (this.cachedVoices ?? []).find((v) => v.name === voice.voiceName);
      if (match) utterance.voice = match;
    }

    let cancelledByUs = false;
    utterance.onend = () => onEnd(cancelledByUs);
    utterance.onerror = () => onEnd(true);

    window.speechSynthesis.speak(utterance);

    return {
      cancel: () => {
        cancelledByUs = true;
        window.speechSynthesis.cancel();
      },
    };
  }

  stop(): void {
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
  }
}

export const webSpeechProvider: TtsProvider = new WebSpeechProvider();
