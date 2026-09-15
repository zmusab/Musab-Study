import { describe, expect, it } from 'vitest';
import { restoreCourseLayout } from '@/services/local/courseLayout';
import { chunkDocument } from '@/services/rag/chunking';
import { buildLocalStudySheet } from '@/services/local/localSummary';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk } from '@/types';

/**
 * RÉSUMÉ ET FICHE, mesurés sur le vrai cours.
 *
 * Ce que « Résumer ce chapitre » rendait pour le cours du trijumeau :
 *
 *     **Le plan de ton cours**, dans son ordre.
 *     ### Le nerf ophtalmique de Willis     ← 4 lignes sur 9
 *     ### Les nerfs palatins (x 3 : …)      ← et c'est tout.
 *
 * DEUX blocs sur six. Les muscles droits, le nerf maxillaire, le nerf
 * mandibulaire et les ganglions disparaissaient — sans un mot, sous un titre
 * qui annonçait « le plan de ton cours ». Annoncer le plan et en livrer le
 * tiers est un mensonge, pas une approximation.
 *
 * La fiche, elle, affichait TROIS fois de suite « Le nerf ophtalmique de
 * Willis » comme intitulé de liste — ses rapports, ses branches, son trajet —
 * sans que rien ne distingue laquelle on lisait.
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

const LOOKUP: ContextLookup = {
  subjects: new Map([['s', { id: 's', name: 'Anatomie', color: '#000', createdAt: '', position: 0 }]]),
  chapters: new Map([['ch', { id: 'ch', subjectId: 's', name: 'Trijumeau', createdAt: '', position: 0 }]]),
  documents: new Map([['doc', { id: 'doc', name: 'trijumeau.pdf' }]]),
};

const chunks = (): DocumentChunk[] =>
  chunkDocument(restoreCourseLayout([REAL_COURSE])).map((draft) => ({
    ...draft,
    id: `c${draft.index}`,
    documentId: 'doc',
    chapterId: 'ch',
    subjectId: 's',
    embedding: null,
  }));

const build = (mode: 'summary' | 'sheet') => buildLocalStudySheet(mode, chunks(), LOOKUP)!.text;

/** Les intertitres rendus, sans le « ### ». */
const headings = (text: string): string[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('### '))
    .map((line) => line.slice(4).trim());

describe('le résumé couvre tout le cours', () => {
  it('cite chacune des grandes parties du document', () => {
    const text = build('summary');
    for (const attendu of [
      'Le nerf ophtalmique de Willis',
      'Les nerfs palatins',
      'muscles droits',
      'Le nerf maxillaire',
      'Le nerf mandibulaire',
    ]) {
      expect(text, `« ${attendu} » manque au plan`).toContain(attendu);
    }
  });

  it('ne promeut pas en intertitre la fin d’une ligne coupée par le découpage', () => {
    /*
      Reproduit le recouvrement AU LIEU de l'espérer : le second fragment
      commence par la FIN d'une ligne du premier, exactement comme le fait le
      découpage réel. Fonder ce test sur les frontières calculées par
      `chunkDocument` le rendait muet dès que le corpus changeait d'un mot.
    */
    const premier = ['Les muscles de l’orbite', '§ Oblique supérieur ou Grand Oblique'].join('\n');
    // La fin de la ligne coupée, SUIVIE d'une puce : sans garde-fou elle se
    // retrouve avec un corps, donc promue intertitre.
    const second = ['supérieur ou Grand Oblique', '§ Oblique inférieur ou Petit Oblique'].join('\n');
    const deux: DocumentChunk[] = [premier, second].map((text, index) => ({
      id: `c${index}`,
      documentId: 'doc',
      chapterId: 'ch',
      subjectId: 's',
      index,
      text,
      charStart: 0,
      charEnd: text.length,
      pageStart: 1,
      pageEnd: 1,
      termFreq: {},
      tokenCount: 0,
      embedding: null,
    }));
    const text = buildLocalStudySheet('summary', deux, LOOKUP)!.text;
    expect(headings(text), 'un bout de ligne est devenu un titre').not.toContain('supérieur ou Grand Oblique');
  });

  it('ne fabrique aucun intertitre à partir d’un bout de ligne', () => {
    /*
      Les fragments se chevauchent : la FIN d'une ligne coupée ouvrait le
      fragment suivant, et le plan s'ornait d'un « ### supérieur ou Grand
      Oblique » — la moitié d'une puce, promue titre.
    */
    for (const heading of headings(build('summary'))) {
      expect(heading[0], `« ${heading} » commence en minuscule : c'est un bout de ligne`).toBe(
        heading[0]!.toUpperCase(),
      );
    }
  });

  it('dit quand un bloc est tronqué, au lieu de le laisser croire complet', () => {
    expect(build('summary')).toMatch(/de plus dans ton cours/);
  });

  it('n’affiche jamais deux fois le même intertitre', () => {
    const list = headings(build('summary'));
    expect(new Set(list).size, list.join(' / ')).toBe(list.length);
  });
});

describe('la fiche de révision', () => {
  it('distingue les énumérations qui partagent un même sujet', () => {
    const text = build('sheet');
    const leads = text
      .split('\n')
      .filter((line) => /^- /.test(line))
      .map((line) => line.slice(2).trim());
    const ophtalmiques = leads.filter((lead) => lead.startsWith('Le nerf ophtalmique de Willis'));
    // Trois listes portaient exactement le même intitulé.
    expect(ophtalmiques.length, ophtalmiques.join(' / ')).toBeLessThan(2);
    expect(text).toContain('se divise en 3 branches terminales');
  });

  it('n’annonce pas un piège pour une simple remarque', () => {
    const text = build('sheet');
    expect(text).not.toContain('Les pièges signalés');
    expect(text).toContain('Ce que ton cours signale à part');
  });
});
