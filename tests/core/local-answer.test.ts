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

  /*
   * CHANGEMENT DE CONTRAT ASSUMÉ.
   *
   * Ce test exigeait `null` dès qu'aucune RÈGLE de relation ne s'appliquait.
   * C'était précisément le défaut qui rendait l'application inutilisable sur
   * de vrais polycopiés : mesuré sur un cours de dentisterie de dix pages,
   * l'assistant répondait « Absent de tes cours » à huit questions sur huit,
   * dont « nerf trijumeau » — le titre du document. La plupart des lignes d'un
   * cours réel (listes à puces, titres, descriptions) ne déclenchent aucune
   * règle ; tout ce savoir était déclaré inexistant.
   *
   * Le moteur cite désormais les passages du cours quand il ne sait pas les
   * structurer. Ce qui est verrouillé ici, c'est que la citation reste une
   * CITATION : le texte rendu doit se retrouver mot pour mot dans le cours,
   * et ne jamais être présenté comme un fait déduit.
   */
  it('cite le cours quand aucune règle ne s’applique, sans rien affirmer', () => {
    const chunk = makeChunk('Un patient se présente pour une consultation de routine.');
    const answer = findLocalAnswer('Parle-moi du patient', [scored(chunk)], LOOKUP);
    expect(answer).not.toBeNull();

    // Aucune rubrique structurée : le moteur n'a rien déduit, et ne le
    // prétend pas.
    expect(answer!.text).not.toContain('### Définition');
    expect(answer!.text).toContain('ton cours dit');

    // Chaque ligne citée existe telle quelle dans le document.
    for (const line of answer!.text.split('\n')) {
      const quoted = line.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim();
      if (quoted.length === 0 || quoted.startsWith('_') || quoted.startsWith('Voici')) continue;
      expect(chunk.text).toContain(quoted);
    }
  });

  /**
   * La garantie de fond sur les exceptions, reformulée pour le moteur à deux
   * étages — et elle est plus forte qu'avant, pas plus faible.
   *
   * Le danger d'une phrase à exception n'a jamais été de la MONTRER : c'est de
   * la RÉDUIRE. « Tous les nerfs crâniens sont pairs, sauf le trochléaire »
   * transformée en fait « les nerfs crâniens sont pairs » perd exactement ce
   * qui compte. Citée en entier, elle enseigne la règle ET son exception.
   *
   * Ce test vérifie donc les deux moitiés : aucun fait structuré n'en est
   * tiré, et si la phrase est citée, elle l'est avec son « sauf ».
   */
  it("ne réduit jamais une exception à sa moitié affirmative", () => {
    const chunk = makeChunk(
      'Tous les nerfs crâniens sont pairs, sauf le nerf trochléaire dans certaines classifications.',
    );
    const answer = findLocalAnswer('Les nerfs crâniens sont-ils pairs ?', [scored(chunk)], LOOKUP);

    if (answer === null) return; // L'abstention reste une réponse acceptable.

    // Aucune rubrique structurée : la règle d'extraction a bien refusé la phrase.
    expect(answer.text).not.toContain('### Définition');
    // Et la citation porte l'exception avec elle.
    expect(answer.text).toContain('sauf le nerf trochléaire');
  });

  it('assemble plusieurs faits pertinents sur le même sujet, chacun un extrait exact', () => {
    const chunk = makeChunk(
      'Le nerf trijumeau est le plus volumineux des nerfs crâniens. ' +
        'Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.',
    );
    const answer = findLocalAnswer('nerf trijumeau', [scored(chunk)], LOOKUP);
    expect(answer).not.toBeNull();

    /*
     * La réponse est désormais une LEÇON CHARPENTÉE : un titre qui nomme le
     * sujet, puis des rubriques dans l'ordre pédagogique (« Définition »,
     * « Ce que ça comporte »…). Ce test fixe les deux garanties qui comptent,
     * et elles ne sont pas les mêmes selon la partie de la réponse.
     */
    const lines = answer!.text.split('\n');
    expect(answer!.text).toContain('**Le nerf trijumeau**');
    expect(answer!.text).toContain('### Définition');

    /*
     * GARANTIE 1 — le CORPS de la réponse est verbatim. Chaque puce des
     * rubriques est un extrait exact du cours : ni reformulation, ni
     * recomposition. C'est ce qui rend la réponse vérifiable ligne à ligne.
     * (Les sous-puces d'énumération sont indentées de deux espaces ; elles
     * sont vérifiées séparément juste après.)
     */
    const retainIndex = lines.indexOf('### À retenir');
    const bodyLines = retainIndex >= 0 ? lines.slice(0, retainIndex) : lines;
    const bullets = bodyLines.filter((line) => line.startsWith('- ')).map((line) => line.slice(2));
    expect(bullets.length).toBeGreaterThanOrEqual(2);
    for (const bullet of bullets) expect(chunk.text.includes(bullet)).toBe(true);

    // Les éléments d'une énumération viennent eux aussi du texte, à la
    // majuscule initiale près (« ophtalmique » → « Ophtalmique »).
    const subItems = bodyLines.filter((line) => line.startsWith('  - ')).map((line) => line.slice(4));
    expect(subItems.length).toBe(3);
    for (const item of subItems) expect(chunk.text.toLowerCase()).toContain(item.toLowerCase());

    /*
     * GARANTIE 2 — « À retenir » est la SEULE ligne recomposée de toute la
     * réponse, et elle l'est à partir de fragments eux-mêmes verbatim : le
     * sujet du fait, et le décompte explicite relevé dans le cours
     * (« trois branches »). Aucun mot n'y est inventé ; c'est une contraction,
     * pas une paraphrase. La distinction est assumée, et testée ici pour
     * qu'elle ne dérive pas.
     */
    expect(retainIndex).toBeGreaterThan(0);
    const retain = lines.slice(retainIndex + 1).find((line) => line.startsWith('- '));
    expect(retain).toBeDefined();
    expect(retain).toContain('Le nerf trijumeau');
    expect(retain).toContain('trois branches');
    expect(chunk.text).toContain('trois branches');
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

  /*
   * Cas rapporté par l'utilisateur, capture à l'appui : « Les nerfs infra
   * orbitrales c'est quoi » renvoyait « Absent de tes cours » sur un document
   * qui traite le nerf infra-orbitaire sur trois pages. Le cours écrit
   * « orbitaire », l'étudiant a tapé « orbitrales » : une seule différence de
   * graphie effaçait toute la question.
   */
  it('une variante d’orthographe ne fait plus déclarer le sujet absent', () => {
    const cours = makeChunk(
      'Le nerf infra-orbitaire chemine dans le canal infra-orbitaire. ' +
        'Il assure l’innervation sensitive de la paupière inférieure.',
    );
    const answer = findLocalAnswer("Les nerfs infra orbitrales c'est quoi", [scored(cours)], LOOKUP);
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('infra-orbitaire');
  });

  it('mais un terme que le cours ignore vraiment reste un motif d’abstention', () => {
    /*
     * La garantie inverse, et elle compte autant. Rapprocher « orbitrales » de
     * « orbitaire » est une correction de graphie ; ignorer « Willis » parce
     * qu'il est introuvable serait effacer le mot qui porte toute la question,
     * et répondre avec assurance sur le nerf facial — le bug d'origine.
     */
    const cours = makeChunk('Le nerf facial commande les muscles de la mimique faciale.');
    expect(findLocalAnswer("C'est quoi les nerfs de Willis ?", [scored(cours)], LOOKUP)).toBeNull();
  });

  it('un adverbe de politesse ou de remplissage ne fait pas abstenir le moteur', () => {
    const answer = findLocalAnswer('Explique-moi rapidement le nerf trijumeau stp', [scored(NERFS)], LOOKUP);
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('trijumeau');
  });

  /**
   * TITRE DE RÉPONSE TRONQUÉ.
   *
   * Sur un vrai cours, une ligne repliée par le PDF donne parfois un sujet
   * amputé. La réponse à « nerf maxillaire » s'ouvrait sur « **le nerf** —
   * voici ce que ton cours en dit » : un titre qui n'annonce rien.
   *
   * Le titre doit contenir les termes distinctifs de la question ET ressembler
   * à un groupe nominal. À défaut, on reprend les mots de la question —
   * exact, et sans rien affirmer de plus.
   */
  it('n’ouvre jamais une réponse sur un sujet tronqué', () => {
    // La première phrase donne le sujet « Le nerf » : aussi bien classé que
    // « Le nerf maxillaire » (tous ses mots porteurs sont dans la question),
    // et rencontré en premier — c'est donc lui qui titrait la réponse.
    const chunk = makeChunk(
      'Le nerf est donc en contact direct avec le sinus maxillaire. ' +
        'Le nerf maxillaire est situé sur la paroi inférieure de l’orbite. ' +
        'Le nerf maxillaire possède plusieurs branches collatérales.',
    );
    const answer = findLocalAnswer('nerf maxillaire', [scored(chunk)], LOOKUP);
    expect(answer).not.toBeNull();
    const heading = answer!.text.split('\n')[0]!;
    expect(heading).not.toMatch(/\*\*le nerf\*\*/i);
    // Le titre nomme quelque chose : soit un vrai groupe nominal du cours,
    // soit les mots mêmes de la question.
    expect(heading.toLowerCase()).toContain('maxillaire');
  });

  it('garde le sujet du cours quand il est complet', () => {
    const chunk = makeChunk(
      'Le nerf ophtalmique de Willis donne trois branches terminales : ' +
        'le nerf naso-ciliaire, le nerf frontal et le nerf lacrymal. ' +
        'Le nerf ophtalmique de Willis chemine par le canal le plus interne.',
    );
    const answer = findLocalAnswer('nerf ophtalmique', [scored(chunk)], LOOKUP);
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('Le nerf ophtalmique de Willis');
  });
});
