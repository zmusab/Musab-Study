import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '@/services/ai/parsing';
import { AiRequestError } from '@/services/ai/types';

describe('extractJsonObject', () => {
  it('extrait un objet JSON même entouré de texte ou de balises de code', () => {
    expect(extractJsonObject<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject<{ a: number }>('Voici : {"a":1} merci')).toEqual({ a: 1 });
  });

  it('rejette une réponse sans objet JSON', () => {
    expect(() => extractJsonObject('pas de json ici')).toThrow(AiRequestError);
  });

  it('rejette un tableau — un objet est attendu, pas une liste', () => {
    expect(() => extractJsonObject('[1,2,3]')).toThrow(AiRequestError);
  });
});
