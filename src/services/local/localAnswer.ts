import { extractFacts, type FactPredicate, type RawFact } from './relationExtraction';
import { citationFromChunk } from './citation';
import { stripBulletPrefix } from './textStructure';
import { courseSections } from './courseLayout';
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

const PREDICATE_PRIORITY: Record<FactPredicate, number> = {
  definition: 0,
  classification: 1,
  composition: 1,
  possession: 1,
  function: 2,
  location: 2,
};

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
  const colon = excerpt.indexOf(':');

  if (fact.items && fact.items.length >= 2 && colon > 0) {
    const lead = excerpt.slice(0, colon + 1).trim();
    return [`- ${lead}`, ...fact.items.map((item) => `  - ${capitalize(item)}`)];
  }
  return [`- ${excerpt}`];
}

function composeAnswer(subject: string, facts: RawFact[]): string {
  // Un seul fait : la phrase se suffit, l'habiller de trois intertitres
  // donnerait un plan de cours pour une ligne.
  if (facts.length === 1) return facts[0]!.sourceExcerpt;

  const lines: string[] = [`**${subject}** — voici ce que ton cours en dit.`, ''];

  const used = new Set<RawFact>();
  for (const section of SECTIONS) {
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
    lines.push('### À retenir');
    for (const fact of counted) {
      lines.push(`- ${capitalize(fact.subject)} : **${fact.countWord} ${fact.countNoun}**.`);
    }
    lines.push('');
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
const MAX_LINES_PER_SECTION = 8;

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
} {
  const found: { rendered: string; chunkId: string; score: number }[] = [];
  const seen = new Set<string>();

  for (const { chunk } of scoredChunks) {
    for (const section of courseSections(chunk.text)) {
      const body = section.lines.map((line) => stripBulletPrefix(line).trim()).filter(Boolean);
      const whole = [section.heading ?? '', ...body].join(' ');

      // La section doit porter TOUS les termes distinctifs : une section qui ne
      // contient que « nerf » dans un cours de neuro-anatomie ne traite pas
      // spécifiquement de ce qui est demandé.
      if ([...required].some((term) => !significantWords(whole).has(term))) continue;

      const key = whole.slice(0, 160).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const headingTerms = section.heading ? significantWords(section.heading) : new Set<string>();
      const inHeading = [...required].filter((term) => headingTerms.has(term)).length;
      // Titre entièrement concordant : c'est LA section du sujet.
      const score = inHeading === required.size ? 100 + inHeading : inHeading;

      const rendered = section.heading
        ? [`**${section.heading}**`, ...body.slice(0, MAX_LINES_PER_SECTION).map((line) => `  - ${line}`)]
        : body.slice(0, MAX_LINES_PER_SECTION).map((line) => `- ${line}`);
      if (rendered.length === 0) continue;

      found.push({ rendered: rendered.join('\n'), chunkId: chunk.id, score });
    }
  }

  found.sort((a, b) => b.score - a.score);
  const kept = found.slice(0, MAX_SECTIONS);
  return { passages: kept.map((entry) => entry.rendered), chunkIds: kept.map((entry) => entry.chunkId) };
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
  const questionTerms = significantWords(question, true);
  if (questionTerms.size === 0) return null;

  const chunkTermSets = scoredChunks.map(({ chunk }) => significantWords(chunk.text));
  const required = distinctiveTerms(questionTerms, chunkTermSets);
  if (required === null) return null;

  const chunkById = new Map(scoredChunks.map(({ chunk }) => [chunk.id, chunk]));

  // ── Étage 1 : les faits reconnus ──
  const matches: { fact: RawFact; chunkId: string; score: number; order: number }[] = [];
  let order = 0;
  for (const { chunk } of scoredChunks) {
    for (const fact of extractFacts(chunk)) {
      order += 1;
      if (fact.confidence === 'low') continue;

      const factTerms = significantWords(`${fact.subject} ${fact.sourceExcerpt}`);
      if ([...required].some((term) => !factTerms.has(term))) continue;

      const score = subjectOverlap(questionTerms, significantWords(fact.subject));
      if (score < SUBJECT_OVERLAP_FLOOR) continue;

      matches.push({ fact, chunkId: chunk.id, score, order });
    }
  }

  matches.sort(
    (a, b) =>
      b.score - a.score || PREDICATE_PRIORITY[a.fact.predicate] - PREDICATE_PRIORITY[b.fact.predicate] || a.order - b.order,
  );

  const seenExcerpts = new Set<string>();
  const kept: RawFact[] = [];
  const citations: Citation[] = [];

  for (const { fact, chunkId } of matches) {
    const key = fact.sourceExcerpt.trim().toLowerCase();
    if (seenExcerpts.has(key)) continue;
    seenExcerpts.add(key);

    const chunk = chunkById.get(chunkId);
    if (!chunk) continue;

    kept.push(fact);
    citations.push(citationFromChunk(chunk, lookup, fact.sourceExcerpt));
    if (kept.length >= MAX_FACTS_IN_ANSWER) break;
  }

  if (kept.length > 0) {
    return { text: composeAnswer(kept[0]!.subject, kept), citations };
  }

  // ── Étage 2 : à défaut de fait reconnu, ce que le cours dit du sujet ──
  const { passages, chunkIds } = relevantPassages(required, scoredChunks);
  if (passages.length === 0) return null;

  const label = [...questionTerms].join(' ');
  const text = [
    `Voici ce que ton cours dit à propos de **${label}** :`,
    '',
    ...passages.map((passage) => passage),
    '',
    '_Ces lignes viennent telles quelles de ton document. Le moteur local les retrouve et les regroupe ; il ne les reformule pas._',
  ].join('\n');

  const passageCitations: Citation[] = [];
  const seenChunks = new Set<string>();
  chunkIds.forEach((chunkId, index) => {
    if (seenChunks.has(chunkId)) return;
    seenChunks.add(chunkId);
    const chunk = chunkById.get(chunkId);
    if (chunk) passageCitations.push(citationFromChunk(chunk, lookup, passages[index]!));
  });

  return { text, citations: passageCitations };
}
