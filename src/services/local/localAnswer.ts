import { extractFacts, type FactPredicate, type RawFact } from './relationExtraction';
import { citationFromChunk } from './citation';
import { significantWords } from '@/core/text';
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
 * Renvoie `null` quand un terme de la question n'apparaît NULLE PART dans le
 * cours retrouvé : le cours ne parle pas de ce qui est demandé, et répondre
 * avec le reste reviendrait à répondre à une autre question. C'est le cas
 * « nerfs de Willis » quand aucun cours ne mentionne Willis.
 */
function distinctiveTerms(questionTerms: Set<string>, chunkTermSets: Set<string>[]): Set<string> | null {
  let lowestFrequency = Number.POSITIVE_INFINITY;
  const frequencies = new Map<string, number>();

  for (const term of questionTerms) {
    const frequency = chunkTermSets.filter((terms) => terms.has(term)).length;
    if (frequency === 0) return null;
    frequencies.set(term, frequency);
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
 * Ce qui change ici : les faits ne sont plus classés par score puis coupés à
 * quatre. Ils sont RANGÉS PAR NATURE DE SAVOIR, dans l'ordre où un enseignant
 * les donne — ce que c'est, quels types, de quoi c'est fait, à quoi ça sert,
 * où ça se trouve — chaque groupe sous son intertitre. Les énumérations
 * détectées (`fact.items`) deviennent de vraies sous-listes au lieu de rester
 * noyées dans la phrase. Un point « À retenir » ferme la réponse quand un
 * décompte explicite existe dans le cours (« trois branches »).
 *
 * ── CE QUE ÇA N'EST PAS ────────────────────────────────────────────────────
 * Organiser n'est pas expliquer. Pas une phrase ci-dessous n'est reformulée :
 * la charpente (intertitres, ordre, puces, transitions) est ajoutée, le
 * CONTENU reste mot pour mot celui du cours. Un moteur à règles ne comprend
 * pas ce qu'il range. Reformuler avec ses propres mots, adapter le niveau,
 * répondre à une question qui n'est pas dans le cours : ça demande un modèle
 * de langue, c'est le bouton « Répondre avec l'IA ». La différence est dite
 * explicitement à l'utilisateur par le badge de provenance.
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
 * « Le nerf trijumeau possède trois branches : le nerf ophtalmique, le nerf
 * maxillaire et le nerf mandibulaire. » suivie des trois mêmes noms. Le
 * lecteur lit deux fois la même chose.
 *
 * On coupe donc AU DEUX-POINTS — un séparateur déjà présent dans le texte, pas
 * une décision de sens : l'annonce reste la puce, les éléments deviennent ses
 * sous-puces. Sans deux-points, il n'y a rien à découper proprement : la
 * phrase est rendue entière, sans sous-liste redondante.
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

  // « À retenir » n'apparaît que s'il y a réellement quelque chose de
  // mémorisable et CHIFFRÉ dans le cours — un décompte explicite. Sans cela,
  // la rubrique répéterait la réponse et ne serait qu'un remplissage.
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

/**
 * Tente de répondre localement à `question`, à partir des fragments déjà
 * retrouvés par BM25 (`scoredChunks`, réutilisés tels quels — aucune nouvelle
 * recherche). `null` dès qu'aucun fait ne répond réellement à ce qui est
 * demandé : l'appelant affiche alors un message honnête et propose l'IA en
 * option explicite, il ne comble jamais le vide.
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

  const matches: { fact: RawFact; chunkId: string; score: number; order: number }[] = [];
  let order = 0;
  for (const { chunk } of scoredChunks) {
    for (const fact of extractFacts(chunk)) {
      order += 1;
      // `'low'` n'est aujourd'hui jamais émis (l'abstention se fait à la
      // source, dans `relationExtraction`), mais le garde-fou reste : si une
      // règle future émet un fait douteux, il ne doit pas devenir une réponse.
      if (fact.confidence === 'low') continue;

      // Le fait doit traiter CE qui est demandé : tous les termes distinctifs
      // de la question doivent s'y trouver, sujet ou phrase source.
      const factTerms = significantWords(`${fact.subject} ${fact.sourceExcerpt}`);
      if ([...required].some((term) => !factTerms.has(term))) continue;

      // …et porter sur le bon sujet, pas seulement mentionner le terme au passage.
      const score = subjectOverlap(questionTerms, significantWords(fact.subject));
      if (score < SUBJECT_OVERLAP_FLOOR) continue;

      matches.push({ fact, chunkId: chunk.id, score, order });
    }
  }
  if (matches.length === 0) return null;

  matches.sort(
    (a, b) =>
      b.score - a.score || PREDICATE_PRIORITY[a.fact.predicate] - PREDICATE_PRIORITY[b.fact.predicate] || a.order - b.order,
  );

  const chunkById = new Map(scoredChunks.map(({ chunk }) => [chunk.id, chunk]));
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

  if (kept.length === 0) return null;

  /*
   * Le titre de la leçon est le sujet du fait le MIEUX CLASSÉ, verbatim du
   * cours — pas celui du premier fait rencontré dans le document. Les faits
   * sont ensuite remis dans l'ordre pédagogique par `composeAnswer`, mais le
   * sujet, lui, doit rester celui que la question visait.
   */
  const subject = kept[0]!.subject;
  return { text: composeAnswer(subject, kept), citations };
}
