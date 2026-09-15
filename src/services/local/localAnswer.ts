import { extractFacts, type FactPredicate, type RawFact } from './relationExtraction';
import { citationFromChunk } from './citation';
import { bulletDepth, stripBulletPrefix, topLevelColonIndex } from './textStructure';
import { courseSections } from './courseLayout';
import { readQuestion, type ReadQuestion } from './questionIntent';
import { significantWords } from '@/core/text';
import { wordSimilarity } from '@/services/search/fuzzy';
import type { ScoredChunk, ContextLookup } from '@/services/rag/retrieval';
import type { Citation } from '@/types';

/**
 * Réponse à une question libre SANS IA — réutilise `relationExtraction.ts`
 * (le même moteur que les flashcards/notions locales) plutôt que d'inventer
 * un second mécanisme, et la récupération BM25 déjà calculée par
 * `ChatPage.tsx` (aucune nouvelle recherche).
 *
 * La réponse n'est JAMAIS reformulée : elle est l'assemblage d'extraits
 * exacts du cours. Si rien ne répond vraiment, la fonction renvoie `null` —
 * mieux ne rien répondre que d'inventer.
 *
 * ── POURQUOI CE MOTEUR RÉPONDAIT À CÔTÉ ──────────────────────────────────
 * La version précédente ne mesurait qu'une chose : « la question couvre-t-elle
 * le sujet du fait ? », en divisant par la taille du SUJET. Un fait dont le
 * sujet tient en un mot générique (« le nerf ») obtenait donc un score PARFAIT
 * face à n'importe quelle question contenant ce mot. À « c'est quoi les nerfs
 * de Willis ? », le moteur renvoyait avec assurance des phrases sur le nerf
 * facial : le terme qui distinguait réellement la question — « Willis » —
 * n'entrait jamais dans le calcul.
 *
 * La correction inverse la logique : ce sont les termes DISTINCTIFS de la
 * question qui commandent, et ils sont mesurés sur le cours lui-même plutôt
 * que devinés — un terme rare dans les fragments retrouvés est distinctif, un
 * terme présent partout ne l'est pas. Aucune liste de termes médicaux codée en
 * dur : la mesure s'adapte au cours réellement importé.
 */

export interface LocalAnswer {
  text: string;
  citations: Citation[];
}

/**
 * Part du SUJET du fait que la question doit recouper. Volontairement bas :
 * depuis que les termes distinctifs sont exigés séparément (ci-dessous), ce
 * seuil n'a plus à faire le tri à lui seul. Le garder trop haut écarterait une
 * bonne réponse dont le sujet est nommé autrement que dans la question
 * (« polygone de Willis » interrogé par « les nerfs de Willis »).
 */
const SUBJECT_OVERLAP_FLOOR = 0.34;
/*
 * Quatre faits, c'était le plafond d'une réponse « deux extraits collés ». Une
 * leçon rangée par nature de savoir a besoin de couvrir ses cinq ou six
 * rubriques : le plafond monte, et c'est la pertinence (termes distinctifs +
 * recouvrement du sujet) qui continue de faire le tri, pas un compteur.
 */
const MAX_FACTS_IN_ANSWER = 12;

/**
 * Ordre par défaut : celui d'un enseignant qui présente une notion — ce que
 * c'est d'abord, où ça se trouve en dernier.
 */
const PREDICATE_PRIORITY: Record<FactPredicate, number> = {
  definition: 0,
  classification: 1,
  composition: 1,
  possession: 1,
  function: 2,
  location: 2,
};

/**
 * …mais l'ordre d'un COURS n'est pas l'ordre d'une RÉPONSE. À « où se situe le
 * nerf lacrymal ? », commencer par sa définition, c'est faire attendre
 * l'étudiant pendant trois lignes avant de lui dire ce qu'il demandait. La
 * nature de savoir appelée par la question passe donc devant tout le reste ;
 * le reste garde son ordre habituel derrière elle.
 */
function predicateRank(predicate: FactPredicate, asked: ReadQuestion | null): number {
  if (asked && predicate === asked.leads) return -1;
  return PREDICATE_PRIORITY[predicate];
}

/** Part du sujet du fait effectivement nommée par la question. */
function subjectOverlap(questionTerms: Set<string>, subjectTerms: Set<string>): number {
  if (subjectTerms.size === 0) return 0;
  const shared = [...subjectTerms].filter((term) => questionTerms.has(term)).length;
  return shared / subjectTerms.size;
}

