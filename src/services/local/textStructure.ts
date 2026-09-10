/**
 * Primitives textuelles pures — segmentation en phrases, détection de titres
 * et d'énumérations. Aucune IA, aucun accès Dexie, aucune mise en forme
 * disponible : `services/pdf/extract.ts` ne conserve que le texte et sa
 * position (`str`, `hasEOL`, `transform`), jamais le gras/italique/taille de
 * police. Tout ce qui suit repose donc uniquement sur la FORME du texte
 * (longueur de ligne, ponctuation, numérotation, connecteurs).
 *
 * Chaque fonction qui renvoie un extrait le renvoie comme un SOUS-EXTRAIT
 * EXACT de l'entrée (jamais reconstruit) — la vérifiabilité d'une carte ou
 * d'une notion générée localement dépend entièrement de cette garantie.
 */

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9])/;

/** Découpe un texte en phrases, chaque phrase restant un sous-extrait exact. */
export function splitIntoSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(SENTENCE_SPLIT))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/*
 * Marqueurs de puce réellement rencontrés dans des polycopiés PDF, et pas
 * seulement ceux d'un éditeur Markdown. Mesuré sur un cours de dentisterie :
 * « § » y apparaît 31 fois et « → » 14 fois — les deux marqueurs les plus
 * fréquents du document — alors qu'aucun des deux n'était reconnu. Résultat,
 * la puce restait collée au sujet extrait (« § Nerf lacrymal ») et aucune
 * question ne pouvait le retrouver.
 *
 * Le « o » minuscule (puce de troisième niveau sous Word) exige d'être suivi
 * d'une majuscule : sinon il couperait le mot « o rbitaire ».
 */
const BULLET_PREFIX = /^\s*(?:[-•*▪‣§◦▫→⇒➔►]|o(?=\s+[A-ZÀ-Þ])|\d{1,2}[.)]|[a-zA-Z][.)])\s+/;

export function isBulletLine(line: string): boolean {
  return BULLET_PREFIX.test(line);
}

/**
 * NIVEAU D'IMBRICATION D'UNE PUCE.
 *
 * Un polycopié Word imbrique ses listes, et l'imbrication porte du sens : les
 * trois branches terminales appartiennent à la phrase qui les annonce, pas à
 * la liste d'à côté. On a longtemps cru cette hiérarchie perdue — l'INDENTATION
 * l'est, en effet : `getTextContent()` ne rend que le texte et ses fins de
 * ligne.
 *
 * Elle survit ailleurs : dans le MARQUEUR. Position horizontale relevée dans
 * le PDF d'un vrai cours (« Divisions du nerf trijumeau ») :
 *
 *     « • » et « → »   toujours à x = 71
 *     « § »            toujours à x = 107
 *     « o »            toujours à x = 125
 *
 * Word attribue un marqueur par niveau et n'en change jamais dans un même
 * document. Le caractère qu'on lit dit donc la profondeur aussi sûrement que
 * la marge, sans avoir à faire remonter les coordonnées depuis l'extraction.
 *
 * `null` quand la ligne n'est pas une puce.
 */
const BULLET_DEPTHS: readonly (readonly string[])[] = [
  ['-', '*', '•', '→', '⇒', '➔', '►'],
  ['§', '▪', '‣'],
  ['o', '◦', '▫'],
];

export function bulletDepth(line: string): number | null {
  const marker = BULLET_PREFIX.exec(line)?.[0]?.trim();
  if (marker === undefined) return null;
  const level = BULLET_DEPTHS.findIndex((markers) => markers.includes(marker));
  // Une puce numérotée (« 1. », « a) ») n'appartient à aucun niveau connu :
  // traitée comme un premier niveau plutôt que comme une inconnue.
  return level === -1 ? 0 : level;
}

export function stripBulletPrefix(line: string): string {
  return line.replace(BULLET_PREFIX, '').trim();
}

const HEADING_MAX_WORDS = 8;
const HEADING_MAX_CHARS = 70;

/** Une ligne « titre » : courte, sans ponctuation de fin de phrase, suivie d'une ligne plus longue. */
function looksLikeHeading(line: string, followedByLongerLine: boolean): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > HEADING_MAX_CHARS) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  if (trimmed.split(/\s+/).length > HEADING_MAX_WORDS) return false;
  return followedByLongerLine;
}

/** Titres/sous-titres détectés dans un fragment — chaque résultat est une ligne exacte du texte source. */
export function detectHeadings(chunkText: string): string[] {
  const lines = chunkText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const headings: string[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (looksLikeHeading(lines[i]!, lines[i + 1]!.length > lines[i]!.length)) {
      headings.push(lines[i]!);
    }
  }
  return headings;
}

