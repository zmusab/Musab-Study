import type { FactPredicate } from './relationExtraction';

/**
 * CE QUE LA QUESTION DEMANDE, pas seulement de quoi elle parle.
 *
 * Le moteur local traitait toute question de la même façon : il en retenait
 * les mots porteurs et cherchait ce qui les contenait tous. « Où se situe le
 * nerf lacrymal ? » lui donnait donc trois termes — « situe », « nerf »,
 * « lacrymal » — et il exigeait les trois. Mesuré sur le vrai cours de
 * l'utilisateur, la réponse portait alors sur le nerf OPHTALMIQUE : c'était la
 * seule section du document à contenir à la fois « nerf » et le mot « situé »,
 * lâché en passant dans une parenthèse.
 *
 * Le défaut est de fond. « Situe » ne dit rien du SUJET cherché ; il dit la
 * FORME de la demande. Le prendre pour un terme du sujet, c'est chercher un
 * cours qui emploie le vocabulaire de la question au lieu d'un cours qui y
 * répond.
 *
 * Ce module sépare les deux :
 *
 *  - les MOTS DE FORME sont retirés des termes exigés — « Où se situe le nerf
 *    lacrymal ? » ne demande plus que « lacrymal », et tombe sur la bonne
 *    section ;
 *  - la NATURE de la demande sert ensuite à classer : à une question en
 *    « où », le moteur répond d'abord par ce que le cours dit du trajet, pas
 *    par une définition qui viendrait en premier dans l'ordre habituel.
 *
 * ── CE QUE CE MODULE N'EST PAS ────────────────────────────────────────────
 * Ce n'est pas une compréhension de la question. Il reconnaît des tournures
 * françaises fixes, rien d'autre. Une question dont la forme n'est pas prévue
 * retourne `null` et le moteur se comporte exactement comme avant — aucune
 * question ne devient sans réponse à cause de ce fichier.
 */

export type QuestionIntent = 'location' | 'count' | 'composition' | 'function' | 'definition';

/**
 * FRONTIÈRE DE MOT, ACCENTS COMPRIS.
 *
 * `\b` de JavaScript ne connaît que l'alphabet ASCII : dans « par où passe »,
 * il ne voit AUCUNE frontière après le « ù », parce que ce caractère n'est
 * pas un caractère de mot pour lui. Le motif `\bo[uù]\b` — écrit d'abord —
 * ne reconnaissait donc jamais « où », et la question la plus fréquente de
 * cette famille (« par où passe… ») retombait dans le cas général.
 *
 * L'erreur est silencieuse : un motif qui ne reconnaît rien ne lève rien. On
 * borne donc explicitement par « ce qui n'est ni lettre, ni chiffre, ni
 * lettre accentuée », des deux côtés.
 */
const WORD = '[^\\wà-ÿœæ]';
function word(...alternatives: string[]): string {
  return `(?:^|${WORD})(?:${alternatives.join('|')})(?=${WORD}|$)`;
}

interface IntentRule {
  intent: QuestionIntent;
  /**
   * Reconnaissance de la tournure, sur la question EN ENTIER : « par où »,
   * « à quoi ça sert », « de quoi c'est fait » ne se reconnaissent pas mot à
   * mot.
   */
  pattern: RegExp;
  /**
   * Mots qui n'existent dans la question QUE pour la poser sous cette forme.
   * Retirés des termes exigés — jamais des mots du cours, qui gardent tout
   * leur sens là où ils sont écrits.
   */
  markers: readonly string[];
  /** Nature de savoir à faire remonter en tête de réponse. */
  leads: FactPredicate;
}

/*
 * L'ordre compte : la première règle qui reconnaît la question l'emporte.
 * « Combien de branches » est d'abord un décompte, même si la phrase contient
 * aussi « de quoi ».
 */
const RULES: readonly IntentRule[] = [
  {
    intent: 'count',
    pattern: new RegExp(word('combien'), 'i'),
    markers: ['combien', 'nombre'],
    leads: 'classification',
  },
  {
    intent: 'location',
    // « où », « par où », « d'où » — et les verbes de trajet, qui posent la
    // même question sans le mot : « le nerf lacrymal chemine par où ».
    /*
      « Où » accentué n'a qu'un sens et se reconnaît partout. « Ou » sans
      accent est ambigu — c'est la conjonction —, et « le nerf ou la veine »
      n'est pas une question de localisation. On ne l'accepte donc qu'en TÊTE
      de question, seul ou derrière « par » / « d' », là où la conjonction ne
      peut pas se trouver : c'est la faute de frappe courante (« ou se situe
      le nerf »), pas le mot français.
    */
    pattern: new RegExp(
      [
        word('o[ùû]'),
        `^\\s*(?:par\\s+|d[’']\\s*)?ou(?=${WORD}|$)`,
        word('se (?:situe|situent|trouve|trouvent)'),
        word('trajet|localisation|emplacement|chemine|cheminent'),
      ].join('|'),
      'i',
    ),
    markers: [
      'ou', 'situe', 'situee', 'situent', 'trouve', 'trouvent', 'localisation',
      'localise', 'emplacement', 'passe', 'passent', 'chemine', 'cheminent', 'trajet',
    ],
    leads: 'location',
  },
  {
    intent: 'composition',
    pattern: new RegExp(
      [
        word('de quoi'),
        word('compos[ée]{1,2}[es]?|composent|composition|constitu[ée]{1,2}[es]?|constituent'),
      ].join('|'),
      'i',
    ),
    markers: ['compose', 'composee', 'composent', 'composition', 'constitue', 'constituee', 'constituent'],
    leads: 'composition',
  },
  {
    intent: 'function',
    pattern: new RegExp([`${word('[àa] quoi')}.*ser[tv]`, word('r[ôo]le|utilit[ée]')].join('|'), 'i'),
    markers: ['sert', 'servent', 'utilite'],
    leads: 'function',
  },
  {
    intent: 'definition',
    pattern: new RegExp(
      [word('qu[’\']?est[- ]ce'), word('c[’\']?est quoi'), word('d[ée]finition|d[ée]finir')].join('|'),
      'i',
    ),
    markers: ['definition', 'definir'],
    leads: 'definition',
  },
];

export interface ReadQuestion {
  intent: QuestionIntent;
  /** Nature de savoir à faire remonter en tête de réponse. */
  leads: FactPredicate;
  /** Mots de forme à retirer des termes exigés, déjà normalisés. */
  markers: ReadonlySet<string>;
}

/**
 * Nature de la question, ou `null` si sa tournure n'est pas reconnue — auquel
 * cas rien ne change au comportement du moteur.
 */
export function readQuestion(question: string): ReadQuestion | null {
  for (const rule of RULES) {
    if (!rule.pattern.test(question)) continue;
    return { intent: rule.intent, leads: rule.leads, markers: new Set(rule.markers) };
  }
  return null;
}
