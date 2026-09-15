import { describe, expect, it } from 'vitest';
import { readQuestion } from '@/services/local/questionIntent';

/**
 * CE QUE LA QUESTION DEMANDE.
 *
 * Ce qui est vérifié ici tient en deux points, et le premier est un piège de
 * JavaScript, pas de français : `\b` ne connaît que l'ASCII, si bien qu'un
 * motif écrit `\bo[uù]\b` ne reconnaît JAMAIS « où ». L'erreur est muette —
 * un motif qui ne reconnaît rien ne lève rien — et c'est exactement pour ça
 * qu'elle mérite un test à elle.
 *
 * Le second est l'inverse : ne pas voir une question de lieu là où il n'y a
 * qu'une conjonction (« le nerf frontal ou le nerf lacrymal »).
 */

describe('readQuestion — les questions de lieu', () => {
  it('reconnaît « où » accentué, malgré la frontière de mot ASCII', () => {
    expect(readQuestion('Par où passe le nerf ophtalmique ?')?.intent).toBe('location');
    expect(readQuestion('Où se situe le nerf lacrymal ?')?.intent).toBe('location');
    expect(readQuestion("D'où vient le nerf d'Arnold ?")?.intent).toBe('location');
  });

  it('accepte « ou » sans accent en tête de question — la faute de frappe courante', () => {
    expect(readQuestion('ou se situe le nerf lacrymal')?.intent).toBe('location');
    expect(readQuestion('par ou passe le V3')?.intent).toBe('location');
  });

  it('ne prend pas la conjonction « ou » pour une question de lieu', () => {
    expect(readQuestion('Le nerf frontal ou le nerf lacrymal')?.intent).not.toBe('location');
    expect(readQuestion('La branche maxillaire ou mandibulaire ?')?.intent).not.toBe('location');
  });

  it('reconnaît les verbes de trajet, qui posent la question sans le mot', () => {
    expect(readQuestion('Quel est le trajet du nerf maxillaire ?')?.intent).toBe('location');
    expect(readQuestion('Le nerf lacrymal se trouve dans quelle paroi ?')?.intent).toBe('location');
  });

  it('écarte les verbes de forme des termes du sujet, jamais les termes du cours', () => {
    const asked = readQuestion('Où se situe le nerf lacrymal ?');
    expect(asked?.markers.has('situe')).toBe(true);
    expect(asked?.markers.has('lacrymal')).toBe(false);
    expect(asked?.markers.has('nerf')).toBe(false);
  });
});

describe('readQuestion — les autres natures de demande', () => {
  it('reconnaît un décompte', () => {
    expect(readQuestion('Combien de branches a le nerf trijumeau ?')?.intent).toBe('count');
  });

  it('fait passer le décompte avant le reste quand les deux tournures sont là', () => {
    // « Combien de branches » contient aussi « de quoi »-like : l'ordre des
    // règles doit trancher pour le décompte, qui est la vraie demande.
    expect(readQuestion('Combien de branches composent le nerf trijumeau ?')?.intent).toBe('count');
  });

  it('reconnaît une composition, une fonction, une définition', () => {
    expect(readQuestion('De quoi se compose le ganglion de Meckel ?')?.intent).toBe('composition');
    expect(readQuestion('À quoi sert le nerf lacrymal ?')?.intent).toBe('function');
    expect(readQuestion("Qu'est-ce que le ganglion sphéno-palatin ?")?.intent).toBe('definition');
    expect(readQuestion("C'est quoi le cavum de Meckel ?")?.intent).toBe('definition');
  });

  it('renvoie null sur une question dont la tournure n’est pas prévue', () => {
    // Le moteur doit alors se comporter exactement comme avant ce module :
    // aucune question ne devient sans réponse à cause de lui.
    expect(readQuestion('Le nerf frontal')).toBeNull();
    expect(readQuestion('nerf trijumeau branches terminales')).toBeNull();
  });
});
