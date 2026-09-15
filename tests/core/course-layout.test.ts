import { describe, expect, it } from 'vitest';
import { restoreCourseLayout, restoreCourseLayoutPages, stripRunningHeaders } from '@/services/local/courseLayout';
import { chunkDocument } from '@/services/rag/chunking';
import { extractFacts } from '@/services/local/relationExtraction';
import { findLocalAnswer } from '@/services/local/localAnswer';
import type { DocumentChunk } from '@/types';

/**
 * NON-RÉGRESSION SUR UN POLYCOPIÉ RÉEL.
 *
 * Ces pages reproduisent, en miniature, les quatre pathologies mesurées sur un
 * vrai cours de dentisterie exporté en PDF — celui qui a révélé que le moteur
 * local extrayait 14 faits de 10 pages et ne répondait à AUCUNE des huit
 * questions de contrôle, « nerf trijumeau » compris :
 *
 *  1. chaque page est APLATIE sur une seule ligne (pdf.js joint tous les items
 *     par des espaces, aucun retour à la ligne ne survit) ;
 *  2. les puces sont des « § » et des glyphes de police symbole rendus « " » ;
 *  3. un en-tête courant se répète en tête de chaque page ;
 *  4. des accents sont détachés de leur lettre (« sph é no-palatin ») et des
 *     traits d'union espacés (« naso - ciliaire »).
 *
 * Le contenu est inventé pour le test ; seules les DÉFORMATIONS sont réelles.
 */
const PAGES = [
  'ANATOMIE - LE NERF TRIJUMEAU 1 " Le nerf trijumeau Il se divise en trois branches principales. " Le nerf ophtalmique Il chemine par le canal le plus interne. Il donne trois branches terminales : § Nerf naso - ciliaire § Nerf frontal § Nerf lacrymal',
  'ANATOMIE - LE NERF TRIJUMEAU 2 " Nerf frontal Il entre dans l’orbite par la fissure orbitaire supérieure. Il chemine sur la paroi supérieure de l’orbite.',
  'ANATOMIE - LE NERF TRIJUMEAU 3 " Le ganglion sph é no-palatin Il est attaché sur le trajet du nerf maxillaire.',
];

function chunksOf(text: string): DocumentChunk[] {
  return chunkDocument(text).map((draft, index) => ({
    id: `chk-${index}`,
    documentId: 'd1',
    chapterId: 'c1',
    subjectId: 's1',
    index,
    text: draft.text,
    charStart: draft.charStart,
    charEnd: draft.charEnd,
    pageStart: draft.pageStart,
    pageEnd: draft.pageEnd,
    termFreq: {},
    tokenCount: draft.text.split(/\s+/).length,
    embedding: null,
  }));
}

const LOOKUP = {
  subjects: new Map([['s1', { id: 's1', name: 'Anatomie', color: '#000', createdAt: '', position: 0 }]]),
  chapters: new Map([['c1', { id: 'c1', subjectId: 's1', name: 'Trijumeau', createdAt: '', position: 0 }]]),
  documents: new Map([['d1', { id: 'd1', name: 'Trijumeau.pdf' }]]),
} as never;

describe('restoreCourseLayout', () => {
  it('rend ses lignes à une page aplatie par l’extraction', () => {
    const before = PAGES.join('\n\n').split('\n').filter((l) => l.trim()).length;
    const after = restoreCourseLayout(PAGES).split('\n').filter((l) => l.trim()).length;
    // C'est la mesure qui compte : sans cette étape, toute la détection de
    // structure travaille sur trois lignes géantes et ne voit rien.
    expect(before).toBe(3);
    expect(after).toBeGreaterThan(8);
  });

  it('retire l’en-tête courant répété, et lui seul', () => {
    const result = restoreCourseLayout(PAGES);
    expect(result).not.toContain('ANATOMIE - LE NERF TRIJUMEAU');
    // Le contenu de la page, lui, est intact — y compris le terme que
    // l'en-tête répétait : il doit rester présent dans le CORPS du cours,
    // sans quoi le retrait de l'en-tête effacerait le sujet du document.
    expect(result).toContain('Il chemine par le canal le plus interne.');
    expect(result).toContain('Le nerf trijumeau');
  });

  it('reconnaît « § » et les glyphes de police symbole comme des puces', () => {
    const lines = restoreCourseLayout(PAGES).split('\n');
    // Les « § » restent des puces, sur leur propre ligne.
    expect(lines.some((line) => line.startsWith('§ Nerf frontal'))).toBe(true);
    /*
     * Le glyphe de symbole ouvrait une SECTION : il devient un simple retour à
     * la ligne, et le titre se retrouve seul, sans marqueur — c'est à cette
     * condition que `courseSections` le reconnaît comme titre.
     */
    expect(lines).toContain('Le nerf ophtalmique');
    expect(lines).toContain('Nerf frontal');
  });

  it('recolle les accents détachés et les traits d’union espacés', () => {
    const result = restoreCourseLayout(PAGES);
    expect(result).toContain('sphéno-palatin');
    expect(result).toContain('naso-ciliaire');
    expect(result).not.toContain('sph é no');
    expect(result).not.toContain('naso - ciliaire');
  });

  it('sépare un titre de section de la phrase qui le suivait', () => {
    const lines = restoreCourseLayout(PAGES).split('\n');
    // « Nerf frontal Il entre dans l'orbite » était une seule ligne : le titre
    // était avalé par la phrase, et la section devenait introuvable.
    expect(lines.some((line) => /Nerf frontal$/.test(line))).toBe(true);
  });

  it('ne touche à rien quand il y a moins de trois pages', () => {
    const two = ['EN-TÊTE 1 Contenu A', 'EN-TÊTE 2 Contenu B'];
    expect(stripRunningHeaders(two)).toEqual(two);
  });
});

