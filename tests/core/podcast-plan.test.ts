import { describe, it, expect } from 'vitest';
import {
  LENGTH_PRESETS,
  estimateSegmentDuration,
  estimateTotalDuration,
  formatDuration,
} from '@/services/podcast/plan';

describe('LENGTH_PRESETS', () => {
  it('augmente la durée et le nombre de notions avec la profondeur', () => {
    expect(LENGTH_PRESETS.quick.maxMinutes).toBeLessThan(LENGTH_PRESETS.normal.maxMinutes);
    expect(LENGTH_PRESETS.normal.maxMinutes).toBeLessThan(LENGTH_PRESETS.deep.maxMinutes);
    expect(LENGTH_PRESETS.quick.conceptCount).toBeLessThan(LENGTH_PRESETS.deep.conceptCount);
  });

  it('ne demande jamais un podcast de 45 minutes pour un format rapide', () => {
    // Le principe central de la demande : la durée choisie borne le contenu
    // généré, elle ne le coupe pas après coup.
    expect(LENGTH_PRESETS.quick.maxMinutes).toBeLessThanOrEqual(10);
  });
});

describe('estimateSegmentDuration', () => {
  it('donne une durée minimale même pour un texte très court', () => {
    expect(estimateSegmentDuration('Oui.')).toBeGreaterThanOrEqual(1.2);
  });

  it('croît avec la longueur du texte', () => {
    expect(estimateSegmentDuration('Une phrase assez longue pour tester.'.repeat(5))).toBeGreaterThan(
      estimateSegmentDuration('Court.'),
    );
  });
});

describe('estimateTotalDuration', () => {
  it('vaut 0 sans segment', () => {
    expect(estimateTotalDuration([])).toBe(0);
  });

  it('additionne les segments et les pauses entre eux', () => {
    const segments = [{ estimatedDurationSec: 3 }, { estimatedDurationSec: 4 }];
    const total = estimateTotalDuration(segments);
    expect(total).toBeGreaterThan(7); // 3 + 4 + au moins une pause
  });

  it('n’ajoute pas de pause pour un seul segment', () => {
    expect(estimateTotalDuration([{ estimatedDurationSec: 5 }])).toBe(5);
  });
});

describe('formatDuration', () => {
  it('arrondit en minutes', () => {
    expect(formatDuration(125)).toBe('2 min');
  });

  it('signale les durées inférieures à une minute', () => {
    expect(formatDuration(20)).toBe('< 1 min');
  });
});
