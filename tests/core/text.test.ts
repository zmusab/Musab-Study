import { describe, expect, it } from 'vitest';
import {
  FRENCH_STOPWORDS,
  QUESTION_WORDS,
  normalizeText,
  significantWordEntries,
  significantWords,
  singularize,
} from '@/core/text';
import { tokenize } from '@/services/rag/tokenize';

/**
 * `core/text` remplace six implémentations divergentes de la même idée. Ces
 * tests verrouillent surtout ce qui avait causé de vrais bugs : les mots
 * outils comptés comme du contenu, et la nomenclature courte (« V3 ») perdue
 * par un seuil de longueur trop haut.
 */

describe('normalizeText', () => {
  it('met en minuscules et retire les diacritiques', () => {
    expect(normalizeText('Masséter')).toBe('masseter');
    expect(normalizeText('ÉMAIL')).toBe('email');
  });

  it('utilise bien la forme échappée des diacritiques combinants', () => {
    // Piège récurrent du projet : écrire la classe de caractères combinants
    // littéralement au lieu de ̀-ͯ donne un fichier où l'accent est
    // invisible et la regex silencieusement fausse.
    expect(normalizeText('nérf trïjûmeau')).toBe('nerf trijumeau');
  });
});

describe('singularize', () => {
  it('retire un pluriel simple', () => {
    expect(singularize('nerfs')).toBe('nerf');
    expect(singularize('branches')).toBe('branche');
  });

  it('ne touche pas aux mots courts qui finissent par s', () => {
    expect(singularize('os')).toBe('os');
    expect(singularize('vis')).toBe('vis');
  });
});

describe('significantWords', () => {
  it('écarte les mots outils français', () => {
    const words = significantWords('Le nerf trijumeau est sensitif et moteur');
    expect(words.has('est')).toBe(false);
    expect(words.has('et')).toBe(false);
    expect([...words].sort()).toEqual(['moteur', 'nerf', 'sensitif', 'trijumeau']);
  });

  it('conserve la nomenclature de deux caractères — « V3 » ne doit jamais être perdu', () => {
    expect(significantWords('Le nerf mandibulaire V3').has('v3')).toBe(true);
    expect(significantWords('Mesure du pH salivaire').has('ph')).toBe(true);
  });

  it('rapproche singulier et pluriel', () => {
    expect(significantWords('les nerfs crâniens').has('nerf')).toBe(true);
  });

  it('n’écarte les tournures de question que si on le demande', () => {
    const question = 'Explique-moi rapidement le nerf trijumeau stp';
    expect(significantWords(question).has('explique')).toBe(true);
    const asked = significantWords(question, true);
    expect(asked.has('explique')).toBe(false);
    expect(asked.has('rapidement')).toBe(false);
    expect(asked.has('stp')).toBe(false);
    expect([...asked].sort()).toEqual(['nerf', 'trijumeau']);
  });
});

describe('significantWordEntries', () => {
  it('conserve la casse d’origine pour l’affichage, la forme normalisée pour la comparaison', () => {
    const entries = significantWordEntries('Le Nerf Trijumeau');
    expect(entries.map((entry) => entry.original)).toEqual(['Nerf', 'Trijumeau']);
    expect(entries.map((entry) => entry.normalized)).toEqual(['nerf', 'trijumeau']);
  });
});

describe('compatibilité de l’index BM25', () => {
  /*
   * `tokenize` alimente `chunk.termFreq`, qui est PERSISTÉ. Si la liste de
   * mots outils partagée changeait, les index déjà écrits deviendraient
   * incohérents avec les requêtes suivantes — sans qu'aucun autre test ne le
   * voie. Ce test fige donc le comportement attendu de l'indexation.
   */
  it('indexe toujours les termes courts de nomenclature', () => {
    expect(tokenize('nerf mandibulaire V3')).toContain('v3');
  });

  it('n’indexe jamais les mots outils du socle partagé', () => {
    for (const token of tokenize('le nerf est dans la branche')) {
      expect(FRENCH_STOPWORDS.has(token)).toBe(false);
    }
  });

  it('n’applique PAS les mots de question à l’indexation d’un cours', () => {
    // « fait » est une tournure de question, mais dans un cours c'est un mot
    // ordinaire : l'index doit le garder.
    expect(QUESTION_WORDS.has('fait')).toBe(true);
    expect(tokenize('Ce fait anatomique est établi')).toContain('fait');
  });
});
