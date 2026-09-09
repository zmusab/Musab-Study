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
const MAX_FACTS_IN_ANSWER = 4;

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
 * Met en FORME les extraits retenus. Rien n'est reformulé : chaque puce est
 * une phrase exacte du cours. Seule la charpente — le titre qui nomme le
 * sujet, le décompte, les puces — est ajoutée.
 *
 * L'ancienne version renvoyait `excerpts.join('\n\n')` : deux phrases brutes
 * collées, sans rien dire de ce qu'elles répondaient. Ça se lisait comme un
 * copier-coller de PDF, et l'apparition en cascade de l'interface n'avait
 * que deux blocs à échelonner, donc paraissait instantanée.
 *
 * La limite reste entière et assumée : organiser n'est pas expliquer. Une
 * vraie explication reformulée demande un modèle de langue, c'est le rôle du
 * bouton « Répondre avec l'IA ».
 */
function composeAnswer(facts: RawFact[]): string {
  const [first] = facts;
  if (!first) return '';
  if (facts.length === 1) return first.sourceExcerpt;

  // Le sujet du fait le mieux classé nomme la réponse — verbatim du cours.
  const heading = `**${first.subject}** — ${facts.length} éléments trouvés dans tes cours :`;
  const bullets = facts.map((fact) => `- ${fact.sourceExcerpt}`);
  return [heading, '', ...bullets].join('\n');
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

  return { text: composeAnswer(kept), citations };
}
