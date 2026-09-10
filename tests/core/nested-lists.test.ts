import { describe, expect, it } from 'vitest';
import { bulletDepth, detectBulletEnumerations } from '@/services/local/textStructure';
import { extractFacts } from '@/services/local/relationExtraction';
import { restoreCourseLayout } from '@/services/local/courseLayout';
import type { DocumentChunk } from '@/types';

/**
 * LISTES IMBRIQUÉES — la structure que le PDF n'avait pas perdue.
 *
 * On a longtemps cru l'imbrication irrécupérable : l'INDENTATION, en effet,
 * ne survit pas à l'extraction. Mais un polycopié Word attribue un MARQUEUR
 * par niveau et n'en change jamais. Relevé de la position horizontale dans un
 * vrai cours de dentisterie : « • » toujours à x = 71, « § » à x = 107,
 * « o » à x = 125. Le caractère dit la profondeur.
 *
 * Ce que ces tests protègent, c'est le lien entre une ANNONCE et SES
 * ÉLÉMENTS. Les deux moitiés existaient et ne se rejoignaient jamais : la
 * réponse s'arrêtait sur « … se divise en 3 branches terminales : » et les
 * branches n'arrivaient pas.
 */

function chunk(text: string): DocumentChunk {
  return {
    id: 'c1', documentId: 'd1', chapterId: 'ch1', subjectId: 's1', index: 0, text,
    charStart: 0, charEnd: text.length, pageStart: 1, pageEnd: 1,
    termFreq: {}, tokenCount: text.split(/\s+/).length, embedding: null,
  };
}

/** Deux listes sœurs, chacune sous son annonce — la forme exacte du cours réel. */
const TWO_LISTS = [
  '• Puis il entre dans le sinus caverneux où il est en rapport avec :',
  '§ L’artère carotide interne',
  '§ Le sinus caverneux',
  '§ Les nerfs III, IV et VI',
  '• Avant d’entrer dans l’orbite le nerf ophtalmique se divise en 3 branches terminales :',
  '§ Nerf naso-ciliaire',
  '§ Nerf frontal',
  '§ Nerf lacrymal',
].join('\n');

describe('bulletDepth', () => {
  it('lit le niveau dans le marqueur', () => {
    expect(bulletDepth('• Premier niveau')).toBe(0);
    expect(bulletDepth('§ Deuxième niveau')).toBe(1);
    expect(bulletDepth('o Troisième niveau')).toBe(2);
  });

  it('ne voit pas de puce là où il n’y en a pas', () => {
    expect(bulletDepth('Le nerf frontal')).toBeNull();
    expect(bulletDepth('Il chemine sur la paroi supérieure.')).toBeNull();
  });
});

describe('detectBulletEnumerations — une liste s’arrête où son niveau s’arrête', () => {
  it('sépare deux sous-listes sœurs au lieu de les fondre en une', () => {
    const lists = detectBulletEnumerations(TWO_LISTS);
    expect(lists).toHaveLength(2);
    expect(lists[0]!.items).toEqual(['L’artère carotide interne', 'Le sinus caverneux', 'Les nerfs III, IV et VI']);
    expect(lists[1]!.items).toEqual(['Nerf naso-ciliaire', 'Nerf frontal', 'Nerf lacrymal']);
  });

  it('prend pour annonce la puce MOINS PROFONDE qui précède', () => {
    const lists = detectBulletEnumerations(TWO_LISTS);
    expect(lists[1]!.intro).toContain('3 branches terminales');
  });

  /**
   * Le piège exact, mesuré : sans le niveau, l'annonce était prise sur la
   * puce d'avant — c'est-à-dire le DERNIER ÉLÉMENT de la liste précédente.
   * Les trois branches terminales du nerf ophtalmique se retrouvaient rangées
   * sous le titre « Les nerfs III, IV et VI ».
   */
  it('ne prend jamais pour annonce une puce de même niveau', () => {
    const lists = detectBulletEnumerations(TWO_LISTS);
    expect(lists[1]!.intro).not.toContain('Les nerfs III, IV et VI');
  });
});

describe('extractFacts — un fait emporte la liste qui lui appartient', () => {
  it('rattache les éléments à la phrase qui les annonce', () => {
    // Avec son titre de section : c'est la forme réelle du cours, et c'est là
    // que les phrases à pronom vont chercher leur sujet.
    const facts = extractFacts(chunk(`Le nerf ophtalmique de Willis\n${TWO_LISTS}`));
    const branches = facts.find((fact) => fact.sourceExcerpt.includes('3 branches terminales'));

    expect(branches).toBeDefined();
    expect(branches!.items).toEqual(['Nerf naso-ciliaire', 'Nerf frontal', 'Nerf lacrymal']);
    // L'extrait reste un sous-extrait EXACT du fragment, liste comprise.
    expect(TWO_LISTS).toContain(branches!.sourceExcerpt);
  });

  /**
   * « Puis il entre dans le sinus caverneux … en rapport avec : » n'emploie
   * aucun verbe que les règles connaissent, et ne produisait donc AUCUN fait
   * — alors que trois puces la suivent et la complètent. Le sujet vient alors
   * du titre de la section, la phrase commençant par un pronom.
   */
  it('reconnaît une annonce même sans verbe de relation connu', () => {
    const facts = extractFacts(chunk(`Le nerf ophtalmique de Willis\n${TWO_LISTS}`));
    const rapport = facts.find((fact) => fact.sourceExcerpt.includes('en rapport avec'));

    expect(rapport).toBeDefined();
    expect(rapport!.items).toContain('L’artère carotide interne');
    expect(rapport!.subject).toBe('Le nerf ophtalmique de Willis');
  });

  it('ne prend pas une puce pour un titre de section', () => {
    const facts = extractFacts(chunk(`Le nerf ophtalmique de Willis\n${TWO_LISTS}`));
    // « Les nerfs III, IV et VI » est un élément de liste : il ne doit servir
    // de sujet à rien.
    expect(facts.map((fact) => fact.subject)).not.toContain('Les nerfs III, IV et VI');
  });
});

describe('restoreCourseLayout — les renvois au schéma ne coupent pas les phrases', () => {
  /**
   * ❶❷❸ servent de RENVOIS AU SCHÉMA, posés au fil du texte. Les traiter en
   * puces coupait la phrase en deux et le morceau « ❶ ) » se retrouvait seul
   * entre deux éléments — de quoi interrompre une énumération au bout du
   * premier élément.
   */
  it('laisse un renvoi de figure au fil du texte', () => {
    const text = restoreCourseLayout([
      '§ Une branche pour le ganglion ophtalmique : la racine longue %❶) § Une branche pour les nerfs ciliaires %❷) qui entrent dans l’œil',
    ]);
    const items = text.split('\n').filter((line) => line.startsWith('§'));
    expect(items).toHaveLength(2);
    expect(items[1]).toContain('qui entrent dans l’œil');
  });

  it('ouvre encore une ligne sur une puce cerclée suivie d’une majuscule', () => {
    const text = restoreCourseLayout(['❶ Première partie ❷ Deuxième partie']);
    expect(text.split('\n').filter((line) => line.startsWith('❶') || line.startsWith('❷'))).toHaveLength(2);
  });
});