/**
 * Termes qui distinguent réellement la question, mesurés sur les fragments
 * retrouvés : ceux qui apparaissent dans le MOINS de fragments. « nerf » est
 * partout dans un cours de neuro-anatomie et ne distingue rien ; « trijumeau »
 * n'est que dans quelques fragments et porte toute la question.
 *
 * ── LA VARIANTE D'ÉCRITURE N'EST PAS UNE ABSENCE ──────────────────────────
 * Le moteur renvoyait `null` dès qu'un terme de la question n'apparaissait pas
 * TEL QUEL dans le cours. D'où le « Absent de tes cours » sur « Les nerfs
 * infra orbitrales c'est quoi » : le cours écrit « infra-orbitaire »,
 * l'étudiant a tapé « orbitrales », et cette seule différence d'orthographe
 * faisait déclarer absent un sujet traité sur trois pages.
 *
 * Chaque terme est donc d'abord RAPPROCHÉ du vocabulaire réel du cours, avec
 * le même moteur approximatif que la recherche du site (`services/search/
 * fuzzy.ts`, celui qui fait retrouver « masséter » à partir de « masster »).
 *
 * ── MAIS UN TERME VRAIMENT INCONNU RESTE FATAL ────────────────────────────
 * Une première tentative se contentait d'IGNORER les termes irréductibles.
 * Elle rouvrait aussitôt le pire bug de ce moteur : « c'est quoi les nerfs de
 * Willis ? » sur un cours qui ne mentionne pas Willis voyait le terme
 * disparaître, ne gardait que « nerf », et répondait avec assurance des
 * phrases sur le nerf facial. Le mot qui portait TOUTE la question était
 * précisément celui qu'on jetait.
 *
 * La règle tient donc en une phrase : on corrige une graphie, on n'efface
 * jamais un mot. Si un terme ne se rattache à rien du cours, même
 * approximativement, on s'abstient.
 */

/**
 * Seuil de rapprochement. Volontairement au-dessus du bruit : « orbitrales »
 * et « orbitaire » obtiennent 0,67 — deux graphies du même terme —, tandis que
 * « willis » n'atteint rien face au vocabulaire d'un cours qui l'ignore.
 */
const TERM_MATCH_FLOOR = 0.6;
/**
 * …et il faut en plus un début de mot commun. Sans cette condition, la seule
 * distance d'édition rapproche des mots qui n'ont rien à voir dès qu'ils sont
 * courts : « palais » et « malaise » sont à deux éditions l'un de l'autre.
 */
const COMMON_PREFIX_CHARS = 3;

function sharesPrefix(a: string, b: string): boolean {
  return a.slice(0, COMMON_PREFIX_CHARS) === b.slice(0, COMMON_PREFIX_CHARS);
}

/** Terme du cours correspondant à `term`, ou `null` si le cours l'ignore. */
function resolveTerm(term: string, corpusWords: readonly string[]): string | null {
  // Correspondance exacte d'abord : le cas courant, et le moins coûteux.
  if (corpusWords.includes(term)) return term;

  let best: string | null = null;
  let bestScore = 0;
  for (const word of corpusWords) {
    if (!sharesPrefix(term, word)) continue;
    const score = wordSimilarity(term, word);
    if (score > bestScore) {
      bestScore = score;
      best = word;
    }
  }
  return bestScore >= TERM_MATCH_FLOOR ? best : null;
}

function distinctiveTerms(questionTerms: Set<string>, chunkTermSets: Set<string>[]): Set<string> | null {
  const corpusWords = [...new Set(chunkTermSets.flatMap((terms) => [...terms]))];
  const frequencies = new Map<string, number>();
  let lowestFrequency = Number.POSITIVE_INFINITY;

  for (const term of questionTerms) {
    const resolved = resolveTerm(term, corpusWords);
    // Un mot que le cours ignore complètement peut être CELUI qui porte la
    // question : on ne répond pas sur le reste.
    if (resolved === null) return null;

    const frequency = chunkTermSets.filter((terms) => terms.has(resolved)).length;
    frequencies.set(resolved, frequency);
    if (frequency < lowestFrequency) lowestFrequency = frequency;
  }

  const distinctive = new Set<string>();
  for (const [term, frequency] of frequencies) {
    if (frequency === lowestFrequency) distinctive.add(term);
  }
  return distinctive.size > 0 ? distinctive : null;
}

/**
 * COMPOSE UNE LEÇON, plus un tas d'extraits.
 *
 * La version précédente rendait `**Sujet** — 2 éléments trouvés` suivi de deux
 * puces brutes. Le reproche de l'utilisateur était exact : « il me lâche juste
 * deux infos », « ça n'explique rien ». Deux phrases sorties d'un PDF et
 * empilées ne sont pas une réponse, même quand elles sont justes.
 *
 * Les faits sont donc RANGÉS PAR NATURE DE SAVOIR, dans l'ordre où un
 * enseignant les donne — ce que c'est, quels types, de quoi c'est fait, à quoi
 * ça sert, où ça se trouve — chaque groupe sous son intertitre.
 *
 * ── CE QUE ÇA N'EST PAS ────────────────────────────────────────────────────
 * Organiser n'est pas expliquer. Pas une phrase ci-dessous n'est reformulée :
 * la charpente (intertitres, ordre, puces) est ajoutée, le CONTENU reste mot
 * pour mot celui du cours. Reformuler, adapter le niveau, répondre à une
 * question absente du cours : ça demande un modèle de langue, c'est le bouton
 * « Répondre avec l'IA ».
 */

/** Intertitres, dans l'ordre pédagogique — pas dans l'ordre du document. */
const SECTIONS: { predicate: FactPredicate; heading: string }[] = [
  { predicate: 'definition', heading: 'Définition' },
  { predicate: 'classification', heading: 'Les différents types' },
  { predicate: 'composition', heading: 'De quoi c’est constitué' },
  { predicate: 'possession', heading: 'Ce que ça comporte' },
  { predicate: 'function', heading: 'À quoi ça sert' },
  { predicate: 'location', heading: 'Où ça se situe' },
];

