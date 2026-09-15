import {
  bulletDepth,
  stripBulletPrefix,
  detectInlineEnumeration,
  detectBulletEnumerations,
  detectLeadingCount,
  splitEnumerationItems,
  splitIntoSentences,
} from './textStructure';
import { isPlausibleSubject, isPlausibleAnswerText, subjectBeforeVerb } from './textQuality';
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
    const negationObject = trimTrailingPeriod(remainderRaw!);
    if (!isPlausibleSubject(subject) || !isPlausibleAnswerText(negationObject)) return null;
    return {
      subject,
      predicate: 'possession',
      object: negationObject,
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
    const classificationSubject = subjectRaw!.trim();
    const object = trimTrailingPeriod(bodyRaw!);
    const items = itemsFromObject(object);
    if (items && isPlausibleSubject(classificationSubject) && isPlausibleAnswerText(object)) {
      return {
        subject: classificationSubject,
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
    if (!isPlausibleSubject(subject)) continue;
    const object = trimTrailingPeriod(objectRaw!);
    if (!isPlausibleAnswerText(object)) continue;

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
  if (inline && inline.intro && isPlausibleSubject(inline.intro)) {
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
    /*
      La puce résiduelle et le deux-points d'annonce sont retirés AVANT
      validation : « 4 muscles droits : » nomme bien les quatre muscles
      droits, il ne faut le refuser ni pour sa ponctuation ni pour sa puce.
    */
    .map((match) => ({
      ...match,
      intro:
        match.intro === null ? null : stripBulletPrefix(match.intro).replace(/\s*:\s*$/, '').trim(),
    }))
    .filter((match) => match.intro !== null && isPlausibleSubject(match.intro))
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
/**
 * Une phrase COUPÉE par la frontière du fragment n'est pas une phrase.
 *
 * Le découpage en fragments tombe où il tombe : la dernière « phrase » d'un
 * fragment se termine régulièrement au milieu d'une proposition. L'assistant
 * affichait donc, tel quel, « … le sinus du sillon caverneux qui se trouve sur
 * les côtés de » — un extrait exact, vérifiable, et inutilisable.
 *
 * Rien n'est perdu à l'écarter : les fragments se CHEVAUCHENT (150 caractères,
 * voir `services/rag/chunking.ts`), la phrase complète existe donc dans le
 * fragment voisin. On préfère la version entière.
 *
 * Le deux-points est accepté : « Le nerf trijumeau possède trois branches : »
 * introduit une énumération et se suffit à lui-même.
 */
function endsOnCompleteSentence(sentence: string): boolean {
  return /[.!?:;»)\]]\s*$/.test(sentence.trim());
}

/**
 * TITRE COURANT — le sujet que la phrase ne répète pas.
 *
 * Un polycopié écrit « Nerf frontal » sur une ligne, puis « Il entre dans
 * l'orbite par la fissure orbitaire supérieure. ». Le sujet de la phrase est
 * un pronom : `isPlausibleSubject` le rejette, à juste titre — « Il » ne
 * nomme rien. Résultat mesuré sur un vrai cours : la question « nerf frontal »
 * ne trouvait AUCUNE réponse, alors que le document lui consacre une section
 * entière.
 *
 * Le sujet n'est pas absent : il est une ligne plus haut. Ce repérage
 * attribue à une phrase à pronom le dernier TITRE rencontré.
 *
 * Ce que ça ne fait pas — et c'est la limite qui garde le procédé honnête :
 *  - l'extrait source n'est JAMAIS réécrit ; seul le champ `subject`, qui sert
 *    à regrouper et à retrouver, reçoit le titre ;
 *  - la substitution n'a lieu que si la phrase commence par un pronom, jamais
 *    si elle nomme déjà son sujet ;
 *  - un titre trop long, ponctué, ou qui n'est pas un groupe nominal
 *    plausible, n'est pas retenu.
 */
const HEADING_MAX_CHARS = 70;
/*
 * Le pronom peut être précédé d'un CONNECTEUR : « Puis il entre… », « Ensuite
 * elle donne… ». La phrase reste une phrase à pronom, et son sujet reste une
 * ligne plus haut.
 *
 * Sans ces connecteurs, « Puis il entre dans le sinus caverneux où il est en
 * rapport avec : » gardait pour sujet « Puis il entre dans le sinus caverneux
 * où il » — un morceau de phrase, qu'aucune question ne peut retrouver — au
 * lieu du titre de la section, « Le nerf ophtalmique de Willis ».
 *
 * La liste est celle de `SENTENCE_RESTART` (courseLayout) : les mots qui, en
 * français, ouvrent une reprise de phrase.
 */
/*
 * Le DÉMONSTRATIF suivi d'un nom est lui aussi une anaphore : « Ce nerf finit
 * en se divisant en 3 catégories de branches : » désigne la structure nommée
 * par le titre juste au-dessus, exactement comme « Il finit… ».
 *
 * Sans lui, la règle « le titre ne sert de sujet que si la phrase n'en a
 * pas » faisait perdre de bonnes cartes : les trois catégories de branches du
 * nerf frontal n'étaient plus rattachées à rien.
 */
const PRONOUN_SUBJECT =
  /^(?:(?:puis|ensuite|enfin|alors|ainsi|donc|apr[èe]s)\s+)?(?:il|elle|ils|elles|celui-ci|celle-ci|ce dernier|cette dernière|ce|cet|cette|ces)(?=$|[^\wà-ÿ])/i;

function headingCandidate(line: string): string | null {
  const trimmed = line.replace(/^[\s•§▪‣◦▫→⇒➔►o]+/u, '').replace(/\s*:\s*$/, '').trim();
  if (trimmed.length < 3 || trimmed.length > HEADING_MAX_CHARS) return null;
  // Un titre ne se termine pas par un point : ça, c'est une phrase.
  if (/[.!?]$/.test(trimmed)) return null;
  if (!isPlausibleSubject(trimmed)) return null;
  return trimmed;
}

/**
 * Réécrit le sujet d'un fait quand la phrase commence par un pronom et qu'un
 * titre le précède. `sourceExcerpt` reste identique au caractère près.
 */
function attributeToHeading(fact: RawFact, sentence: string, heading: string | null): RawFact {
  if (!heading) return fact;
  if (!PRONOUN_SUBJECT.test(sentence.trim())) return fact;
  return {
    ...fact,
    subject: heading,
    // Un sujet déduit de la mise en page, non écrit dans la phrase : jamais
    // 'high'. Une carte ou une réponse en tiendra compte.
    confidence: fact.confidence === 'high' ? 'medium' : fact.confidence,
  };
}

/**
 * LES ÉLÉMENTS QUI APPARTIENNENT À LA LIGNE `index`.
 *
 * C'est-à-dire les puces qui la suivent immédiatement à un niveau PLUS
 * PROFOND. Une puce de même niveau est une sœur, pas un élément : elle arrête
 * la collecte.
 *
 * Les petits-enfants (encore plus profonds) sont sautés sans arrêter la
 * liste : ils appartiennent à l'élément qui les précède, et c'est le tour de
 * CETTE ligne-là qui les rattachera.
 */
function nestedItemsAfter(
  lines: readonly string[],
  index: number,
  parentDepth: number | null,
): { items: string[]; end: number } {
  const childDepth = bulletDepth(lines[index + 1] ?? '');
  if (childDepth === null) return { items: [], end: index };
  if (parentDepth !== null && childDepth <= parentDepth) return { items: [], end: index };

  const items: string[] = [];
  let i = index + 1;
  for (; i < lines.length; i += 1) {
    const depth = bulletDepth(lines[i]!);
    if (depth === null || depth < childDepth) break;
    if (depth > childDepth) continue; // petit-enfant : il a son propre parent.
    const item = stripBulletPrefix(lines[i]!);
    if (item.length > 0) items.push(item);
  }
  return { items, end: i - 1 };
}

/**
 * ANNONCE SANS RÈGLE RECONNUE.
 *
 * « Puis il entre dans le sillon carotidien … où il est en rapport avec : »
 * n'emploie aucun des verbes que les règles connaissent, et ne produisait donc
 * AUCUN fait — alors que trois puces la suivent et la complètent.
 *
 * Une ligne qui se termine par un deux-points et qui est suivie d'une liste
 * plus profonde annonce une composition : c'est la ponctuation de l'auteur, et
 * la structure de son document, pas une interprétation de sens.
 *
 * Le sujet ne s'invente pas pour autant. Si la phrase nomme elle-même ce dont
 * elle parle, on prend ce nom ; sinon on prend le TITRE de la section en
 * cours — le cas courant, la phrase commençant alors par un pronom (« Puis
 * il… »). Sans l'un ni l'autre, pas de fait : mieux vaut se taire.
 */
const ANNOUNCES_A_LIST = /:\s*$/;

function announcementFact(
  sentence: string,
  items: string[],
  sourceExcerpt: string,
  heading: string | null,
  chunk: DocumentChunk,
): RawFact | null {
  if (!ANNOUNCES_A_LIST.test(sentence)) return null;

  const own = sentence.replace(ANNOUNCES_A_LIST, '').trim();
  /*
    LE TITRE NE SERT DE SUJET QUE SI LA PHRASE N'EN A PAS.

    Cette ligne retombait sur le titre courant dès que le sujet propre de la
    phrase était rejeté. Mesuré sur un vrai cours : « Et 2 muscles obliques : »
    est refusé (il commence par un connecteur), le moteur reprend alors le
    dernier titre — « 4 muscles droits », trois lignes plus haut — et produit
    une carte FAUSSE : « De quoi se compose 4 muscles droits ? » avec, pour
    réponse, la liste des muscles OBLIQUES.

    Une carte fausse est pire qu'une carte absente : l'étudiant l'apprend. Le
    titre n'est donc emprunté que lorsque la phrase ne nomme rien elle-même,
    c'est-à-dire quand elle commence par un pronom — le seul cas où le sujet
    est réellement une ligne plus haut.
  */
  const subject = isPlausibleSubject(own)
    ? own
    : // La phrase nomme peut-être son sujet avant son verbe.
      (subjectBeforeVerb(own) ??
      // Sinon, et seulement si elle ne nomme rien, le titre de la section.
      (PRONOUN_SUBJECT.test(sentence.trim()) ? heading : null));
  if (!subject) return null;

  return {
    subject,
    predicate: 'composition',
    object: items.join(', '),
    items,
    countWord: null,
    countNoun: null,
    sourceChunkId: chunk.id,
    sourceExcerpt,
    // Relation déduite d'un deux-points et d'une mise en page, jamais
    // confirmée par un verbe : prudence, comme pour les listes inline.
    confidence: 'medium',
  };
}

export function extractFacts(chunk: DocumentChunk): RawFact[] {
  const facts: RawFact[] = [];
  let heading: string | null = null;
  const allLines = chunk.text.split('\n');

  for (let lineIndex = 0; lineIndex < allLines.length; lineIndex += 1) {
    const rawLine = allLines[lineIndex]!;
    /*
     * La puce est retirée AVANT toute analyse. Sans cela, le sujet extrait
     * était « § Nerf lacrymal » ou « → Dans son trajet le nerf ophtalmique » :
     * un marqueur de mise en page se retrouvait dans le nom de la notion, et
     * plus aucune question ne pouvait le retrouver.
     *
     * L'extrait reste un sous-extrait exact du fragment : on n'enlève qu'un
     * préfixe, on ne réécrit rien.
     */
    const line = stripBulletPrefix(rawLine);
    const sentences = splitIntoSentences(line);

    // Les polycopiés utilisent souvent « Nerf supra-orbitaire : … » sur la
    // même ligne que la première explication. Ce libellé devient le contexte
    // des phrases à pronom qui suivent sur cette ligne et les suivantes ; il
    // ne faut pas les rattacher au grand titre précédent (« Nerf frontal »).
    const inlineLabel = line.match(/^([^:]{3,70})\s*:\s+\S/);
    if (inlineLabel && /^(?:nerf|muscle|artere|artère|veine|ganglion|branche)\b/i.test(inlineLabel[1]!.trim())) {
      const candidate = headingCandidate(inlineLabel[1]!);
      if (candidate) heading = candidate;
    }

    /*
      Une ligne courte, sans ponctuation finale, qui ne produit aucun fait :
      c'est un titre de section. On la retient pour les lignes suivantes.

      JAMAIS UNE PUCE, en revanche. Une puce est un élément de liste, pas un
      titre — et la confondre avec un titre attribuait le sujet de la section
      à la dernière énumération rencontrée. Mesuré sur le cours du trijumeau :
      les trois branches terminales du nerf ophtalmique se retrouvaient
      rangées sous le sujet « Les nerf III, IV et VI », qui n'est que le
      dernier élément de la liste d'au-dessus.
    */
    if (sentences.length === 1 && bulletDepth(rawLine) === null) {
      const candidate = headingCandidate(line);
      if (candidate && !/[.!?]$/.test(line.trim())) {
        const own = factFromSentence(sentences[0]!, chunk);
        if (!own) {
          heading = candidate;
          continue;
        }
      }
    }

    /*
      LA LISTE QUI SUIT CETTE LIGNE LUI APPARTIENT.

      C'est le lien qui manquait, et il manquait des deux côtés à la fois :
      la PHRASE d'annonce donnait un fait au bon sujet mais sans éléments (ils
      sont sur les lignes d'après), et la LISTE avait ses éléments mais aurait
      eu pour sujet la phrase entière — que `isPlausibleSubject` refuse à
      juste titre, une phrase de deux lignes n'étant pas un nom.

      Mesuré : la réponse s'arrêtait sur « … se divise en 3 branches
      terminales : » et les branches n'arrivaient jamais. Une annonce sans sa
      liste ne vaut rien.
    */
    const nested = nestedItemsAfter(allLines, lineIndex, bulletDepth(rawLine));
    const hasList = nested.items.length >= 2;
    const excerptWithList = hasList
      ? allLines.slice(lineIndex, nested.end + 1).join('\n')
      : null;

    sentences.forEach((sentence, index) => {
      // Seule la DERNIÈRE phrase d'une ligne peut être tronquée par la
      // découpe en fragments ; les autres sont entières par construction.
      const isLast = index === sentences.length - 1;
      if (isLast && !endsOnCompleteSentence(sentence)) return;

      // Seule la dernière phrase de la ligne annonce la liste qui suit.
      const carriesList = isLast && hasList;

      const fact = factFromSentence(sentence, chunk);
      if (fact) {
        const enriched =
          carriesList && fact.items === null
            ? { ...fact, items: nested.items, sourceExcerpt: excerptWithList! }
            : fact;
        facts.push(attributeToHeading(enriched, sentence, heading));
        return;
      }

      // Aucune règle ne reconnaît la phrase, mais elle annonce une liste :
      // c'est la ponctuation de l'auteur qui l'établit, pas une devinette.
      if (!carriesList) return;
      const announced = announcementFact(sentence, nested.items, excerptWithList!, heading, chunk);
      if (announced) facts.push(announced);
    });
  }

  /*
    Les listes « nues » — celles qu'aucune ligne n'a réclamées — viennent
    ensuite. Le dédoublonnage sur l'extrait évite qu'une même énumération
    paraisse deux fois, une fois rattachée à son annonce et une fois seule.
  */
  const claimed = new Set(facts.map((fact) => fact.sourceExcerpt.trim()));
  return [
    ...facts,
    ...factsFromBullets(chunk).filter((fact) => !claimed.has(fact.sourceExcerpt.trim())),
  ];
}
