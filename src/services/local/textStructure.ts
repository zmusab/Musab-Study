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
 * Motif « X : a, b et c » — inline, sans dépendre de sauts de ligne : le
 * rendu d'une liste dans un PDF ne garantit pas des puces sur des lignes
 * séparées, le texte extrait est souvent un flux continu.
 */
const INLINE_LIST_PATTERN = /^(.{3,100}?)\s*:\s*(.{3,240})$/;

export function detectInlineEnumeration(sentence: string): EnumerationMatch | null {
  const trimmed = sentence.trim();
  const match = INLINE_LIST_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, intro, body] = match;
  const items = splitEnumerationItems(body!.replace(/\.\s*$/, ''));
  if (items.length < 2) return null;
  return { intro: intro!.trim(), items, sourceExcerpt: trimmed };
}

/** Motif « (intro)\n- a\n- b\n- c » : lignes à puces consécutives, précédées d'une ligne d'introduction. */
export function detectBulletEnumerations(chunkText: string): EnumerationMatch[] {
  const lines = chunkText.split(/\n+/);
  const results: EnumerationMatch[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isBulletLine(lines[i]!)) {
      i++;
      continue;
    }
    const start = i;
    const items: string[] = [];
    while (i < lines.length && isBulletLine(lines[i]!)) {
      const item = stripBulletPrefix(lines[i]!);
      if (item.length > 0) items.push(item);
      i++;
    }
    if (items.length >= 2) {
      const introLine = start > 0 ? lines[start - 1]!.trim() : '';
      const excerptLines = lines.slice(introLine.length > 0 ? start - 1 : start, i);
      results.push({
        intro: introLine.length > 0 ? introLine : null,
        items,
        sourceExcerpt: excerptLines.join('\n'),
      });
    }
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
