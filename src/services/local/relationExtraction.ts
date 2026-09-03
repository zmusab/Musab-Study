import {
  detectInlineEnumeration,
  detectBulletEnumerations,
  detectLeadingCount,
  splitEnumerationItems,
  splitIntoSentences,
} from './textStructure';
import type { DocumentChunk, ID } from '@/types';

/**
 * Détection de relations en français, par motifs — le cœur du moteur
 * pédagogique local. AUCUN appel IA, jamais un texte reformulé : chaque
 * `RawFact.sourceExcerpt` est un sous-extrait EXACT du chunk source, la même
 * garantie de vérifiabilité que le chemin IA (citations `[Sn]`).
 *
 * RÈGLE ABSOLUE (imposée après revue) : l'abstention prime sur l'extraction
 * incertaine. Un extrait exact garantit la vérifiabilité, pas la justesse
 * sémantique — une phrase à la négation, à l'exception ou trop composée
 * n'est jamais forcée dans un motif positif : elle est rejetée (retourne
 * `null`) plutôt que transformée en fait potentiellement faux.
 */

export type FactPredicate = 'definition' | 'composition' | 'possession' | 'function' | 'location' | 'classification';
/**
 * 'low' existe pour les consommateurs (toujours à exclure d'une carte/notion)
 * mais n'est aujourd'hui jamais émis par ce module : un cas trop incertain
 * (exception, négation ambiguë) est abstenu à la source (`null`), une forme
 * d'abstention encore plus stricte que « détecté mais peu fiable ».
 */
export type FactConfidence = 'high' | 'medium' | 'low';

export interface RawFact {
  subject: string;
  predicate: FactPredicate;
  /** Sous-extrait exact décrivant l'objet de la relation (jamais reformulé). */
  object: string;
  /** Éléments d'une énumération détectée dans l'objet, si applicable. */
  items: string[] | null;
  /** Compte explicite en tête de l'objet ("trois" dans "trois branches"), pour les cartes à trous. */
  countWord: string | null;
  countNoun: string | null;
  sourceChunkId: ID;
  /** Phrase complète d'origine — sous-extrait exact du chunk. */
  sourceExcerpt: string;
  confidence: FactConfidence;
}

// ─────────────────────── Négation / exception : toujours prudent ───────────────────────

/**
 * Une exception introduite par ces connecteurs est trop incertaine à parser
 * sans compréhension réelle — toujours écartée. Pas de `\b` autour de « à » :
 * en JavaScript, `\b` ne reconnaît que les caractères ASCII comme
 * caractères de mot — un « à » entouré d'espaces n'a donc JAMAIS de
 * frontière `\b` adjacente (espace et « à » sont tous deux « non-mot » pour
 * `\w`), ce qui rendrait `\bcontrairement à\b` structurellement incapable de
 * matcher. Les phrases restent assez longues et distinctives pour ne
 * jamais matcher accidentellement comme sous-chaîne d'un autre mot.
 */
