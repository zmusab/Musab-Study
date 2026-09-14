import { describe, expect, it } from 'vitest';
import { restoreCourseLayout } from '@/services/local/courseLayout';
import { chunkDocument } from '@/services/rag/chunking';
import { findLocalAnswer } from '@/services/local/localAnswer';
import { bm25Retriever } from '@/services/rag/retrieval';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk } from '@/types';

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



/**
 * CE QUE LE MOTEUR LOCAL RÉPOND VRAIMENT, SUR LE VRAI COURS.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 * Mille cent quarante tests passaient au vert pendant que ces questions-là,
 * posées sur le polycopié du trijumeau, recevaient ceci :
 *
 *     Q : « Qu'est-ce que le nerf infra-orbitaire ? »
 *     R : « 4 muscles droits : Droit supérieur, Droit inférieur… »
 *
 *     Q : « Qu'innerve le nerf lingual ? »
 *     R : « 4 muscles droits : Droit supérieur, Droit inférieur… »
 *
 *     Q : « Quel ganglion est sur le trajet du nerf maxillaire ? »
 *     R : la section du nerf OPHTALMIQUE, qui ne répond pas.
 *
 * Quatre réponses acceptables sur douze. La cause était unique : une section
 * était retenue parce que les termes s'y trouvaient QUELQUE PART, puis rendue
 * par ses PREMIÈRES lignes — qui ne sont pas celles qui répondent.
 *
 * ── Ce que ce fichier garantit ────────────────────────────────────────────
 * Pour chaque question, la réponse DOIT contenir la ligne du cours qui y
 * répond, et NE DOIT PAS contenir les lignes qui parlent d'autre chose. Un
 * test qui vérifierait seulement « une réponse est rendue » laisserait
 * repasser exactement le défaut d'origine.
 */

interface Attendu {
  question: string;
  /** Doit s'y trouver — c'est la ligne du cours qui répond. */
  contient: string[];
  /** Ne doit PAS s'y trouver — c'est ce que le moteur renvoyait à tort. */
  exclut?: string[];
}

const ATTENDUS: Attendu[] = [
  {
    question: 'Quelles sont les branches terminales du nerf ophtalmique ?',
    contient: ['Nerf naso-cilliaire', 'Nerf frontal', 'Nerf lacrymal'],
    exclut: ['muscles droits'],
  },
  {
    question: 'Par où sort le nerf maxillaire ?',
    contient: ['foramen rond'],
    exclut: ['foramen ovale'],
  },
  {
    question: 'Le nerf mandibulaire est-il sensitif ou moteur ?',
    contient: ['mixte, sensitif et moteur'],
  },
  {
    question: 'Qu’est-ce que le nerf infra-orbitaire ?',
    contient: ['infra-orbitaire', 'paupière inférieure'],
    exclut: ['muscles droits', 'fossette trochléaire', 'palatin'],
  },
  {
    question: 'Combien y a-t-il de muscles droits ?',
    contient: ['Droit supérieur', 'Droit médial'],
  },
  {
    question: 'Où se situe la fossette trochléaire ?',
    contient: ['fosse orbitaire'],
    exclut: ['muscles droits', 'Droit supérieur'],
  },
  {
    question: 'Quels sont les nerfs palatins ?',
    contient: ['ANTERIEUR', 'grand canal palatin'],
    exclut: ['muscles droits'],
  },
  {
    question: 'Explique-moi le nerf ophtalmique de Willis',
    contient: ['Cavum Meckeli', 'sillon carotidien'],
    // La section des nerfs palatins était collée à la suite, sans rapport.
    exclut: ['canal palatin', 'muscles droits'],
  },
  {
    question: 'Quel ganglion est sur le trajet du nerf maxillaire ?',
    contient: ['ganglion sphéno-palatin'],
    // Les bonnes lignes s'affichaient sous le titre « Le nerf ophtalmique de
    // Willis » — la section où elles se trouvent. Le titre annonçait donc le
    // contraire de la réponse.
    exclut: ['Cavum Meckeli', 'muscles droits', '**Le nerf ophtalmique'],
  },
  {
    question: 'C’est quoi le cavum de Meckel ?',
    contient: ['Cavum Meckeli'],
    exclut: ['muscles droits', 'palatin'],
  },
  {
    question: 'Qu’innerve le nerf lingual ?',
    contient: ['nerf lingual'],
    exclut: ['muscles droits', 'fossette'],
  },
];

