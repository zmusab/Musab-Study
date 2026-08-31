import type { PodcastLength, PodcastSegment } from '@/types';

/**
 * Planification du podcast — logique pure, sans appel IA.
 *
 * Le principe demandé est explicite : ne pas générer 45 minutes pour un cours
 * de 10 pages seulement parce que le modèle peut parler longtemps. La durée
 * choisie fixe donc EN AMONT combien de notions seront extraites et combien de
 * répliques seront demandées au modèle, plutôt que de couper une conversation
 * trop longue après coup.
 */

export interface LengthPreset {
  label: string;
  minMinutes: number;
  maxMinutes: number;
  /** Nombre de notions que l'étape d'analyse doit sélectionner. */
  conceptCount: number;
  /** Nombre de répliques visé pour l'étape de dialogue. */
  segmentBudget: number;
}

export const LENGTH_PRESETS: Record<PodcastLength, LengthPreset> = {
  quick: { label: 'Rapide', minMinutes: 5, maxMinutes: 10, conceptCount: 3, segmentBudget: 14 },
  normal: { label: 'Normal', minMinutes: 15, maxMinutes: 25, conceptCount: 5, segmentBudget: 26 },
  deep: { label: 'Approfondi', minMinutes: 30, maxMinutes: 45, conceptCount: 8, segmentBudget: 42 },
};

/**
 * Vitesse de parole moyenne d'une conversation française naturelle, en
 * caractères par seconde (environ 150 mots/minute, ponctuée de pauses).
 * Sert uniquement à estimer une durée affichable — la vraie durée dépend de la
 * voix effectivement utilisée par le navigateur.
 */
const CHARS_PER_SECOND = 14;
/** Silence entre deux répliques, pour que l'échange respire. */
const PAUSE_BETWEEN_SEGMENTS_SEC = 0.5;

export function estimateSegmentDuration(text: string): number {
  return Math.max(1.2, text.trim().length / CHARS_PER_SECOND);
}

export function estimateTotalDuration(
  segments: Pick<PodcastSegment, 'estimatedDurationSec'>[],
): number {
  if (segments.length === 0) return 0;
  const speaking = segments.reduce((sum, segment) => sum + segment.estimatedDurationSec, 0);
  return speaking + (segments.length - 1) * PAUSE_BETWEEN_SEGMENTS_SEC;
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) return '< 1 min';
  return `${minutes} min`;
}