const LIST_SEPARATOR = /\s*,\s*(?:et\s+)?|\s+et\s+|\s+ou\s+|\s*;\s*/;
const LEADING_ARTICLE = /^(?:l['’]|le\s+|la\s+|les\s+|un\s+|une\s+|des\s+|de\s+|du\s+)/i;

/** Découpe une liste en items, en retirant les articles isolés en tête de chaque item. */
export function splitEnumerationItems(text: string): string[] {
  return text
    .split(LIST_SEPARATOR)
    .map((item) => item.trim().replace(LEADING_ARTICLE, '').trim())
    .filter((item) => item.length > 0 && item.length < 80);
}

export interface EnumerationMatch {
  intro: string | null;
  items: string[];
  /** Sous-extrait exact du texte source qui contient l'énumération entière. */
  sourceExcerpt: string;
}

/**
 * DEUX-POINTS QUI SÉPARE VRAIMENT — c'est-à-dire hors de toute parenthèse.
 *
 * Un cours écrit couramment : « Les nerfs palatins (x 3 : antérieur, moyen
 * postérieur) : ». Il y a DEUX deux-points, et seul le second annonce quelque
 * chose ; le premier est une précision entre parenthèses.
 *
 * Découper sur le premier donnait, tel quel, dans une réponse à l'écran :
 *
 *     • Les nerfs palatins (x 3 :
 *       ◦ Antérieur
 *       ◦ Moyen postérieur) :
 *
 * — une parenthèse ouverte au titre, refermée dans le dernier élément. Chaque
 * morceau est exact, l'ensemble ne veut plus rien dire.
 *
 * On ne compte donc que les deux-points au NIVEAU ZÉRO. Le repérage suit
 * l'ouverture et la fermeture des parenthèses et des crochets, sans rien
 * comprendre au texte : c'est de la ponctuation, pas du sens.
 */
export function topLevelColonIndex(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (char === ':' && depth === 0) return i;
  }
  return -1;
}

/**
 * Motif « X : a, b et c » — inline, sans dépendre de sauts de ligne : le
 * rendu d'une liste dans un PDF ne garantit pas des puces sur des lignes
 * séparées, le texte extrait est souvent un flux continu.
 */
const INTRO_MIN = 3;
const INTRO_MAX = 100;
const BODY_MIN = 3;
const BODY_MAX = 240;

export function detectInlineEnumeration(sentence: string): EnumerationMatch | null {
  const trimmed = sentence.trim();

  const colon = topLevelColonIndex(trimmed);
  if (colon < 0) return null;

  const intro = trimmed.slice(0, colon).trim();
  const body = trimmed.slice(colon + 1).trim();
  if (intro.length < INTRO_MIN || intro.length > INTRO_MAX) return null;
  if (body.length < BODY_MIN || body.length > BODY_MAX) return null;

  const items = splitEnumerationItems(body.replace(/\.\s*$/, ''));
  if (items.length < 2) return null;
  return { intro, items, sourceExcerpt: trimmed };
}

/**
 * Motif « (intro)\n- a\n- b\n- c » — une liste et ce qui l'annonce.
 *
 * ── UNE LISTE S'ARRÊTE OÙ SON NIVEAU S'ARRÊTE ─────────────────────────────
 * La première version prenait pour une seule liste TOUTES les puces
 * consécutives, quel que soit leur niveau. Sur un cours qui imbrique — c'est
 * le cas de tous les polycopiés Word — une sous-liste avalait donc la liste
 * suivante et tout ce qui venait après. Mesuré : « par où passe le nerf
 * ophtalmique ? » recevait les trois branches terminales suivies de neuf
 * lignes appartenant à d'autres listes (la numérotation en V, les ganglions,
 * les collatérales) — toutes justes, aucune demandée.
 *
 * Un changement de niveau ferme la liste en cours : c'est la structure écrite
 * par l'auteur, lue dans ses propres marqueurs, pas une ponctuation
 * interprétée.
 *
 * ── ET L'ANNONCE PEUT ÊTRE UNE PUCE ───────────────────────────────────────
 * À condition d'être MOINS PROFONDE. Une sous-liste est introduite par
 * l'élément qui la précède d'un cran, et c'est très exactement le lien qui
 * manquait. Une puce de MÊME niveau est une sœur : la prendre pour une
 * annonce donnait des sujets absurdes — les trois branches terminales du nerf
 * ophtalmique présentées sous le titre « Les nerfs III, IV et VI », qui n'est
 * que le dernier élément de la liste d'avant.
 */
export function detectBulletEnumerations(chunkText: string): EnumerationMatch[] {
  const lines = chunkText.split(/\n+/);
  const results: EnumerationMatch[] = [];
  let i = 0;
  while (i < lines.length) {
    const depth = bulletDepth(lines[i]!);
    if (depth === null) {
      i++;
      continue;
    }

    const start = i;
    const items: string[] = [];
    while (i < lines.length && bulletDepth(lines[i]!) === depth) {
      const item = stripBulletPrefix(lines[i]!);
      if (item.length > 0) items.push(item);
      i++;
    }
    if (items.length < 2) continue;

    const previous = start > 0 ? lines[start - 1]! : null;
    const previousDepth = previous === null ? null : bulletDepth(previous);
    const introduces =
      previous !== null && previous.trim().length > 0 && (previousDepth === null || previousDepth < depth);

    results.push({
      intro: introduces ? previous.trim() : null,
      items,
      sourceExcerpt: lines.slice(introduces ? start - 1 : start, i).join('\n'),
    });
  }
  return results;
}

const FRENCH_NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7,
  huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
};

export interface NumericMention {
  /** La forme exacte trouvée dans le texte ("trois" ou "3"). */
  word: string;
  value: number;
  noun: string | null;
}

/** Repère un compte explicite en tête d'un fragment de texte ("trois branches…"). */
export function detectLeadingCount(text: string): NumericMention | null {
  const match = /^(\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze)\s+([a-zà-ÿ]+)/i.exec(
    text.trim(),
  );
  if (!match) return null;
  const [, word, noun] = match;
  const value = /^\d+$/.test(word!) ? Number(word) : FRENCH_NUMBER_WORDS[word!.toLowerCase()];
  if (value === undefined) return null;
  return { word: word!, value, noun: noun ?? null };
}