describe('le moteur local sur un cours réellement structuré en listes', () => {
  const QUESTIONS = [
    'Peux-tu expliquer le nerf trijumeau',
    'nerf frontal',
    'ganglion sphéno-palatin',
    'nerf naso-ciliaire',
  ];

  it('répond à des questions auxquelles le texte aplati ne permettait pas de répondre', () => {
    const flat = chunksOf(PAGES.join('\n\n')).map((chunk) => ({ chunk, score: 1 }));
    const laidOut = chunksOf(restoreCourseLayout(PAGES)).map((chunk) => ({ chunk, score: 1 }));

    const answered = (scored: typeof flat) =>
      QUESTIONS.filter((q) => findLocalAnswer(q, scored as never, LOOKUP) !== null).length;

    // La remise en forme ne doit JAMAIS faire régresser la couverture.
    expect(answered(laidOut)).toBeGreaterThanOrEqual(answered(flat));
    // Et sur ce corpus, elle répond à tout.
    expect(answered(laidOut)).toBe(QUESTIONS.length);
  });

  it('n’extrait jamais MOINS de faits une fois la structure rendue', () => {
    const count = (chunks: DocumentChunk[]) =>
      chunks.reduce((total, chunk) => total + extractFacts(chunk).length, 0);
    /*
     * Sur ce corpus miniature l'écart peut être nul — trois pages ne portent
     * pas assez de relations pour le creuser. Ce qui est verrouillé ici, c'est
     * l'absence de régression ; le gain réel a été mesuré sur un cours complet
     * (14 faits → 25, et 0 question répondue sur 8 → 8 sur 8).
     */
    expect(count(chunksOf(restoreCourseLayout(PAGES)))).toBeGreaterThanOrEqual(
      count(chunksOf(PAGES.join('\n\n'))),
    );
  });

  it('emporte les éléments d’une énumération annoncée par un deux-points', () => {
    const scored = chunksOf(restoreCourseLayout(PAGES)).map((chunk) => ({ chunk, score: 1 }));
    const answer = findLocalAnswer('branches terminales', scored as never, LOOKUP);
    expect(answer).not.toBeNull();
    /*
     * Une phrase qui promet une liste ne doit pas rester suspendue : « Il donne
     * trois branches terminales : » sans ses trois branches n'apprend rien.
     */
    expect(answer!.text).toContain('trois branches terminales');
    expect(answer!.text).toContain('Nerf frontal');
    expect(answer!.text).toContain('Nerf lacrymal');
  });

  it('s’abstient toujours quand le cours ne parle pas du sujet demandé', () => {
    const scored = chunksOf(restoreCourseLayout(PAGES)).map((chunk) => ({ chunk, score: 1 }));
    expect(findLocalAnswer('le ligament parodontal', scored as never, LOOKUP)).toBeNull();
  });

  /**
   * NUMÉRO DE PAGE resté seul après le retrait de l'en-tête courant.
   * Mesuré sur le vrai cours : l'assistant répondait « combien de branches a
   * le nerf trijumeau ? » en citant, comme premier point, « 10 » — le numéro
   * de la page.
   */
  it('retire l’en-tête courant même sur la page dont le numéro a deux chiffres', () => {
    // Le cas réel : neuf pages numérotées à un chiffre, une à deux. Le masque
    // par CHIFFRE arrêtait le préfixe commun avant la fin de l'en-tête, et la
    // page 10 gardait le sien — puis le voyait promu en titre de section.
    const pages = Array.from(
      { length: 10 },
      (_, i) => `ANATOMIE - DIVISIONS DU NERF TRIJUMEAU\n${i + 1}\nContenu de la page ${i + 1}.`,
    );
    const restored = restoreCourseLayoutPages(pages);
    for (const page of restored) {
      expect(page).not.toContain('ANATOMIE - DIVISIONS DU NERF TRIJUMEAU');
    }
    // Et surtout : aucun chiffre orphelin collé au contenu. Retirer le préfixe
    // par LONGUEUR laissait « 0 » en tête de la page 10.
    expect(restored[9]).toBe('Contenu de la page 10.');
  });

  it('ne laisse pas le numéro de page devenir une ligne de contenu', () => {
    // Ici le numéro est en PIED de page : il ne part pas avec l'en-tête et
    // doit être reconnu pour lui-même.
    const pages = [
      'Le nerf trijumeau possede trois branches.\n1',
      'Le nerf ophtalmique chemine par le canal interne.\n2',
      'Le nerf maxillaire traverse le foramen rond.\n10',
    ];
    const lines = restoreCourseLayout(pages).split('\n').map((line) => line.trim());
    expect(lines).not.toContain('1');
    expect(lines).not.toContain('2');
    expect(lines).not.toContain('10');
    expect(lines).toContain('Le nerf maxillaire traverse le foramen rond.');
  });

  it('ne touche jamais à un nombre porteur de sens', () => {
    const pages = [
      'Il donne 3 branches terminales.',
      'Il se detache a environ 5mm en avant de la terminaison.',
      'Les nerfs III, IV et VI passent dans le sinus caverneux.',
    ];
    const text = restoreCourseLayout(pages);
    expect(text).toContain('3 branches terminales');
    expect(text).toContain('5mm');
    expect(text).toContain('III, IV et VI');
  });
});

