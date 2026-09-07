import { describe, it, expect } from 'vitest';
import { findLocalAnswer } from '@/services/local/localAnswer';
import type { ScoredChunk, ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk } from '@/types';

/**
 * `findLocalAnswer` — répondre à une question libre sans IA, en réutilisant
 * `relationExtraction.ts` (même moteur que les flashcards/notions locales)
 * et la récupération BM25 déjà calculée par ChatPage. C'est le correctif du
 * signalement utilisateur : « Je ne comprends pas les nerfs trijumeau » +
 * Automatique ne doit JAMAIS déclencher un appel réseau si le cours répond
 * déjà à la question.
 */

function makeChunk(text: string, id = 'chk-1'): DocumentChunk {
  return {
    id,
    documentId: 'doc-1',
    chapterId: 'ch-1',
    subjectId: 'sub-1',
    index: 0,
    text,
    charStart: 0,
    charEnd: text.length,
    pageStart: 42,
    pageEnd: 42,
    termFreq: {},
    tokenCount: text.split(/\s+/).length,
    embedding: null,
  };
}

function scored(chunk: DocumentChunk): ScoredChunk {
  return { chunk, score: 1, matchedTerms: [] };
}

const LOOKUP: ContextLookup = {
  subjects: new Map([['sub-1', { id: 'sub-1', name: 'Anatomie', color: '#000', createdAt: '', position: 0 }]]),
  chapters: new Map([['ch-1', { id: 'ch-1', subjectId: 'sub-1', name: 'Nerfs crâniens', createdAt: '', position: 0 }]]),
  documents: new Map([['doc-1', { id: 'doc-1', name: 'Cours.pdf' }]]),
};

describe('findLocalAnswer', () => {
  it("répond localement à la question exacte du signalement utilisateur", () => {
    const chunk = makeChunk('Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.');
    const answer = findLocalAnswer('Je ne comprends pas les nerfs trijumeau', [scored(chunk)], LOOKUP);
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('trois branches');
    expect(answer!.citations).toHaveLength(1);
    expect(chunk.text.includes(answer!.citations[0]!.excerpt)).toBe(true);
    expect(answer!.citations[0]!.page).toBe(42);
  });

  it('renvoie null quand aucun sujet détecté ne recoupe la question — jamais une invention', () => {
    const chunk = makeChunk('La glande parotide produit une grande partie de la salive.');
    expect(findLocalAnswer('Explique-moi la circulation sanguine', [scored(chunk)], LOOKUP)).toBeNull();
  });

  it('renvoie null sur une question vide', () => {
    const chunk = makeChunk('Le nerf trijumeau possède trois branches.');
    expect(findLocalAnswer('', [scored(chunk)], LOOKUP)).toBeNull();
  });

  it('renvoie null si aucun chunk ne contient de fait exploitable', () => {
    const chunk = makeChunk('Un patient se présente pour une consultation de routine.');
    expect(findLocalAnswer('Parle-moi du patient', [scored(chunk)], LOOKUP)).toBeNull();
  });

  it("n'inclut jamais un fait issu d'une négation ambiguë ou d'une exception", () => {
    const chunk = makeChunk(
      'Tous les nerfs crâniens sont pairs, sauf le nerf trochléaire dans certaines classifications.',
    );
    expect(findLocalAnswer('Les nerfs crâniens sont-ils pairs ?', [scored(chunk)], LOOKUP)).toBeNull();
  });

  it('assemble plusieurs faits pertinents sur le même sujet, chacun un extrait exact', () => {
    const chunk = makeChunk(
      'Le nerf trijumeau est le plus volumineux des nerfs crâniens. ' +
        'Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.',
    );
    const answer = findLocalAnswer('nerf trijumeau', [scored(chunk)], LOOKUP);
    expect(answer).not.toBeNull();
    const parts = answer!.text.split('\n\n');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const part of parts) expect(chunk.text.includes(part)).toBe(true);
  });

  it('ne répète pas deux fois le même extrait entre plusieurs fragments qui se recouvrent', () => {
    const text = 'Le nerf facial commande les muscles de la mimique faciale.';
    const chunkA = makeChunk(text, 'chk-a');
    const chunkB = makeChunk(text, 'chk-b');
    const answer = findLocalAnswer('nerf facial', [scored(chunkA), scored(chunkB)], LOOKUP);
    expect(answer).not.toBeNull();
    expect(answer!.text.split('\n\n')).toHaveLength(1);
  });
});

/**
 * Non-régression du signalement « réponses hors sujet » : une question dont le
 * terme distinctif est absent du cours ne doit JAMAIS recevoir en réponse des
 * phrases sur un sujet voisin qui partage seulement un mot générique.
 */
describe('findLocalAnswer — pertinence réelle, pas un simple partage de mots', () => {
  const NERFS = makeChunk(
    'Le nerf facial commande les muscles de la mimique faciale. ' +
      'Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire. ' +
      'Le nerf est une structure conductrice.',
  );

  it('« les nerfs de Willis » ne renvoie pas des phrases sur le nerf facial — le cours n’en parle pas', () => {
    expect(findLocalAnswer("C'est quoi les nerfs de Willis ?", [scored(NERFS)], LOOKUP)).toBeNull();
  });

  it('un sujet générique (« le nerf ») ne capture plus toutes les questions contenant « nerf »', () => {
    const generic = makeChunk('Le nerf est une structure conductrice de l’influx nerveux.');
    expect(findLocalAnswer('Explique-moi le nerf trijumeau', [scored(generic)], LOOKUP)).toBeNull();
  });

  it('la vraie question sur le trijumeau reste correctement répondue', () => {
    const answer = findLocalAnswer('Explique-moi le nerf trijumeau', [scored(NERFS)], LOOKUP);
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('trijumeau');
    expect(answer!.text).not.toContain('mimique');
  });

  it('LIMITE ASSUMÉE : s’abstient aussi quand le cours nomme le sujet autrement que la question', () => {
    // « polygone de Willis » est la bonne dénomination ; l'étudiant a demandé
    // « les nerfs de Willis ». Le terme « nerf » est absent de ce cours-ci, le
    // moteur s'abstient donc, alors qu'une réponse aurait été possible et même
    // pédagogiquement utile (elle aurait corrigé la confusion).
    //
    // C'est un choix DÉLIBÉRÉ, pas un oubli : le seul moyen de distinguer ce
    // cas du bug « nerfs de Willis » (répondre sur le nerf facial parce que la
    // question contient « nerf ») serait de deviner quel terme est le plus
    // spécifique — par la majuscule d'un éponyme, par exemple. Une telle
    // heuristique se trompe dès qu'un étudiant tape sans majuscules, et la
    // règle du projet est claire : mieux vaut s'abstenir que risquer une
    // réponse à côté. L'étudiant voit le message honnête et le bouton
    // « Répondre avec l'IA », qui traite très bien ce cas.
    const willis = makeChunk(
      'Le polygone de Willis est un cercle artériel situé à la base du cerveau.',
    );
    expect(findLocalAnswer("C'est quoi les nerfs de Willis ?", [scored(willis)], LOOKUP)).toBeNull();
  });

  it('un adverbe de politesse ou de remplissage ne fait pas abstenir le moteur', () => {
    const answer = findLocalAnswer('Explique-moi rapidement le nerf trijumeau stp', [scored(NERFS)], LOOKUP);
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('trijumeau');
  });
});
