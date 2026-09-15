import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Garde-fou structurel : le moteur pédagogique local ne doit JAMAIS pouvoir
 * dépendre, même indirectement, d'un appel réseau ou de l'orchestrateur IA —
 * c'est ce qui garantit qu'une panne Gemini/OpenAI/Claude ne peut
 * structurellement pas empêcher `findLocalAnswer`/les flashcards/notions
 * locales de répondre. Une simple lecture du SOURCE (pas un mock qu'on
 * pourrait oublier de vérifier) : si l'un de ces fichiers importe un jour
 * `aiOrchestrator` ou `services/ai/*`, ce test casse immédiatement.
 */

const LOCAL_ENGINE_FILES = [
  'src/services/local/textStructure.ts',
  'src/services/local/relationExtraction.ts',
  'src/services/local/localFlashcards.ts',
  'src/services/local/localNotions.ts',
  'src/services/local/localAnswer.ts',
  'src/services/local/citation.ts',
  'src/services/local/textQuality.ts',
];

const FORBIDDEN_PATTERNS = [/aiOrchestrator/, /from ['"]@\/services\/ai\//, /from ['"]\.\.?\/.*services\/ai\//];

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

describe('moteur pédagogique local — aucune dépendance à la couche IA', () => {
  for (const file of LOCAL_ENGINE_FILES) {
    it(`${file} n'importe jamais aiOrchestrator ni services/ai/*`, () => {
      const source = readSource(file);
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(pattern.test(source)).toBe(false);
      }
    });
  }
});