describe('le moteur local répond sur le vrai cours', () => {
  const chunks: DocumentChunk[] = chunkDocument(restoreCourseLayout([REAL_COURSE])).map((draft) => ({
    ...draft,
    id: `c${draft.index}`,
    documentId: 'doc',
    chapterId: 'ch',
    subjectId: 's',
    embedding: null,
  }));

  const repondre = (question: string): string | null =>
    findLocalAnswer(question, bm25Retriever.retrieve(question, chunks, 6), LOOKUP)?.text ?? null;

  for (const { question, contient, exclut } of ATTENDUS) {
    it(`répond juste à « ${question} »`, () => {
      const reponse = repondre(question);
      expect(reponse, 'le moteur s’abstient alors que le cours répond').not.toBeNull();
      for (const attendu of contient) {
        expect(reponse, `devrait citer « ${attendu} »`).toContain(attendu);
      }
      for (const interdit of exclut ?? []) {
        expect(reponse?.toLowerCase(), `ne devrait PAS parler de « ${interdit} »`).not.toContain(
          interdit.toLowerCase(),
        );
      }
    });
  }

  it('ne répète jamais deux fois la même ligne', () => {
    for (const { question } of ATTENDUS) {
      const lignes = (repondre(question) ?? '')
        .split('\n')
        .map((ligne) => ligne.replace(/^[\s*-]+/, '').trim())
        .filter((ligne) => ligne.length > 12 && !ligne.startsWith('_'));
      expect(new Set(lignes).size, `« ${question} » se répète`).toBe(lignes.length);
    }
  });

  it('s’abstient plutôt que de répondre à côté quand le cours ne dit rien', () => {
    expect(repondre('Quelle est la vascularisation du ligament parodontal ?')).toBeNull();
  });

  /*
    LA DOUZIÈME QUESTION.

    « Quelle est la différence entre le nerf maxillaire et le nerf
    mandibulaire ? » était la seule des douze à rester sans réponse, alors que
    le cours définit les deux : « … est un nerf sensitif », « … est un nerf
    mixte, sensitif et moteur ». Le moteur cherchait une ligne parlant des
    DEUX à la fois — elle n'existe pas, et n'a pas à exister.
  */
  describe('les questions de comparaison', () => {
    it('met les deux notions côte à côte, chacune telle que le cours la décrit', () => {
      const reponse = repondre('Quelle est la différence entre le nerf maxillaire et le nerf mandibulaire ?');
      expect(reponse).not.toBeNull();
      expect(reponse).toContain('### Le nerf maxillaire');
      expect(reponse).toContain('### Le nerf mandibulaire');
      expect(reponse).toContain('nerf sensitif');
      expect(reponse).toContain('mixte, sensitif et moteur');
    });

    it('ne conclut jamais la comparaison à la place de l’étudiant', () => {
      const reponse = repondre('Quelle est la différence entre le nerf maxillaire et le nerf mandibulaire ?');
      // Le moteur ne sait pas comparer ; l'affirmer serait inventer.
      expect(reponse).not.toMatch(/la différence est|contrairement à|alors que le/i);
      expect(reponse).toContain('c’est à toi de la faire');
    });

    it('s’abstient quand un seul des deux côtés est documenté', () => {
      // Une comparaison à moitié documentée induit en erreur plus qu'elle n'aide.
      expect(repondre('Quelle est la différence entre le nerf maxillaire et le nerf vestibulo-cochléaire ?')).toBeNull();
    });

    it('s’abstient quand la question ne nomme pas ses deux côtés', () => {
      expect(repondre('Quelle est la différence entre les deux ?')).toBeNull();
    });
  });

  /*
    UNE SECTION TITRÉE S'ARRÊTE AU SUJET SUIVANT.

    Un polycopié n'intitule pas tout : « Le nerf maxillaire est un nerf
    sensitif. » est une phrase ordinaire, donc le découpage en sections la
    range sous le titre précédent. La réponse sur le nerf OPHTALMIQUE
    enchaînait alors sur le maxillaire puis le mandibulaire, comme si le cours
    en parlait au même endroit. Dans une section, le contenu est à puces :
    une ligne NUE qui revient plus bas ouvre autre chose.
  */
  it('ne fait pas déborder une section titrée sur le sujet suivant', () => {
    const court = [
      'Le nerf ophtalmique de Willis',
      '• Il chemine par le canal le plus interne de Cavum Meckeli',
      'Le nerf maxillaire est un nerf sensitif.',
      '• Il sort du crâne par le foramen rond.',
      'Le nerf mandibulaire est un nerf mixte, sensitif et moteur.',
      '• Il sort du crâne par le foramen ovale.',
    ].join('\n');
    const petits: DocumentChunk[] = chunkDocument(restoreCourseLayout([court])).map((draft) => ({
      ...draft,
      id: `p${draft.index}`,
      documentId: 'doc',
      chapterId: 'ch',
      subjectId: 's',
      embedding: null,
    }));
    const question = 'Explique-moi le nerf ophtalmique de Willis';
    const reponse = findLocalAnswer(question, bm25Retriever.retrieve(question, petits, 6), LOOKUP)?.text ?? '';
    expect(reponse).toContain('Cavum Meckeli');
    expect(reponse).not.toContain('foramen ovale');
    expect(reponse).not.toContain('mixte, sensitif et moteur');
  });
});
