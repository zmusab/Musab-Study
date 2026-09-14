import { describe, it, expect } from 'vitest';
import { parseCardFile, plainText, toCardFile } from '@/services/flashcards/importFile';

/**
 * IMPORT DE CARTES — les fichiers que produisent réellement Anki et Quizlet.
 *
 * Les fixtures ne sont pas inventées « proprement » : elles reproduisent ce que
 * ces deux applications écrivent vraiment — directives `#separator` en tête,
 * HTML dans les champs, guillemets autour d'une réponse qui contient le
 * séparateur. C'est exactement là que se cassent les imports naïfs.
 */

describe('parseCardFile — export texte d’Anki', () => {
  it('lit un export à tabulations précédé de ses directives', () => {
    const file = [
      '#separator:tab',
      '#html:true',
      'Combien de racines a la première molaire mandibulaire ?\tDeux : mésiale et distale.',
      'Quel nerf innerve le masséter ?\tLe nerf massétérique (V3).',
    ].join('\n');

    const result = parseCardFile(file);
    expect(result.delimiter).toBe('tabulation');
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]!.question).toBe('Combien de racines a la première molaire mandibulaire ?');
    expect(result.cards[0]!.answer).toBe('Deux : mésiale et distale.');
    expect(result.rejected).toHaveLength(0);
  });

  it('rend lisible le HTML qu’Anki met dans ses champs', () => {
    const file = 'Quelles sont les cuspides de la 16 ?\tMésio-vestibulaire<br>Disto-vestibulaire<br>Palatine';
    const result = parseCardFile(file);
    expect(result.cards[0]!.answer).toBe('Mésio-vestibulaire\nDisto-vestibulaire\nPalatine');
  });

  it('la ligne rejetée porte le numéro de ligne du FICHIER, directives comprises', () => {
    const file = ['#separator:tab', '#html:false', 'Question seule sans réponse'].join('\n');
    const result = parseCardFile(file);
    expect(result.cards).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.line).toBe(3);
  });
});

describe('parseCardFile — export de Quizlet et CSV de tableur', () => {
  it('respecte les guillemets, même quand la réponse contient le séparateur', () => {
    const file = [
      'Question,Réponse',
      '"Combien de racines a la 46 ?","Deux, la mésiale et la distale"',
    ].join('\n');

    const result = parseCardFile(file);
    expect(result.headerSkipped).toBe(true);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.answer).toBe('Deux, la mésiale et la distale');
  });

  it('un champ entre guillemets peut contenir un saut de ligne', () => {
    const file = 'Question;Réponse\n"Quelles sont les trois branches du V ?";"V1 ophtalmique\nV2 maxillaire\nV3 mandibulaire"';
    const result = parseCardFile(file);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.answer).toBe('V1 ophtalmique\nV2 maxillaire\nV3 mandibulaire');
  });

  it('les guillemets doublés valent un guillemet littéral', () => {
    // Champ entouré de guillemets, avec `""` à l'intérieur : c'est la règle
    // CSV, et c'est ainsi qu'un tableur écrit une citation dans un champ.
    const file = '"La ""ligne de plus grand contour"", c’est quoi ?";Le périmètre le plus large de la couronne';
    const result = parseCardFile(file);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.question).toBe('La "ligne de plus grand contour", c’est quoi ?');
    expect(result.cards[0]!.answer).toBe('Le périmètre le plus large de la couronne');
  });

  it('reconnaît les en-têtes anglais de Quizlet', () => {
    const result = parseCardFile('Term\tDefinition\nÉmail\tTissu le plus dur du corps humain');
    expect(result.headerSkipped).toBe(true);
    expect(result.cards).toHaveLength(1);
  });

  it('ne prend PAS une vraie carte pour un en-tête', () => {
    const result = parseCardFile('Combien de dents chez l’adulte ?;32');
    expect(result.headerSkipped).toBe(false);
    expect(result.cards).toHaveLength(1);
  });
});

