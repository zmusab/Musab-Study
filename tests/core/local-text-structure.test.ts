import { describe, it, expect } from 'vitest';
import {
  splitIntoSentences,
  detectHeadings,
  splitEnumerationItems,
  detectInlineEnumeration,
  detectBulletEnumerations,
  detectLeadingCount,
} from '@/services/local/textStructure';

describe('splitIntoSentences', () => {
  it('découpe sur la ponctuation de fin de phrase', () => {
    expect(splitIntoSentences("L'émail est dur. La pulpe est vascularisée.")).toEqual([
      "L'émail est dur.",
      'La pulpe est vascularisée.',
    ]);
  });

  it('découpe aussi sur les sauts de ligne', () => {
    expect(splitIntoSentences('Titre\nPremière phrase.')).toEqual(['Titre', 'Première phrase.']);
  });

  it('ignore les lignes vides', () => {
    expect(splitIntoSentences('A.\n\n\nB.')).toEqual(['A.', 'B.']);
  });
});

describe('detectHeadings', () => {
  it('détecte une ligne courte suivie d’une ligne plus longue comme titre', () => {
    const text = 'Anatomie du nerf trijumeau\nLe nerf trijumeau est le plus volumineux des nerfs crâniens.';
    expect(detectHeadings(text)).toEqual(['Anatomie du nerf trijumeau']);
  });

  it('ne retient pas une phrase complète comme titre', () => {
    const text = "L'émail dentaire est minéralisé.\nLa dentine l'est un peu moins.";
    expect(detectHeadings(text)).toEqual([]);
  });

  it('ne retient pas une ligne trop longue', () => {
    const long = 'Une ligne assez longue qui ne ressemble pas vraiment à un titre de section courte'.repeat(1);
    expect(detectHeadings(`${long}\nsuite`)).toEqual([]);
  });
});

describe('splitEnumerationItems', () => {
  it('découpe une énumération avec virgules et "et"', () => {
    expect(splitEnumerationItems('ophtalmique, maxillaire et mandibulaire')).toEqual([
      'ophtalmique',
      'maxillaire',
      'mandibulaire',
    ]);
  });

  it('retire les articles en tête de chaque item', () => {
    expect(splitEnumerationItems("l'émail, la dentine et la pulpe")).toEqual(['émail', 'dentine', 'pulpe']);
  });

  it('gère "ou" comme séparateur', () => {
    expect(splitEnumerationItems('vrai ou faux')).toEqual(['vrai', 'faux']);
  });
});

describe('detectInlineEnumeration', () => {
  it('détecte une liste après un deux-points', () => {
    const result = detectInlineEnumeration('Les tissus dentaires : émail, dentine et pulpe.');
    expect(result).not.toBeNull();
    expect(result!.intro).toBe('Les tissus dentaires');
    expect(result!.items).toEqual(['émail', 'dentine', 'pulpe']);
  });

  it('renvoie null sans deux-points', () => {
    expect(detectInlineEnumeration('Aucune liste ici.')).toBeNull();
  });

  it('renvoie null avec un seul item après le deux-points', () => {
    expect(detectInlineEnumeration('Définition : un seul élément.')).toBeNull();
  });
});

describe('detectBulletEnumerations', () => {
  it('regroupe les lignes à puces consécutives avec leur intro', () => {
    const text = 'Les os du crâne :\n- le frontal\n- le pariétal\n- le temporal';
    const results = detectBulletEnumerations(text);
    expect(results).toHaveLength(1);
    expect(results[0]!.intro).toBe('Les os du crâne :');
    expect(results[0]!.items).toEqual(['le frontal', 'le pariétal', 'le temporal']);
  });

  it('ignore une seule ligne à puce isolée (pas une vraie énumération)', () => {
    const text = 'Introduction\n- un seul point\nSuite du texte normal.';
    expect(detectBulletEnumerations(text)).toHaveLength(0);
  });

  it('gère la numérotation comme puce', () => {
    const text = 'Étapes :\n1. Diagnostic\n2. Traitement\n3. Suivi';
    const results = detectBulletEnumerations(text);
    expect(results[0]!.items).toEqual(['Diagnostic', 'Traitement', 'Suivi']);
  });
});

describe('detectLeadingCount', () => {
  it('détecte un nombre écrit en toutes lettres', () => {
    expect(detectLeadingCount('trois branches principales')).toEqual({ word: 'trois', value: 3, noun: 'branches' });
  });

  it('détecte un chiffre', () => {
    expect(detectLeadingCount('12 nerfs crâniens')).toEqual({ word: '12', value: 12, noun: 'nerfs' });
  });

  it('renvoie null sans compte en tête', () => {
    expect(detectLeadingCount('le nerf trijumeau')).toBeNull();
  });
});
