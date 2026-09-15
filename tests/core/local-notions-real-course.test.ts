import { describe, expect, it } from 'vitest';
import { restoreCourseLayout } from '@/services/local/courseLayout';
import { chunkDocument } from '@/services/rag/chunking';
import { generateLocalNotions } from '@/services/local/localNotions';
import type { DocumentChunk } from '@/types';

/**
 * LES NOTIONS D'UN CHAPITRE, mesurées sur le vrai cours.
 *
 * Ce que la page « Notions » affichait pour le chapitre du trijumeau :
 *
 *     • Le nerf ophtalmique de Willis          ← rien d'autre
 *     • Chaque branche du nerf trijumeau       ← rien d'autre
 *     • Les nerfs palatins (x 3 : …)           ← rien d'autre
 *     • 4 muscles droits                       ← rien d'autre
 *     • Le nerf maxillaire — un nerf sensitif
 *     • Le nerf maxillaire est un nerf sensitif. ← la MÊME, mal nommée
 *
 * Six notions sur huit sans définition : un libellé seul n'apprend rien, et
 * deux entrées pour la même notion font douter des six autres.
 */

const REAL_COURSE = [
  'Le nerf ophtalmique de Willis',
  '• Il chemine par le canal le plus interne de Cavum Meckeli',
  '• Puis il entre dans le sillon carotidien où il est en rapport avec :',
  '§ L’artère carotide interne',
  '§ Le sinus caverneux',
  '§ Les nerf III, IV et VI',
  '• Le nerf ophtalmique de Willis se divise en 3 branches terminales :',
  '§ Nerf naso-cilliaire',
  '§ Nerf frontal',
  '§ Nerf lacrymal',
  '• Chaque branche du nerf trijumeau a attaché sur son trajet un ganglion nerveux :',
  '§ Sur trajet du nerf ophtalmique : ganglion ophtalmique',
  '§ Sur trajet du nerf maxillaire : ganglion sphéno-palatin',
  'Ensuite, par une branche du nerf facial qui est le grand pétreux superficiel, celui-ci transporte la fibre lacrymale.',
  'Les nerfs palatins (x 3 : antérieur, moyen postérieur) :',
  '→ ANTERIEUR : il descend au niveau de la cavité buccale par le grand canal palatin.',
  '→ MOYEN : il descend par un canal palatin accessoire.',
  'Remarque : Le nerf alvéolaire supérieur moyen peut exister.',
  'PS : dans la partie interne de la fosse orbitaire il y a la fossette trochléaire.',
  '4 muscles droits :',
  '§ Droit supérieur',
  '§ Droit inférieur',
  '§ Droit médial',
  '§ Droit latéral',
  '• Et 2 muscles obliques :',
  '§ Oblique supérieur ou Grand Oblique',
  '§ Oblique inférieur ou Petit Oblique',
  'Le nerf maxillaire est un nerf sensitif.',
  '• Il sort du crâne par le foramen rond.',
  '• Il donne le nerf infra-orbitaire qui innerve la paupière inférieure, l’aile du nez et la lèvre supérieure.',
  'Le nerf mandibulaire est un nerf mixte, sensitif et moteur.',
  '• Il sort du crâne par le foramen ovale.',
  '• Il donne le nerf lingual et le nerf alvéolaire inférieur.',
].join('\n');

const notions = () => {
  const chunks: DocumentChunk[] = chunkDocument(restoreCourseLayout([REAL_COURSE])).map((draft) => ({
    ...draft,
    id: `c${draft.index}`,
    documentId: 'doc',
    chapterId: 'ch',
    subjectId: 's',
    embedding: null,
  }));
  return generateLocalNotions({ chunks, count: 20 });
};

describe('les notions tirées du vrai cours', () => {
  it('donnent TOUTES quelque chose à apprendre, pas juste un intitulé', () => {
    const sans = notions().filter((notion) => notion.definition === null);
    expect(sans.map((notion) => notion.label)).toEqual([]);
  });

  it('n’affichent pas deux fois la même notion sous deux libellés', () => {
    const labels = notions().map((notion) => notion.label);
    for (const label of labels) {
      const prolongements = labels.filter((autre) => autre !== label && autre.startsWith(`${label} `));
      expect(prolongements, `« ${label} » apparaît aussi comme ${prolongements.join(' / ')}`).toEqual([]);
    }
  });

  it('le libellé d’une notion n’est pas une phrase entière', () => {
    for (const notion of notions()) {
      expect(notion.label, `« ${notion.label} » est une phrase, pas un intitulé`).not.toMatch(/[.!?]$/);
    }
  });

  it('une énumération nommée et comptée n’est jamais en importance minimale', () => {
    // C'est précisément ce qui tombe à l'examen : « 4 muscles droits », « les
    // nerfs palatins (x 3) ». Elles sortaient au plancher, faute de phrase
    // de définition et d'une seconde occurrence.
    const listes = notions().filter((notion) => /muscles droits|palatins/i.test(notion.label));
    expect(listes.length).toBeGreaterThan(0);
    for (const notion of listes) {
      expect(notion.importance, `« ${notion.label} » en importance ${notion.importance}`).toBeGreaterThan(1);
    }
  });

  it('cite le cours sans coordonner deux phrases par « et »', () => {
    for (const notion of notions()) {
      expect(notion.definition, `« ${notion.label} » : « ${notion.definition} »`).not.toMatch(/\.\s+et\s/);
    }
  });

  it('une définition explicite reste la définition', () => {
    const maxillaire = notions().find((notion) => notion.label === 'Le nerf maxillaire');
    expect(maxillaire?.definition).toBe('un nerf sensitif');
    expect(maxillaire?.importance).toBe(3);
  });
});