describe('parseCardFile — détection du séparateur', () => {
  it('choisit la tabulation même quand les réponses sont pleines de virgules', () => {
    // Le piège exact : compter les occurrences aurait élu la virgule.
    const file = [
      'Quels sont les muscles masticateurs ?\tMasséter, temporal, ptérygoïdien médial, ptérygoïdien latéral',
      'Quels sont les os du crâne ?\tFrontal, pariétal, temporal, occipital, sphénoïde, ethmoïde',
    ].join('\n');
    const result = parseCardFile(file);
    expect(result.delimiter).toBe('tabulation');
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]!.answer).toBe('Masséter, temporal, ptérygoïdien médial, ptérygoïdien latéral');
  });

  it('choisit le point-virgule quand c’est lui qui structure le fichier', () => {
    const file = 'Émail ?;Tissu le plus dur\nDentine ?;Sous l’émail, vivante';
    const result = parseCardFile(file);
    expect(result.delimiter).toBe('point-virgule');
    expect(result.cards).toHaveLength(2);
  });

  it('une directive explicite l’emporte sur la détection', () => {
    /*
      Le fichier DÉCLARE le point-virgule, mais sa réponse contient une
      tabulation : la détection, elle, élirait la tabulation. C'est
      exactement pourquoi Anki écrit la directive — et la croire donne la
      bonne coupure, l'ignorer coupe la carte au milieu de sa réponse.
    */
    const file = '#separator:semicolon\nQuels sont les muscles masticateurs ?;Masséter\ttemporal';
    const result = parseCardFile(file);
    expect(result.delimiter).toBe('point-virgule');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.question).toBe('Quels sont les muscles masticateurs ?');
    expect(result.cards[0]!.answer).toBe('Masséter\ttemporal');
  });
});

describe('parseCardFile — ce qui est refusé est DIT, jamais deviné', () => {
  it('une ligne sans réponse est rejetée avec sa raison', () => {
    const result = parseCardFile('Bonne question ?;Bonne réponse\nLigne orpheline');
    expect(result.cards).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/réponse manque/);
    expect(result.rejected[0]!.text).toBe('Ligne orpheline');
  });

  it('une réponse vide est rejetée plutôt qu’importée à moitié', () => {
    const result = parseCardFile('Question ?;\nAutre question ?;Autre réponse');
    expect(result.cards).toHaveLength(1);
    expect(result.rejected[0]!.reason).toBe('réponse vide');
  });

  it('une question vide est rejetée', () => {
    const result = parseCardFile(';Une réponse orpheline');
    expect(result.cards).toHaveLength(0);
    expect(result.rejected[0]!.reason).toBe('question vide');
  });

  it('les lignes vides ne sont ni importées ni rejetées', () => {
    const result = parseCardFile('Q1 ?;R1\n\n\nQ2 ?;R2\n');
    expect(result.cards).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it('un fichier vide ne produit rien, sans lever d’erreur', () => {
    const result = parseCardFile('');
    expect(result.cards).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it('les colonnes au-delà de la deuxième sont ignorées, pas fusionnées', () => {
    // Anki exporte l'étiquette (« tags ») en troisième colonne.
    const result = parseCardFile('Q ?\tR\tanatomie tête-et-cou');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.answer).toBe('R');
  });
});

describe('plainText', () => {
  it('décode les entités usuelles', () => {
    expect(plainText('Foramen&nbsp;ovale &amp; rond')).toBe('Foramen ovale & rond');
  });

  it('laisse un texte sans HTML intact', () => {
    expect(plainText('Le nerf V3 passe par le foramen ovale.')).toBe('Le nerf V3 passe par le foramen ovale.');
  });
});

describe('toCardFile — l’export, et l’aller-retour complet', () => {
  it('écrit un fichier que parseCardFile relit à l’identique', () => {
    const cards = [
      { question: 'Qu’est-ce que le parodonte ?', answer: 'L’ensemble des tissus de soutien de la dent.' },
      // Une réponse multi-lignes : le cas qui casse un export naïf.
      { question: 'Quels sont les quatre tissus parodontaux ?', answer: 'Gencive\nOs alvéolaire\nCément\nLigament' },
      // Un guillemet ET une tabulation dans le même champ.
      { question: 'Qu’appelle-t-on la « ligne de plus grand contour » ?', answer: 'Le "périmètre"\tle plus large' },
      { question: 'Combien de racines a la 46 ?', answer: 'Deux, la mésiale et la distale' },
    ];

    const file = toCardFile(cards);
    const reread = parseCardFile(file);

    expect(reread.cards).toHaveLength(cards.length);
    expect(reread.cards.map((row) => ({ question: row.question, answer: row.answer }))).toEqual(cards);
  });

  it('déclare son séparateur, pour être relu sans devinette', () => {
    expect(toCardFile([{ question: 'Q', answer: 'R' }]).startsWith('#separator:tab\n')).toBe(true);
  });

  it('n’entoure de guillemets que les champs qui en ont besoin', () => {
    const file = toCardFile([{ question: 'Simple', answer: 'Sans piège' }]);
    expect(file).toContain('Simple\tSans piège');
    expect(file).not.toContain('"');
  });

  it('une bibliothèque vide produit un fichier valide, pas une erreur', () => {
    const file = toCardFile([]);
    expect(parseCardFile(file).cards).toHaveLength(0);
    expect(parseCardFile(file).rejected).toHaveLength(0);
  });
});