/**
 * LIGNES REPLIÉES PAR LA MISE EN PAGE.
 *
 * Une diapositive coupe ses phrases pour tenir dans la largeur ; pdf.js
 * rapporte fidèlement la coupure. Chaque morceau devenait une ligne — donc une
 * puce de réponse, une carte, un extrait cité — et l'assistant rendait des
 * bouts de phrase qui ne commençaient nulle part.
 *
 * Ce qui est vérifié ici n'est PAS « ça recolle » mais l'équilibre entre les
 * deux erreurs possibles : recoller trop peu laisse des moitiés de phrase ;
 * recoller trop soude deux idées, ce qui est bien pire, parce qu'on ne le voit
 * plus. La moitié des cas ci-dessous vérifie donc qu'une ligne est LAISSÉE
 * INTACTE.
 */
describe('restoreCourseLayout — les phrases repliées', () => {
  it('rend sa phrase entière à une ligne coupée par la largeur', () => {
    const text = restoreCourseLayout([
      'Une branche externe qui chemine sur le bord inférieur de l’os propre du nez et\nqui finit en donnant la peau du nez',
    ]);
    expect(text).toContain('du nez et qui finit en donnant la peau du nez');
    expect(text.split('\n')).toHaveLength(1);
  });

  it('recolle une parenthèse fermante restée seule au début de la ligne suivante', () => {
    const text = restoreCourseLayout(['le nerf ophtalmique de Willis se divise en 3 branches\nterminales :']);
    expect(text).toContain('3 branches terminales :');
  });

  it('ne recolle pas après une ponctuation qui clôt la phrase', () => {
    const text = restoreCourseLayout(['Il chemine sur la paroi supérieure de l’orbite.\nil se divise en 2 branches']);
    expect(text.split('\n')).toHaveLength(2);
  });

  it('ne recolle pas une ligne qui commence par une majuscule', () => {
    // Un titre suivi de sa phrase : les souder rendrait la section introuvable.
    const text = restoreCourseLayout(['Nerf frontal\nEntre dans l’orbite par la fissure orbitaire supérieure']);
    expect(text.split('\n')).toHaveLength(2);
  });

  /**
   * LE PIÈGE. La puce « o » est en minuscule : elle a exactement la forme
   * d'une suite de phrase. La première version recollait donc « o Branches
   * descendantes… » à la ligne d'avant et refondait en un seul paragraphe les
   * trois catégories de branches du nerf supra-orbitaire — elle détruisait la
   * structure que ce fichier existe pour rendre.
   */
  it('ne prend pas la puce « o » pour une suite de phrase', () => {
    const text = restoreCourseLayout([
      'Ce nerf finit en se divisant en 3 catégories de branches : o Branches ascendantes pour la peau du front o Branches descendantes pour la paupière o Branches osseuses pour l’os frontal',
    ]);
    const items = text.split('\n').filter((line) => line.startsWith('o '));
    expect(items).toHaveLength(3);
  });
});
