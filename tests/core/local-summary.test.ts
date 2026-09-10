import { describe, expect, it } from 'vitest';
import { buildLocalStudySheet } from '@/services/local/localSummary';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk } from '@/types';

/**
 * RÉSUMÉ ET FICHE DE RÉVISION SANS IA.
 *
 * C'étaient les deux dernières fonctions d'étude entièrement bloquées derrière
 * une clé API : sans clé, l'assistant répondait « Ajoute ta clé API dans
 * Paramètres » et il ne se passait rien.
 *
 * Ce qui est vérifié ici n'est pas « du texte sort », mais la promesse qui
 * rend ce moteur acceptable : CHAQUE LIGNE RENDUE SE RETROUVE MOT POUR MOT
 * DANS LE COURS. Le moteur local range ; il ne reformule pas, et il n'invente
 * rien. Le jour où il inventerait, ces tests tomberaient.
 */

function chunk(text: string, index = 0, id = `c${index}`): DocumentChunk {
  return {
    id, documentId: 'doc-1', chapterId: 'ch-1', subjectId: 'sub-1', index, text,
    charStart: 0, charEnd: text.length, pageStart: 1, pageEnd: 1,
    termFreq: {}, tokenCount: text.split(/\s+/).length, embedding: null,
  };
}

const LOOKUP: ContextLookup = {
  subjects: new Map([['sub-1', { id: 'sub-1', name: 'Anatomie', color: '#000', createdAt: '', position: 0 }]]),
  chapters: new Map([['ch-1', { id: 'ch-1', subjectId: 'sub-1', name: 'Trijumeau', createdAt: '', position: 0 }]]),
  documents: new Map([['doc-1', { id: 'doc-1', name: 'Cours.pdf' }]]),
};

const COURSE = [
  'Nerf frontal',
  '• Il entre dans l’orbite par la fissure orbitaire supérieure.',
  '• Il chemine sur la paroi supérieure de l’orbite.',
  '• Ce nerf se divise en 3 catégories de branches :',
  '§ Branches ascendantes pour la peau du front',
  '§ Branches descendantes pour la paupière supérieure',
  '§ Branches osseuses pour l’os frontal',
  // Cette ligne est À LA FOIS un avertissement ET une définition : c'est
  // exactement le cas qui faisait disparaître toute la rubrique « pièges ».
  'PS : le nerf supra-orbitaire est la branche externe du nerf frontal.',
  'PS : ne pas confondre le nerf frontal externe et le nerf frontal interne.',
].join('\n');

/**
 * Lignes de CONTENU qu'on ne retrouve pas telles quelles dans le cours —
 * c'est-à-dire les lignes inventées. Doit toujours être vide.
 *
 * L'échafaudage est exclu, et lui seul : les intertitres (`###`), la phrase
 * d'ouverture et la mention de provenance sont ajoutés par le moteur, comme
 * les intertitres d'une réponse. Ranger n'est pas inventer — mais tout ce qui
 * n'est pas une étiquette de rangement doit venir du document.
 */
function inventedLines(text: string, source: string): string[] {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('###') && !line.startsWith('_') && !line.startsWith('**'))
    .map((line) => line.replace(/^[-\s]+/, '').trim())
    .filter((line) => line.length > 12)
    .filter((line) => !source.includes(line));
}

describe('buildLocalStudySheet — le résumé', () => {
  it('rend le plan du cours, titres en tête', () => {
    const sheet = buildLocalStudySheet('summary', [chunk(COURSE)], LOOKUP);
    expect(sheet).not.toBeNull();
    expect(sheet!.text).toContain('### Nerf frontal');
    expect(sheet!.text).toContain('Il chemine sur la paroi supérieure de l’orbite.');
  });

  it('n’écrit pas une ligne qui ne soit pas dans le cours', () => {
    const sheet = buildLocalStudySheet('summary', [chunk(COURSE)], LOOKUP);
    expect(inventedLines(sheet!.text, COURSE)).toEqual([]);
  });

  it('cite ses sources', () => {
    const sheet = buildLocalStudySheet('summary', [chunk(COURSE)], LOOKUP);
    expect(sheet!.citations.length).toBeGreaterThan(0);
  });

  /** Les fragments se chevauchent : sans garde-fou, tout reviendrait en double. */
  it('ne répète pas une section présente dans deux fragments', () => {
    const sheet = buildLocalStudySheet('summary', [chunk(COURSE, 0), chunk(COURSE, 1, 'c1')], LOOKUP);
    expect(sheet!.text.split('### Nerf frontal').length - 1).toBe(1);
  });
});

describe('buildLocalStudySheet — la fiche de révision', () => {
  it('range les énumérations avec leurs éléments', () => {
    const sheet = buildLocalStudySheet('sheet', [chunk(COURSE)], LOOKUP);
    expect(sheet).not.toBeNull();
    expect(sheet!.text).toContain('Branches ascendantes pour la peau du front');
    expect(sheet!.text).toContain('Branches osseuses pour l’os frontal');
  });

  /**
   * Ce sont les avertissements que l'ENSEIGNANT a écrits — rien n'est deviné.
   * « PS : » est inclus parce que ce type de polycopié s'en sert pour les
   * remarques qui n'entrent pas dans le plan, et ce sont précisément celles
   * qu'un étudiant oublie.
   *
   * Ces lignes sont relevées dans un registre SÉPARÉ de celui des faits :
   * une même ligne peut être à la fois une définition et un avertissement, et
   * elle doit paraître aux deux endroits plutôt que d'être consommée par le
   * premier qui la prend.
   */
  it('remonte les pièges que le cours signale lui-même', () => {
    const sheet = buildLocalStudySheet('sheet', [chunk(COURSE)], LOOKUP);
    expect(sheet!.text).toContain('Les pièges signalés par ton cours');
    expect(sheet!.text).toContain('ne pas confondre le nerf frontal externe');
    // Celle-ci est aussi une définition : elle doit figurer dans les pièges
    // malgré tout, et non disparaître parce qu'un fait l'a déjà consommée.
    expect(sheet!.text).toContain('le nerf supra-orbitaire est la branche externe');
  });

  it('n’écrit pas une ligne qui ne soit pas dans le cours', () => {
    const sheet = buildLocalStudySheet('sheet', [chunk(COURSE)], LOOKUP);
    expect(inventedLines(sheet!.text, COURSE)).toEqual([]);
  });
});

describe('buildLocalStudySheet — l’abstention', () => {
  it('ne rend rien plutôt que du vide habillé', () => {
    expect(buildLocalStudySheet('summary', [], LOOKUP)).toBeNull();
    expect(buildLocalStudySheet('sheet', [], LOOKUP)).toBeNull();
    // Un fragment sans structure ni relation : rien de vérifiable à ranger.
    expect(buildLocalStudySheet('sheet', [chunk('aaa bbb ccc')], LOOKUP)).toBeNull();
  });
});
