import { describe, expect, it } from 'vitest';
import { evaluateAnswer } from '@/core/revisions/evaluateAnswer';

/**
 * Corrige le signalement utilisateur : "Jsp" face à "Composé par 2 parties :"
 * n'était affiché que comme "Assez différente" — pas assez explicite. Ces
 * tests couvrent exactement les exemples fournis, plus les cas limites
 * (Vrai/Faux, réponse vide, indétermination) exigés dans la demande.
 */

describe('evaluateAnswer — réponse générale', () => {
  it('réponse exactement correcte (même formulation)', () => {
    const result = evaluateAnswer(
      'Le nerf trijumeau est sensitif et moteur',
      'Le nerf trijumeau est sensitif et moteur',
    );
    expect(result.verdict).toBe('correct');
  });

  it('réponse correcte insensible à la casse et aux accents', () => {
    const result = evaluateAnswer('le nérf trïjûmeau', 'Le nerf trijumeau');
    expect(result.verdict).toBe('correct');
  });

  it('réponse clairement incorrecte ("Jsp" vs "Composé par 2 parties :")', () => {
    const result = evaluateAnswer('Jsp', 'Composé par 2 parties :');
    expect(result.verdict).toBe('incorrect');
  });

  it('réponse partiellement correcte — il manque la composante motrice', () => {
    const result = evaluateAnswer(
      'Le nerf trijumeau est sensitif',
      'Le nerf trijumeau est sensitif et moteur',
    );
    expect(result.verdict).toBe('partial');
    expect(result.explanation).toBeTruthy();
    expect(result.explanation?.toLowerCase()).toContain('moteur');
  });

  it("l'explication d'une réponse partielle ne cite que des mots réellement présents dans la réponse attendue (jamais inventée)", () => {
    const expected = 'Le nerf facial commande les muscles de la mimique et la glande lacrymale';
    const result = evaluateAnswer('Le nerf facial commande les muscles de la mimique', expected);
    expect(result.verdict).toBe('partial');
    const words = expected.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
    for (const term of result.explanation!.toLowerCase().match(/[a-zà-ÿ]+/g) ?? []) {
      if (['une', 'partie', 'importante', 'de', 'la', 'réponse', 'est', 'présente', 'mais', 'il', 'manque'].includes(term))
        continue;
      expect(words).toContain(term);
    }
  });

  it('réponse très éloignée', () => {
    const result = evaluateAnswer('Douze paires de nerfs crâniens', 'Le nerf trijumeau innerve le masséter');
    expect(result.verdict).toBe('incorrect');
  });

  it('réponse vide → indéterminée', () => {
    const result = evaluateAnswer('', 'Le nerf trijumeau.');
    expect(result.verdict).toBe('indeterminate');
    const blank = evaluateAnswer('   ', 'Le nerf trijumeau.');
    expect(blank.verdict).toBe('indeterminate');
  });

  it('réponse attendue sans mot exploitable (elle-même un artefact) → indéterminée, jamais devinée', () => {
    const result = evaluateAnswer('Le nerf trijumeau', '→');
    expect(result.verdict).toBe('indeterminate');
  });
});

describe('evaluateAnswer — cas Vrai/Faux', () => {
  it('Vrai/Faux correct', () => {
    expect(evaluateAnswer('Faux', 'Faux').verdict).toBe('correct');
    expect(evaluateAnswer('Vrai', 'Vrai').verdict).toBe('correct');
  });

  it('Vrai/Faux incorrect', () => {
    expect(evaluateAnswer('Vrai', 'Faux').verdict).toBe('incorrect');
    expect(evaluateAnswer('Faux', 'Vrai').verdict).toBe('incorrect');
  });

  it('Vrai/Faux insensible à la casse/accents et aux abréviations courantes', () => {
    expect(evaluateAnswer('vrai', 'Vrai').verdict).toBe('correct');
    expect(evaluateAnswer('v', 'Vrai').verdict).toBe('correct');
    expect(evaluateAnswer('F', 'Faux').verdict).toBe('correct');
  });

  it('Vrai/Faux : réponse étudiant non reconnue → indéterminée, jamais devinée', () => {
    const result = evaluateAnswer('Je ne sais pas trop', 'Vrai');
    expect(result.verdict).toBe('indeterminate');
  });
});

describe('evaluateAnswer — n’importe jamais la couche IA', () => {
  it('ne dépend d’aucun module aiOrchestrator/services/ai (lecture du code source)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'src/core/revisions/evaluateAnswer.ts'), 'utf-8');
    expect(/aiOrchestrator/.test(source)).toBe(false);
    expect(/from ['"]@\/services\/ai\//.test(source)).toBe(false);
  });
});
