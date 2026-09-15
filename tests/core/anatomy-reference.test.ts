import { describe, expect, it } from 'vitest';
import { findAnatomyReference, renderAnatomyReference } from '@/services/local/anatomyReference';

/**
 * LA NOMENCLATURE DE RÉFÉRENCE — ce que l'application savait déjà.
 *
 * Une question portant sur un terme absent des documents importés se
 * terminait sur « ce n'est pas dans tes cours ». Honnête, et sans issue :
 * l'application connaît pourtant 961 structures anatomiques, dont 305 pour la
 * tête et le cou et les 28 dents permanentes numérotées, déjà présentes hors
 * ligne pour la vue 3D.
 *
 * Ce qui est protégé ici tient en deux exigences opposées, et c'est leur
 * équilibre qui compte :
 *  - RECONNAÎTRE le vocabulaire réel d'un étudiant en dentaire — « la 46 »,
 *    « le muscle masséter », « nerf lingual » ;
 *  - NE RIEN INVENTER : mieux vaut se taire que répondre « nerf facial » à
 *    une question sur le nerf lingual.
 */

describe('findAnatomyReference — reconnaître', () => {
  it('retrouve une structure nommée dans la question', () => {
    const reference = findAnatomyReference('Explique-moi le nerf lingual');
    expect(reference?.entry.name).toBe('Nerf lingual');
    expect(reference?.entry.latinName).toBe('Nervus lingualis');
  });

  /**
   * « la 46 » est le vocabulaire quotidien de la clinique, et aucun
   * rapprochement par le NOM ne pouvait le retrouver : « 46 » n'a rien de
   * commun avec « première molaire inférieure droite ».
   */
  it('comprend la numérotation FDI d’une dent', () => {
    expect(findAnatomyReference('la 46')?.entry.fdi).toBe(46);
    expect(findAnatomyReference('explique moi la 27')?.entry.fdi).toBe(27);
  });

  it('trouve la même dent nommée en toutes lettres', () => {
    expect(findAnatomyReference('la première molaire inférieure droite')?.entry.fdi).toBe(46);
  });

  /**
   * Le catalogue nomme ses structures des deux côtés et par faisceaux
   * (« Masséter (faisceau profond) droit »). Exiger « droit » ou « faisceau »
   * dans la question faisait échouer la formulation la plus courante.
   */
  it('ne réclame ni le côté ni la précision entre parenthèses', () => {
    expect(findAnatomyReference('le muscle masséter')?.entry.name).toMatch(/Masséter/);
    expect(findAnatomyReference('nerf trijumeau')?.entry.name).toMatch(/trijumeau/i);
  });

  it('préfère le nom le plus précis quand la question l’est', () => {
    const reference = findAnatomyReference('le nerf alvéolaire inférieur');
    expect(reference?.entry.name).toBe('Nerf alvéolaire inférieur');
  });
});

describe('findAnatomyReference — s’abstenir', () => {
  it('ne répond rien sur un terme qui n’existe pas', () => {
    expect(findAnatomyReference('c’est quoi le zorglub')).toBeNull();
  });

  /**
   * L'abstention la plus importante : un terme DENTAIRE réel, mais absent de
   * cette nomenclature (elle décrit des structures macroscopiques, pas
   * l'histologie). Répondre autre chose serait pire que se taire.
   */
  it('s’abstient sur un terme dentaire que le catalogue ne couvre pas', () => {
    expect(findAnatomyReference('la pulpe camérale')).toBeNull();
    expect(findAnatomyReference('le desmodonte')).toBeNull();
  });

  it('ne se laisse pas bloquer par les mots en plus de la question', () => {
    // Une nomenclature n'a aucune raison de contenir « chez », « enfant » :
    // exiger tous les mots de la question, comme le fait le moteur sur les
    // COURS, n'aurait ici aucun sens.
    expect(findAnatomyReference('le nerf lingual chez l’enfant')?.entry.name).toBe('Nerf lingual');
  });

  it('ne répond pas une structure voisine à la place de celle demandée', () => {
    // Le piège : « nerf » suffirait à rapprocher n'importe lequel des 109
    // nerfs de la tête et du cou.
    const reference = findAnatomyReference('le nerf');
    expect(reference).toBeNull();
  });

  /**
   * LE FAUX POSITIF QUI A FAILLI PASSER, attrapé par la suite e2e.
   *
   * « Quels sont les territoires différents mentionnés ? » recevait une fiche
   * sur le muscle MENTONNIER : « mentionne » et « mentonnier » obtiennent
   * 0,700 de similarité, et le seuil les acceptait.
   *
   * Aucun seuil de similarité ne pouvait corriger ça — « palais / malaise »
   * vaut 0,714 et « orbitrale / orbitaire » 0,667 : les mots à rejeter et
   * ceux à garder se chevauchent. C'est le PRÉFIXE COMMUN qui les sépare.
   */
  it('ne prend pas un mot ordinaire pour un nom de structure', () => {
    expect(findAnatomyReference('Quels sont les territoires différents mentionnés ?')).toBeNull();
    expect(findAnatomyReference('Quelle est la différence entre les deux ?')).toBeNull();
    expect(findAnatomyReference('Résume-moi le chapitre')).toBeNull();
  });

  it('accepte en revanche la variation de forme d’un même terme', () => {
    // Même radical, terminaison différente : c'est le seul écart toléré.
    expect(findAnatomyReference('la mandibule')?.entry.name).toMatch(/Mandibule/);
  });

  it('ne prend pas un nombre quelconque pour une dent', () => {
    // 99 n'est pas un code FDI ; 5 mm non plus.
    expect(findAnatomyReference('la 99')).toBeNull();
    expect(findAnatomyReference('environ 5 mm')).toBeNull();
  });
});

describe('renderAnatomyReference — dire d’où ça vient', () => {
  it('annonce que ce n’est pas le cours', () => {
    const text = renderAnatomyReference(findAnatomyReference('nerf lingual')!);
    expect(text).toContain('PAS de tes cours');
    expect(text).toContain('Nervus lingualis');
  });

  it('donne la numérotation FDI d’une dent', () => {
    const text = renderAnatomyReference(findAnatomyReference('la 46')!);
    expect(text).toContain('Numérotation FDI');
    expect(text).toContain('46');
  });
});