/** Majuscule initiale, sans toucher au reste de l'extrait. */
function capitalize(text: string): string {
  return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/**
 * Une énumération du cours devient une vraie liste — mais SANS se répéter.
 *
 * Naïvement, on affiche la phrase entière puis ses éléments en sous-puces :
 * le lecteur lit alors deux fois la même chose. On coupe donc AU DEUX-POINTS —
 * un séparateur déjà présent dans le texte, pas une décision de sens :
 * l'annonce reste la puce, les éléments deviennent ses sous-puces. Sans
 * deux-points, la phrase est rendue entière, sans sous-liste redondante.
 */
function renderFact(fact: RawFact): string[] {
  const excerpt = fact.sourceExcerpt.trim();
  const items = fact.items ?? [];
  if (items.length < 2) return [`- ${excerpt}`];

  /*
    DEUX FORMES DE LISTE, DEUX DÉCOUPAGES.

    Depuis qu'un fait peut emporter une liste écrite SUR PLUSIEURS LIGNES, le
    seul découpage au deux-points ne suffit plus : quand le deux-points tombe
    en fin de dernière ligne, il ne sépare plus rien, et l'extrait repartait
    brut — puces du document comprises, « • » et « § » en plein milieu d'une
    réponse.

    On regarde donc d'abord si les éléments SONT les dernières lignes de
    l'extrait. Si oui, l'annonce est simplement tout ce qui les précède.
  */
  const lines = excerpt
    .split('\n')
    .map((line) => stripBulletPrefix(line).trim())
    .filter(Boolean);
  const listed = new Set(items);
  const lead = lines.filter((line) => !listed.has(line));

  if (lead.length > 0 && lead.length < lines.length) {
    return [...lead.map((line) => `- ${line}`), ...items.map((item) => `  - ${capitalize(item)}`)];
  }

  /*
    Sinon la liste est INLINE (« X : a, b et c »), et c'est le deux-points qui
    sépare l'annonce de ses éléments. Sans cette coupe, le lecteur lit la
    phrase entière puis relit chaque élément juste en dessous.
  */
  /*
    Le deux-points de tête, et lui seul : « Les nerfs palatins (x 3 :
    antérieur, moyen postérieur) : » en contient DEUX, dont le premier est une
    précision entre parenthèses. Couper dessus ouvrait une parenthèse dans le
    titre et la refermait dans le dernier élément (voir `topLevelColonIndex`).
  */
  const colon = topLevelColonIndex(excerpt);
  if (colon > 0) {
    const announcement = excerpt.slice(0, colon + 1).trim();
    const after = excerpt.slice(colon + 1);
    const inside = items.filter((item) => after.includes(item));
    if (inside.length >= 2) {
      return [`- ${announcement}`, ...inside.map((item) => `  - ${capitalize(item)}`)];
    }
  }
  return [`- ${excerpt}`];
}

/**
 * SUJET AFFICHÉ EN TÊTE DE RÉPONSE.
 *
 * Il était pris tel quel sur le fait le mieux classé. Sur un vrai cours, une
 * ligne repliée par le PDF donne parfois un sujet tronqué : « inconstante : le
 * nerf est donc en contact direct avec le sinus maxillaire » produisait le
 * sujet « le nerf », et la réponse à « nerf maxillaire » s'ouvrait sur
 * « **le nerf** — voici ce que ton cours en dit ». Le titre n'annonce alors
 * plus rien.
 *
 * Un sujet n'est retenu que s'il contient TOUS les termes distinctifs de la
 * question — c'est la définition même d'un sujet de réponse. À défaut, on ne
 * bricole pas un titre : on reprend les mots de la question, ce qui est exact
 * et n'affirme rien de plus que « voilà ce que ton cours en dit ».
 */
/**
 * Un titre NOMME quelque chose ; une phrase en DIT quelque chose.
 *
 * Sur le vrai cours, la réponse à « quelles sont les branches du nerf
 * maxillaire ? » s'ouvrait sur :
 *
 *     **Donc ce dernier est la branche terminale du nerf maxillaire.**
 *
 * Le sujet extrait était une phrase entière — exacte, tirée du cours, et
 * inutilisable comme titre : un titre qui affirme déjà quelque chose ne
 * présente plus rien.
 *
 * Deux signes suffisent à distinguer les deux, sans rien comprendre au texte.
 * Une phrase se termine par une ponctuation qui la clôt ; un groupe nominal
 * jamais. Et un groupe nominal reste court : passé une dizaine de mots, ce
 * n'est plus un nom, c'est un propos.
 */
const MAX_SUBJECT_WORDS = 10;

function namesSomething(subject: string): boolean {
  const trimmed = subject.trim();
  if (/[.!?]$/.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= MAX_SUBJECT_WORDS;
}

function headingSubject(
  facts: readonly RawFact[],
  required: ReadonlySet<string>,
  questionTerms: ReadonlySet<string>,
  fallback: string,
): string {
  for (const fact of facts) {
    if (!namesSomething(fact.subject)) continue;

    const words = significantWords(fact.subject);

    // Tous les termes distinctifs, sinon ce n'est pas le sujet de la réponse.
    if (![...required].every((term) => words.has(term))) continue;

    /*
      Et il doit ressembler à un vrai groupe nominal. Les termes distinctifs
      seuls ne suffisent pas : « nerf » est trop fréquent dans un cours
      d'anatomie pour être distinctif, si bien qu'un fragment comme
      « maxillaires » les contenait tous et devenait le titre de la réponse à
      « nerf maxillaire ». On exige donc en plus, soit tous les mots de la
      question, soit au moins deux mots porteurs — de quoi nommer quelque
      chose plutôt que d'en montrer un morceau.
    */
    const complete = [...questionTerms].every((term) => words.has(term));
    if (complete || words.size >= 2) return fact.subject;
  }
  return fallback;
}

/** Mêmes intertitres, celui qu'appelle la question en tête. */
function orderedSections(asked: ReadQuestion | null): typeof SECTIONS {
  if (!asked) return SECTIONS;
  const lead = SECTIONS.filter((section) => section.predicate === asked.leads);
  return lead.length === 0 ? SECTIONS : [...lead, ...SECTIONS.filter((s) => !lead.includes(s))];
}

function composeAnswer(subject: string, facts: RawFact[], asked: ReadQuestion | null): string {
  /*
    Un seul fait : la phrase se suffit, l'habiller de trois intertitres
    donnerait un plan de cours pour une ligne.

    Sauf s'il PORTE UNE LISTE. Depuis qu'un fait peut emporter les éléments
    qui l'annoncent, rendre son extrait brut recrachait les puces du document
    telles quelles — « • Chaque branche … : » suivi de trois « § ». La mise en
    forme de liste s'applique donc aussi au fait unique.
  */
  if (facts.length === 1) {
    const only = facts[0]!;
    return only.items && only.items.length >= 2
      ? renderFact(only).join('\n')
      : only.sourceExcerpt;
  }

  const lines: string[] = [`**${subject}** — voici ce que ton cours en dit.`, ''];

  const used = new Set<RawFact>();
  for (const section of orderedSections(asked)) {
    const group = facts.filter((fact) => fact.predicate === section.predicate);
    if (group.length === 0) continue;
    lines.push(`### ${section.heading}`);
    for (const fact of group) {
      lines.push(...renderFact(fact));
      used.add(fact);
    }
    lines.push('');
  }

  // Filet : si un prédicat futur n'a pas d'intertitre, son fait est quand même
  // rendu plutôt que silencieusement perdu.
  const orphans = facts.filter((fact) => !used.has(fact));
  if (orphans.length > 0) {
    lines.push('### Autres éléments du cours');
    for (const fact of orphans) lines.push(...renderFact(fact));
    lines.push('');
  }

  /*
   * « À retenir » n'apparaît que s'il y a réellement quelque chose de
   * mémorisable et CHIFFRÉ dans le cours — un décompte explicite. C'est la
   * SEULE ligne recomposée de toute la réponse, et elle l'est à partir de
   * fragments eux-mêmes verbatim : le sujet du fait, et le décompte relevé
   * dans le texte. Une contraction, jamais une paraphrase.
   */
  const counted = facts.filter((fact) => fact.countWord && fact.countNoun);
  if (counted.length > 0) {
    const retain = ['### À retenir'];
    for (const fact of counted) {
      retain.push(`- ${capitalize(fact.subject)} : **${fact.countWord} ${fact.countNoun}**.`);
    }
    retain.push('');
    /*
      « Combien de branches a le nerf trijumeau ? » attend un nombre. Le lui
      faire chercher au bas d'une fiche de six rubriques, c'est ne pas
      répondre : quand la question EST un décompte, le décompte passe en tête,
      juste après le titre.
    */
    if (asked?.intent === 'count') lines.splice(2, 0, ...retain);
    else lines.push(...retain);
  }

  return lines.join('\n').trimEnd();
}

/*
 * Trois sections au plus. Le moteur en trouvait jusqu'à huit : la réponse à
 * « nerf frontal » commençait alors par la section « nerf ophtalmique », où le
 * mot n'apparaît qu'en passant dans une énumération, et la vraie section
 * arrivait en quatrième position. Une réponse juste mais noyée n'est pas une
 * réponse.
 */
const MAX_SECTIONS = 3;
/**
 * En dessous, une section titrée n'a pas assez de matière pour tenir lieu de
 * réponse à elle seule : les faits reprennent la main.
 */
const MIN_TITLED_LINES = 3;
const MAX_LINES_PER_SECTION = 24;
/** Au-delà, ce n'est plus une réponse ciblée mais un survol de la section. */
const MAX_ANCHORS = 3;

/**
 * Sections du cours qui portent sur la question, titre compris, les plus
 * pertinentes d'abord.
 *
 * Le rattachement au titre est ce qui distingue une réponse utile d'une
 * collection de phrases orphelines : « Il entre dans l'orbite par la fissure
 * orbitaire supérieure » ne veut rien dire seul ; sous « Nerf frontal », c'en
 * est la description.
 *
 * Le CLASSEMENT compte autant que la sélection. Une section dont le TITRE
 * porte les termes de la question traite du sujet ; une section qui ne les
 * mentionne que dans une puce parle d'autre chose et ne fait que citer le
 * terme au passage.
 */
function relevantPassages(required: Set<string>, scoredChunks: readonly ScoredChunk[]): {
  passages: string[];
  chunkIds: string[];
  /**
   * Vrai quand une section porte les termes de la question DANS SON TITRE :
   * c'est la section que le cours consacre au sujet, et elle doit passer
   * devant un fait isolé (voir `findLocalAnswer`).
   */
  titled: boolean;
} {
  /*
    TOUTES les sections sont d'abord relevées, dans l'ordre du document —
    y compris celles qui ne portent pas les termes de la question.

    C'est ce qui permet de rendre une section AVEC SA SUITE. Un cours ne
    répète pas son sujet à chaque intertitre : sous « Nerf lacrymal », la
    suite s'intitule « Ce nerf reçoit une anastomose… » et ne contient plus le
    mot « lacrymal ». Filtrer d'abord, c'était couper la réponse au bout de
    trois lignes — mesuré sur le vrai cours, la réponse sur le nerf lacrymal
    tenait en UNE ligne alors que le document lui consacre une page.
  */
  interface Section {
    rendered: string;
    chunkId: string;
    order: number;
    /** Nombre de termes de la question portés par le TITRE. */
    inHeading: number;
    /** La section porte-t-elle tous les termes exigés, titre et corps confondus ? */
    onTopic: boolean;
    /** Une section sans titre est la SUITE de la précédente, pas un sujet nouveau. */
    hasHeading: boolean;
  }

    /*
    LES LIGNES QUI RÉPONDENT, PAS LES PREMIÈRES DE LA SECTION.

    ── Le défaut, mesuré sur le vrai cours ─────────────────────────────────
    « Qu'est-ce que le nerf infra-orbitaire ? » renvoyait :

        - Le nerf alvéolaire supérieur moyen peut exister.
        - PS : dans la partie interne de la fosse orbitaire…
        - 4 muscles droits :
        - Droit supérieur …

    La bonne ligne — « Il donne le nerf infra-orbitaire qui innerve la
    paupière inférieure… » — était pourtant dans le cours, et dans LA MÊME
    section. Une section était retenue parce que les termes s'y trouvaient
    QUELQUE PART, puis rendue par ses PREMIÈRES lignes. Les deux ne sont pas
    le même ensemble, et un polycopié met rarement la réponse en tête de
    section : un titre annonce une liste, et la réponse est la sixième puce.

    Renvoyer des lignes sans rapport est pire que s'abstenir : l'étudiant
    croit avoir la réponse de son cours, et il a autre chose.

    ── Ce qui est rendu maintenant ─────────────────────────────────────────
    La ligne qui porte les termes, avec ce qui la rend lisible :
     - sa LIGNE MÈRE quand elle est une puce d'une énumération annoncée
       (« se divise en 3 branches : » au-dessus de « Nerf frontal ») ;
     - ses ENFANTS, c'est-à-dire les puces plus profondes qui la suivent —
       c'est la liste qu'elle annonce.

    La profondeur vient du MARQUEUR de puce (voir `bulletDepth`), le seul
    indice de hiérarchie qui survive à l'extraction PDF.
  */
  function anchoredLines(lines: readonly string[], want: ReadonlySet<string>): string[] | null {
    const words = lines.map((line) => significantWords(stripBulletPrefix(line)));
    const hits = lines.map((_, i) => [...want].filter((term) => words[i]!.has(term)).length);
    const best = Math.max(0, ...hits);
    if (best === 0) return null;

    const depths = lines.map((line) => bulletDepth(line) ?? 0);
    const keep = new Set<number>();
    let anchors = 0;

    for (let i = 0; i < lines.length && anchors < MAX_ANCHORS; i += 1) {
      if (hits[i]! < best) continue;
      anchors += 1;
      keep.add(i);

      // La mère : la ligne précédente la plus proche, moins profonde.
      for (let up = i - 1; up >= 0; up -= 1) {
        if (depths[up]! < depths[i]!) {
          keep.add(up);
          break;
        }
      }
      // Les enfants : les puces plus profondes qui suivent sans interruption.
      for (let down = i + 1; down < lines.length && depths[down]! > depths[i]!; down += 1) {
        keep.add(down);
        if (keep.size >= MAX_LINES_PER_SECTION) break;
      }
    }

    return [...keep]
      .sort((a, b) => a - b)
      .slice(0, MAX_LINES_PER_SECTION)
      .map((i) => stripBulletPrefix(lines[i]!).trim())
      .filter(Boolean);
  }


  /*
    UNE SECTION TITRÉE S'ARRÊTE AU SUJET SUIVANT.

    Un polycopié n'intitule pas tout : « Le nerf maxillaire est un nerf
    sensitif. » est une phrase ordinaire, pas un titre, donc le découpage en
    sections la range sous le titre précédent. Résultat mesuré : la réponse
    sur le nerf OPHTALMIQUE enchaînait sur le maxillaire puis le mandibulaire,
    comme si le cours en parlait au même endroit.

    Dans une section, le contenu est à puces. Une ligne NUE qui revient plus
    bas ouvre autre chose — c'est la même hiérarchie de marqueurs que le plan
    du résumé. On coupe là.
  */
  function ownBody(lines: readonly string[]): string[] {
    const kept: string[] = [];
    for (const [index, line] of lines.entries()) {
      if (index > 0 && bulletDepth(line) === null) break;
      const text = stripBulletPrefix(line).trim();
      if (text.length > 0) kept.push(text);
    }
    return kept;
  }

  const sections: Section[] = [];
  const seen = new Set<string>();
  let order = 0;

  for (const { chunk } of scoredChunks) {
    for (const section of courseSections(chunk.text)) {
      order += 1;
      const body = section.lines.map((line) => stripBulletPrefix(line).trim()).filter(Boolean);
      const whole = [section.heading ?? '', ...body].join(' ');

      const key = whole.slice(0, 160).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const words = significantWords(whole);
      const headingTerms = section.heading ? significantWords(section.heading) : new Set<string>();
      const inHeading = [...required].filter((term) => headingTerms.has(term)).length;

      /*
        Quand le TITRE porte déjà tout le sujet, la section entière lui est
        consacrée et se lit depuis le début — c'est le cas « Le nerf
        ophtalmique de Willis ». Sinon, on va chercher les lignes qui
        répondent, où qu'elles soient dans la section.
      */
      const shownBody =
        inHeading === required.size && required.size > 0
          ? ownBody(section.lines).slice(0, MAX_LINES_PER_SECTION)
          : (anchoredLines(section.lines, required) ?? body.slice(0, MAX_LINES_PER_SECTION));

      /*
        LE TITRE N'EST AFFICHÉ QUE S'IL PARLE DU SUJET.

        « Quel ganglion est sur le trajet du nerf maxillaire ? » rendait les
        trois bonnes lignes… sous le titre « Le nerf ophtalmique de Willis »,
        parce que c'est la section où elles se trouvent. Le titre disait donc
        le contraire de la réponse. Quand la section est retenue par SES
        LIGNES et non par son titre, la ligne mère incluse ci-dessus fait
        déjà office d'introduction — elle, au moins, est la bonne.
      */
      const rendered =
        section.heading && inHeading > 0
          ? [`**${section.heading}**`, ...shownBody.map((line) => `  - ${line}`)]
          : shownBody.map((line) => `- ${line}`);
      if (rendered.length === 0) continue;

      sections.push({
        rendered: rendered.join('\n'),
        chunkId: chunk.id,
        order,
        inHeading,
        hasHeading: section.heading !== null && section.heading !== undefined,
        /*
          « SUR LE SUJET » VEUT DIRE QU'UNE LIGNE LE DIT, pas que les mots
          traînent dans la section. Une section qui contient « infra » dans sa
          trentième puce et « nerf » dans sa première ne parle pas du nerf
          infra-orbitaire : elle passait pourtant le test, et c'est elle qu'on
          affichait.
        */
        onTopic:
          [...required].every((term) => words.has(term)) &&
          (inHeading === required.size || anchoredLines(section.lines, required) !== null),
      });
    }
  }

  /*
    UNE SECTION QUI S'INTITULE DU SUJET EST *LA* RÉPONSE — elle et sa suite.

    Deux erreurs opposées, toutes deux mesurées sur le cours du trijumeau :

     - garder les trois sections les mieux classées donnait, sur « par où
       passe le nerf ophtalmique ? », la bonne section suivie de vingt lignes
       voisines dont aucune ne parlait du trajet demandé ;
     - ne garder QUE la section titrée coupait « le nerf frontal » au bout de
       trois lignes, alors que le cours poursuit juste en dessous avec ses
       deux branches et leurs trois catégories.

    Un cours se lit dans son ORDRE : on prend la section titrée et ce qui la
    suit immédiatement, dans le même document.
  */
  const leads = sections.filter((section) => section.onTopic && section.inHeading === required.size);

  /*
    LA LECTURE S'ARRÊTE AU TITRE SUIVANT QUI PARLE D'AUTRE CHOSE.

    Prendre la section titrée « et ce qui la suit » rattrapait bien les
    suites sans titre — mais collait aussi la section d'à côté quand elle en
    avait un. Mesuré : « Explique-moi le nerf ophtalmique de Willis »
    répondait juste, puis enchaînait sur « Les nerfs palatins », qui n'a rien
    à y faire. Une section SANS titre est une suite ; une section AVEC un
    titre qui ne partage aucun terme avec le sujet est un autre chapitre.
  */
  const continues = (section: Section, lead: Section): boolean =>
    section.order === lead.order || section.inHeading > 0 || !section.hasHeading;

  const kept =
    leads.length > 0
      ? sections
          .filter((section) =>
            leads.some(
              (lead) =>
                section.chunkId === lead.chunkId &&
                section.order >= lead.order &&
                section.order < lead.order + MAX_SECTIONS &&
                continues(section, lead) &&
                // …et pas au-delà d'une rupture : dès qu'un titre étranger
                // s'intercale, la suite ne se rattache plus au sujet.
                sections
                  .filter((between) => between.chunkId === lead.chunkId && between.order > lead.order && between.order < section.order)
                  .every((between) => continues(between, lead)),
            ),
          )
          .sort((a, b) => a.order - b.order)
          .slice(0, MAX_SECTIONS)
      : sections
          .filter((section) => section.onTopic)
          .sort((a, b) => b.inHeading - a.inHeading || a.order - b.order)
          .slice(0, MAX_SECTIONS);

  /*
    « Titrée » ne suffit pas : encore faut-il que la section DISE quelque
    chose. Celle du nerf lacrymal tient en une ligne — le cours enchaîne
    ensuite dans un autre fragment. Lui laisser la priorité sur les faits
    revenait à répondre en une phrase là où le moteur en avait dix.
  */
  const bodyLines = kept.reduce((total, section) => total + section.rendered.split('\n').length, 0);

  /*
    JAMAIS DEUX FOIS LA MÊME LIGNE.

    « Où se situe la fossette trochléaire ? » la donnait deux fois : une fois
    seule, une fois sous le titre de la section qui la contient. Une réponse
    qui se répète se lit comme une réponse qui bafouille.
  */
  const shown = new Set<string>();
  const deduped = kept.map((section) => ({
    ...section,
    rendered: section.rendered
      .split('\n')
      .filter((line) => {
        const key = line.replace(/^[\s*-]+/, '').trim().toLowerCase();
        if (key.length === 0 || shown.has(key)) return false;
        shown.add(key);
        return true;
      })
      .join('\n'),
  })).filter((section) => section.rendered.trim().length > 0);

  return {
    passages: deduped.map((section) => section.rendered),
    chunkIds: deduped.map((section) => section.chunkId),
    titled: leads.length > 0 && bodyLines >= MIN_TITLED_LINES,
  };
}

/**
 * Tente de répondre localement à `question`, à partir des fragments déjà
 * retrouvés par BM25 (`scoredChunks`, réutilisés tels quels — aucune nouvelle
 * recherche).
 *
 * Deux étages, dans cet ordre :
 *  1. les FAITS reconnus par les règles, rangés par nature de savoir — c'est
 *     la réponse la mieux structurée, quand le cours s'y prête ;
 *  2. à défaut, les PASSAGES du cours qui portent sur le sujet.
 *
 * `null` seulement si le cours ne parle vraiment pas de ce qui est demandé :
 * l'appelant affiche alors un message honnête et propose l'IA en option, il ne
 * comble jamais le vide.
 */
export function findLocalAnswer(
  question: string,
  scoredChunks: readonly ScoredChunk[],
  lookup: ContextLookup,
): LocalAnswer | null {
  /*
    LA FORME DE LA QUESTION D'ABORD, SON SUJET ENSUITE.

    « Où se situe le nerf lacrymal ? » laissait trois termes — « situe »,
    « nerf », « lacrymal » — et le moteur les exigeait tous les trois. Sur le
    vrai cours, la seule section à porter « nerf » et « situé » ensemble parle
    du nerf OPHTALMIQUE, où le mot tombe dans une parenthèse de passage : la
    réponse partait sur un autre nerf que celui demandé.

    « Situe » ne nomme pas un sujet, il pose une question. Il est donc retiré
    des termes exigés — sans jamais être retiré du COURS, où il garde tout son
    sens là où il est écrit.
  */
  const asked = readQuestion(question);
  const rawTerms = significantWords(question, true);
  const questionTerms = asked
    ? new Set([...rawTerms].filter((term) => !asked.markers.has(term)))
    : rawTerms;
  // Filet : une question qui ne serait FAITE que de mots de forme (« c'est
  // situé où ? ») garde ses termes d'origine plutôt que de n'en avoir aucun.
  const terms = questionTerms.size > 0 ? questionTerms : rawTerms;
  if (terms.size === 0) return null;

  /*
    LA COMPARAISON SE TRAITE AVANT LA RÉSOLUTION DES TERMES.

    `distinctiveTerms` suppose UN seul sujet : elle rend `null` — et le moteur
    s'abstient — dès qu'un mot de la question manque au cours. Sur « la
    différence entre A et B », c'est la garantie de ne jamais répondre dès que
    B n'y est pas, sans même regarder ce que le cours dit de A.

    Une comparaison se construit à partir de deux recherches SÉPARÉES, chacune
    sur son propre sujet. Elle est donc tentée d'abord, et le chemin ordinaire
    reprend la main si elle n'aboutit pas.
  */
  /*
    UNE COMPARAISON SE RÉPOND EN DEUX COLONNES, pas en une.

    « Quelle est la différence entre le nerf maxillaire et le nerf
    mandibulaire ? » était la seule des douze questions mesurées sur le vrai
    cours à rester sans réponse — alors que le document définit les deux :
    « … est un nerf sensitif », « … est un nerf mixte, sensitif et moteur ».

    Le moteur exigeait que TOUS les termes se trouvent ensemble : il cherchait
    une ligne parlant des deux nerfs à la fois, qui n'existe pas et n'a pas à
    exister. Une comparaison se construit à partir de deux réponses séparées.

    RIEN N'EST CONCLU À LA PLACE DE L'ÉTUDIANT. Le moteur ne dit pas « la
    différence est que… » — il ne sait pas comparer, et l'affirmer serait
    inventer. Il met côte à côte ce que le cours dit de chacun, ce qui est
    précisément ce qu'on cherche en posant la question.
  */
  if (asked?.intent === 'comparison' && asked.compared) {
    const sides = asked.compared.map((subject) => ({
      subject,
      answer: findLocalAnswer(subject, scoredChunks, lookup),
    }));
    // Les deux côtés doivent répondre : une comparaison à moitié documentée
    // induit en erreur plus qu'elle n'aide.
    if (sides.every((side) => side.answer !== null)) {
      return {
        text: [
          `**${asked.compared[0]}** et **${asked.compared[1]}** — ce que ton cours dit de chacun.`,
          '',
          ...sides.flatMap(({ subject, answer }) => [`### ${capitalize(subject)}`, answer!.text, '']),
          '_Ton cours ne compare pas ces deux notions explicitement : les voici côte à côte, telles qu’il les décrit. La comparaison, c’est à toi de la faire — ou demande-la à l’IA._',
        ].join('\n'),
        citations: sides.flatMap(({ answer }) => answer!.citations),
      };
    }
  }

  const chunkTermSets = scoredChunks.map(({ chunk }) => significantWords(chunk.text));
  const required = distinctiveTerms(terms, chunkTermSets);
  if (required === null) return null;

  const chunkById = new Map(scoredChunks.map(({ chunk }) => [chunk.id, chunk]));


  /*
    LA SECTION QUI PORTE LE TITRE DEMANDÉ PASSE AVANT TOUT.

    Les faits étaient toujours essayés en premier. Depuis qu'ils emportent
    leurs listes, ils réussissent bien plus souvent — et un fait isolé se
    mettait à couper l'herbe sous le pied de la section entière. Mesuré :
    « le nerf frontal » ne renvoyait plus que les trois catégories de branches
    du nerf supra-orbitaire, là où le cours consacre au nerf frontal une
    section complète — son entrée dans l'orbite, son trajet, ses deux
    branches, puis ces catégories.

    Quand une section du cours S'INTITULE du sujet demandé, c'est la meilleure
    réponse possible : elle est écrite pour ça. Le passage par les faits
    reprend la main dès que ce n'est pas le cas.
  */
  const sections = relevantPassages(required, scoredChunks);
  if (sections.titled) return passageAnswer(sections, terms, chunkById, lookup);

  // ── Étage 1 : les faits reconnus ──
  const matches: { fact: RawFact; chunkId: string; score: number; order: number }[] = [];
  let order = 0;
  for (const { chunk } of scoredChunks) {
    for (const fact of extractFacts(chunk)) {
      order += 1;
      if (fact.confidence === 'low') continue;

      const factTerms = significantWords(`${fact.subject} ${fact.sourceExcerpt}`);
      if ([...required].some((term) => !factTerms.has(term))) continue;

      const score = subjectOverlap(terms, significantWords(fact.subject));
      if (score < SUBJECT_OVERLAP_FLOOR) continue;

      matches.push({ fact, chunkId: chunk.id, score, order });
    }
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      predicateRank(a.fact.predicate, asked) - predicateRank(b.fact.predicate, asked) ||
      a.order - b.order,
  );

  /*
    LA MÊME PHRASE NE PARAÎT PAS DEUX FOIS SOUS DEUX INTERTITRES.

    « Le nerf mandibulaire est-il sensitif ou moteur ? » donnait :

        ### Définition
        - Le nerf mandibulaire est un nerf mixte, sensitif et moteur.
        ### De quoi c'est constitué
        - Le nerf mandibulaire est un nerf mixte, sensitif et moteur.
          - Il sort du crâne par le foramen ovale. …

    Deux faits, deux prédicats — mais la MÊME phrase d'ouverture, l'un nu et
    l'autre portant sa liste. Le dédoublonnage ne comparait que les extraits
    entiers, qui diffèrent justement par cette liste. On compare donc la
    PREMIÈRE LIGNE, et on garde la version la plus complète : celle qui dit
    tout ce que dit l'autre, et davantage.
  */
  const firstLine = (fact: RawFact): string =>
    stripBulletPrefix(fact.sourceExcerpt.trim().split('\n')[0] ?? '')
      .trim()
      .toLowerCase();

  const richest = new Map<string, { fact: RawFact; chunkId: string }>();
  const ordered: string[] = [];
  for (const { fact, chunkId } of matches) {
    const key = firstLine(fact);
    if (key.length === 0) continue;
    const previous = richest.get(key);
    if (!previous) {
      richest.set(key, { fact, chunkId });
      ordered.push(key);
    } else if (fact.sourceExcerpt.length > previous.fact.sourceExcerpt.length) {
      // Même ouverture, extrait plus long : c'est la version qui porte la liste.
      richest.set(key, { fact, chunkId });
    }
  }

  const kept: RawFact[] = [];
  const citations: Citation[] = [];
  for (const key of ordered) {
    const { fact, chunkId } = richest.get(key)!;
    const chunk = chunkById.get(chunkId);
    if (!chunk) continue;
    kept.push(fact);
    citations.push(citationFromChunk(chunk, lookup, fact.sourceExcerpt));
    if (kept.length >= MAX_FACTS_IN_ANSWER) break;
  }

  if (kept.length > 0) {
    const subject = headingSubject(kept, required, terms, [...terms].join(' '));
    return { text: composeAnswer(subject, kept, asked), citations };
  }

  // ── Étage 2 : à défaut de fait reconnu, ce que le cours dit du sujet ──
  return passageAnswer(sections, terms, chunkById, lookup);
}

/**
 * Rendu commun aux deux usages des passages : quand une section porte le titre
 * demandé (avant les faits), et quand aucun fait n'a répondu (après eux).
 */
function passageAnswer(
  sections: { passages: string[]; chunkIds: string[] },
  _terms: ReadonlySet<string>,
  chunkById: Map<string, ScoredChunk['chunk']>,
  lookup: ContextLookup,
): LocalAnswer | null {
  if (sections.passages.length === 0) return null;

  const text = [
    ...sections.passages,
  ].join('\n');

  const citations: Citation[] = [];
  const seen = new Set<string>();
  sections.chunkIds.forEach((chunkId, index) => {
    if (seen.has(chunkId)) return;
    seen.add(chunkId);
    const chunk = chunkById.get(chunkId);
    if (chunk) citations.push(citationFromChunk(chunk, lookup, sections.passages[index]!));
  });

  return { text, citations };
}
