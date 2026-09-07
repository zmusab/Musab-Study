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

/**
 * Correctifs du diagnostic : le moteur rendait le même verdict « partiel » à
 * une reformulation juste, à une contradiction et à une négation. Ces tests
 * verrouillent la distinction.
 */
describe('evaluateAnswer — ne réclame pas ce que la question donne déjà', () => {
  const QUESTION = 'Qu’est-ce que le nerf trijumeau ?';
  const EXPECTED = 'Le nerf trijumeau est sensitif et moteur';

  it('une reformulation juste est CORRECTE, pas « partielle »', () => {
    const result = evaluateAnswer('Il est à la fois sensitif et moteur', EXPECTED, QUESTION);
    expect(result.verdict).toBe('correct');
  });

  it('une réponse télégraphique mais complète est CORRECTE', () => {
    expect(evaluateAnswer('sensitif et moteur', EXPECTED, QUESTION).verdict).toBe('correct');
  });

  it('ne reproche jamais à l’étudiant d’avoir omis le sujet écrit dans la question', () => {
    const result = evaluateAnswer('Il est sensitif', EXPECTED, QUESTION);
    expect(result.verdict).toBe('partial');
    expect(result.explanation).toContain('moteur');
    expect(result.explanation).not.toContain('trijumeau');
  });

  it('les mots outils ne sont jamais comptés comme du contenu manquant', () => {
    const result = evaluateAnswer('Il est sensitif', EXPECTED, QUESTION);
    // Seule la LISTE après « il manque : » est examinée : le gabarit de phrase
    // contient lui-même « est » (« la réponse est présente »), qui n'a rien à
    // voir avec les mots réclamés à l'étudiant.
    const missingList = result.explanation!.split('il manque :')[1]!;
    const missingWords = missingList.split(',').map((word) => word.replace(/\W/g, ''));
    expect(missingWords).toEqual(['moteur']);
  });

  it('quand la réponse attendue n’ajoute rien à la question, le moteur s’abstient', () => {
    const result = evaluateAnswer('oui', 'Le nerf trijumeau', 'Quel est le nerf trijumeau ?');
    expect(result.verdict).toBe('indeterminate');
  });
});

describe('evaluateAnswer — contradictions : faux, jamais « partiellement correct »', () => {
  const QUESTION = 'Qu’est-ce que le nerf trijumeau ?';
  const EXPECTED = 'Le nerf trijumeau est sensitif et moteur';

  it('une réponse exclusive qui omet une partie attendue est INCORRECTE', () => {
    const result = evaluateAnswer('Le nerf trijumeau est uniquement sensitif', EXPECTED, QUESTION);
    expect(result.verdict).toBe('incorrect');
    expect(result.explanation).toContain('moteur');
  });

  it.each(['seulement sensitif', 'exclusivement sensitif'])(
    '« %s » est également traité comme exclusif',
    (attempt) => {
      expect(evaluateAnswer(attempt, EXPECTED, QUESTION).verdict).toBe('incorrect');
    },
  );

  it('une négation face à un énoncé affirmatif est INCORRECTE', () => {
    const result = evaluateAnswer(
      'Le nerf trijumeau ne possède pas de branche motrice',
      EXPECTED,
      QUESTION,
    );
    expect(result.verdict).toBe('incorrect');
    expect(result.explanation).toContain('contraire');
  });

  it('deux énoncés négatifs concordants ne sont PAS traités comme une contradiction', () => {
    const expected = 'L’émail ne contient aucune cellule vivante';
    const result = evaluateAnswer('Il ne contient aucune cellule vivante', expected, 'Qu’est-ce que l’émail ?');
    expect(result.verdict).toBe('correct');
  });

  it('omettre la négation d’une réponse attendue négative est INCORRECT', () => {
    const expected = 'L’émail ne contient aucune cellule vivante';
    const result = evaluateAnswer('Il contient des cellules vivantes', expected, 'Qu’est-ce que l’émail ?');
    expect(result.verdict).toBe('incorrect');
  });
});