const HEDGE_EXCEPTION_PATTERN = /contrairement à|à l['’]exception de|\bsauf\b|\bmais pas\b|\bhormis\b/i;

/** Qualificatifs qui signalent une vérité conditionnelle, pas absolue — abaissent la confiance sans rejeter. */
const HEDGE_QUALIFIER_PATTERN =
  /\b(?:parfois|généralement|souvent|dans certains cas|en général|habituellement|la plupart du temps)\b/i;

/**
 * « X ne possède pas de Y » : la seule forme de négation traitée comme un
 * fait exploitable — un seul verbe, un seul « pas », sens sans ambiguïté.
 * Le groupe 2 capture le reste EXACTEMENT (aucune reconstruction), garantie
 * de sous-extrait exact.
 */
const CLEAN_NEGATION_PATTERN =
  /^(.{2,60}?)\s+(ne\s+(?:possède|comporte|présente|donne|produit|comprend)\s+pas\s+.{3,200})$/i;

/** Toute autre négation ("ne … pas" hors du motif propre ci-dessus) reste incertaine — écartée plutôt que devinée. */
const OTHER_NEGATION_PATTERN = /\bn(?:e|['’])\s+\S+(?:\s+\S+){0,4}?\s+pas\b/i;

const RULES: { predicate: FactPredicate; regex: RegExp }[] = [
  { predicate: 'definition', regex: /^(.{2,60}?)\s+(?:est|désigne|correspond à|représente)\s+(.{3,300})$/i },
  {
    predicate: 'composition',
    regex:
      /^(.{2,60}?)\s+(?:se compose de|est composée? de|comprend|est constituée? de)\s+(.{3,300})$/i,
  },
  {
    predicate: 'possession',
    // Lookbehind négatif sur « présente » : « X se présente… » (verbe
    // réfléchi, ex. « un patient se présente pour… ») n'a AUCUN rapport
    // avec la possession — sans cette exclusion, toute phrase clinique
    // rédigée à la forme réflexive deviendrait un faux « X possède Y ».
    regex: /^(.{2,60}?)\s+(?:possède|comporte|(?<!se\s)présente|dispose de)\s+(.{3,300})$/i,
  },
  {
    predicate: 'function',
    regex: /^(.{2,60}?)\s+(?:donne|produit|permet de|permet|assure|commande|contrôle|joue le rôle de)\s+(.{3,300})$/i,
  },
  {
    predicate: 'location',
    regex: /^(.{2,60}?)\s+(?:se situe|se trouve|est situ[ée]e?|est localisé[ée]?)\s+(.{3,300})$/i,
  },
];

const CLASSIFICATION_PATTERN =
  /^(?:il existe|on distingue|on décrit)\s+(?:\d+|deux|trois|quatre|cinq|six)\s+types?\s+de\s+(.{2,60}?)\s*:\s*(.{3,300})$/i;

const ITEM_PREDICATES = new Set<FactPredicate>(['composition', 'possession']);

function trimTrailingPeriod(text: string): string {
  return text.replace(/\.\s*$/, '').trim();
}

/** Confiance abaissée (jamais rejetée) pour une phrase longue, composée, ou qualifiée. */
function baseConfidence(sentence: string): FactConfidence {
  if (HEDGE_QUALIFIER_PATTERN.test(sentence)) return 'medium';
  if (sentence.length > 220) return 'medium';
  if ((sentence.match(/,/g)?.length ?? 0) > 3) return 'medium';
  return 'high';
}

/** Items d'une énumération présente dans l'objet d'un fait (après un ':' éventuel), sous-extrait exact. */
function itemsFromObject(object: string): string[] | null {
  const colonIndex = object.indexOf(':');
  const body = colonIndex >= 0 ? object.slice(colonIndex + 1) : object;
  const items = splitEnumerationItems(body);
  return items.length >= 2 ? items : null;
}

function factFromSentence(sentence: string, chunk: DocumentChunk): RawFact | null {
  const trimmed = sentence.trim();
  if (trimmed.length < 8) return null;

  // ── Prudence avant tout : exceptions et négations ambiguës sont écartées. ──
  if (HEDGE_EXCEPTION_PATTERN.test(trimmed)) return null;

  const cleanNegation = CLEAN_NEGATION_PATTERN.exec(trimmed);
  if (cleanNegation) {
    const [, subjectRaw, remainderRaw] = cleanNegation;
    const subject = subjectRaw!.trim();
    if (subject.length === 0 || /^\d/.test(subject)) return null;
    return {
      subject,
      predicate: 'possession',
      object: trimTrailingPeriod(remainderRaw!),
      items: null,
      countWord: null,
      countNoun: null,
      sourceChunkId: chunk.id,
      sourceExcerpt: trimmed,
      // Négation propre à une seule clause, sens non ambigu — jamais 'high' malgré tout.
      confidence: 'medium',
    };
  }
  if (OTHER_NEGATION_PATTERN.test(trimmed)) return null;

  // ── Classification numérotée ("il existe trois types de X : a, b, c"). ──
  const classification = CLASSIFICATION_PATTERN.exec(trimmed);
  if (classification) {
    const [, subjectRaw, bodyRaw] = classification;
    const object = trimTrailingPeriod(bodyRaw!);
    const items = itemsFromObject(object);
    if (items) {
      return {
        subject: subjectRaw!.trim(),
        predicate: 'classification',
        object,
        items,
        countWord: null,
        countNoun: null,
        sourceChunkId: chunk.id,
        sourceExcerpt: trimmed,
        confidence: baseConfidence(trimmed),
      };
    }
  }

  // ── Motifs verbaux ordinaires. ──
  for (const rule of RULES) {
    const match = rule.regex.exec(trimmed);
    if (!match) continue;
    const [, subjectRaw, objectRaw] = match;
    const subject = subjectRaw!.trim();
    if (subject.length === 0 || /^\d/.test(subject)) continue;
    const object = trimTrailingPeriod(objectRaw!);
    if (object.length === 0) continue;

    const count = ITEM_PREDICATES.has(rule.predicate) ? detectLeadingCount(object) : null;
    const items = ITEM_PREDICATES.has(rule.predicate) ? itemsFromObject(object) : null;

    return {
      subject,
      predicate: rule.predicate,
      object,
      items,
      countWord: count?.word ?? null,
      countNoun: count?.noun ?? null,
      sourceChunkId: chunk.id,
      sourceExcerpt: trimmed,
      confidence: baseConfidence(trimmed),
    };
  }

  // ── Dernier recours : liste inline sans verbe reconnu ("Les branches : a, b, c"). ──
  const inline = detectInlineEnumeration(trimmed);
  if (inline && inline.intro) {
    return {
      subject: inline.intro,
      predicate: 'composition',
      object: trimmed,
      items: inline.items,
      countWord: null,
      countNoun: null,
      sourceChunkId: chunk.id,
      sourceExcerpt: trimmed,
      // Relation générique déduite d'une simple ponctuation, jamais confirmée par un verbe : prudence.
      confidence: 'medium',
    };
  }

  return null;
}

/** Faits issus de listes à puces du fragment — hors du flux phrase par phrase. */
function factsFromBullets(chunk: DocumentChunk): RawFact[] {
  return detectBulletEnumerations(chunk.text)
    .filter((match) => match.intro !== null && match.intro.length >= 4)
    .map((match) => ({
      subject: match.intro!,
      predicate: 'composition' as const,
      object: match.items.join(', '),
      items: match.items,
      countWord: null,
      countNoun: null,
      sourceChunkId: chunk.id,
      sourceExcerpt: match.sourceExcerpt,
      confidence: 'medium' as const,
    }));
}

/**
 * Extrait tous les faits détectables d'un fragment de cours — jamais de
 * texte reformulé, toujours un sous-extrait exact du chunk source. Un fait
 * incertain (négation ambiguë, exception) est absent du résultat plutôt que
 * présent avec une confiance dégradée : `null` veut dire « rien de fiable
 * ici », pas « peut-être ».
 */
export function extractFacts(chunk: DocumentChunk): RawFact[] {
  const sentenceFacts = splitIntoSentences(chunk.text)
    .map((sentence) => factFromSentence(sentence, chunk))
    .filter((fact): fact is RawFact => fact !== null);

  return [...sentenceFacts, ...factsFromBullets(chunk)];
}
