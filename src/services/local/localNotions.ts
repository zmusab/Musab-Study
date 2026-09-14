import { extractFacts, type RawFact } from './relationExtraction';
import { comparisonKey } from '@/core/text';
import { splitIntoSentences } from './textStructure';
import { citationFromChunk } from './citation';
import type { ContextLookup } from '@/services/rag/retrieval';
import { uid } from '@/lib/id';
import type { DocumentChunk, ID, Importance, Notion } from '@/types';

/**
 * Notions de chapitre SANS IA — moteur à règles, à partir des mêmes relations
 * détectées par `relationExtraction.ts`.
 *
 * `LocalNotion` est un type PROPRE, indépendant de `Notion` (imposé
 * après revue) : le moteur local ne doit pas se coupler à une forme pensée
 * pour un pipeline IA différent simplement parce que `ChapterAnalysis`
 * l'utilise aujourd'hui. `toNotion`/`localNotionsToNotions`
 * ne convertissent vers cette forme persistante qu'au moment d'écrire dans
 * `ChapterAnalysis` — aucun changement de schéma Dexie.
 */

export interface LocalNotion {
  label: string;
  /** Définition détectée (fait de type 'definition'), sinon `null`. */
  definition: string | null;
  importance: Importance;
  isPitfall: boolean;
  sourceChunkId: ID;
  /** Sous-extrait exact du chunk source. */
  sourceExcerpt: string;
}

// Pas de `\b` en tête de « à ne pas confondre » : « à » entouré d'espaces n'a
// jamais de frontière `\b` adjacente en JavaScript (voir relationExtraction.ts) —
// « ne pas confondre » seul suffit de toute façon à couvrir ce cas.
const PITFALL_MARKERS = /\b(?:attention|ne pas confondre|piège|erreur fréquente)\b/i;

/** Normalisation partagée — voir `core/text`, une seule définition pour tout le projet. */
const normalizeLabel = comparisonKey;


/**
 * Ce que le cours affirme d'autre sur un sujet, à défaut d'une définition.
 * L'ordre est celui d'un enseignant : de quoi c'est fait, quels types, à quoi
 * ça sert, ce que ça comporte, où ça se trouve.
 */
const DESCRIPTION_ORDER: RawFact['predicate'][] = [
  'composition',
  'classification',
  'function',
  'possession',
  'location',
];

function bestDescription(group: readonly RawFact[]): RawFact | null {
  for (const predicate of DESCRIPTION_ORDER) {
    const found = group.find((fact) => fact.predicate === predicate);
    if (found) return found;
  }
  return null;
}

/**
 * « a, b et c » — mais seulement quand ce sont des ÉLÉMENTS.
 *
 * « se compose de ANTERIEUR : il descend au niveau de la cavité buccale par
 * le grand canal palatin. et MOYEN : … » : coordonner deux phrases entières
 * par « et » ne fait pas une liste, ça fait une faute de français. Dès qu'un
 * élément est une phrase, on les met bout à bout comme le cours les a écrits.
 * (Même règle que pour les flashcards — voir `localFlashcards.ITEMS_JOINER`.)
 */
function joinItems(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.some((item) => /[.!?]$/.test(item.trim()))) {
    return items.map((item) => item.trim()).join(' ');
  }
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** Vrai quand les éléments sont des phrases : l'amorce « se compose de » n'a alors plus de sens. */
function itemsAreSentences(fact: RawFact): boolean {
  return (fact.items ?? []).some((item) => /[.!?]$/.test(item.trim()));
}

const DESCRIPTION_LEAD: Record<string, string> = {
  composition: 'se compose de',
  classification: 'types',
  function: 'sert à',
  possession: 'comporte',
  location: 'se situe',
};

function describeFact(fact: RawFact): string {
  const body = fact.items && fact.items.length >= 2 ? joinItems(fact.items) : fact.object;
  if (fact.predicate === 'definition' || itemsAreSentences(fact)) return body;
  const lead = DESCRIPTION_LEAD[fact.predicate];
  return lead ? `${lead} ${body}` : body;
}

export interface GenerateLocalNotionsInput {
  chunks: DocumentChunk[];
  count: number;
}

/**
 * Regroupe les faits détectés par sujet (même terme normalisé) : chaque
 * groupe devient une notion. L'importance suit la fréquence d'apparition du
 * terme et la présence d'une définition explicite — jamais devinée, jamais
 * demandée à un modèle.
 */
export function generateLocalNotions(input: GenerateLocalNotionsInput): LocalNotion[] {
  const facts: RawFact[] = [];
  for (const chunk of input.chunks) {
    facts.push(...extractFacts(chunk).filter((fact) => fact.confidence !== 'low'));
  }

  const bySubject = new Map<string, RawFact[]>();
  for (const fact of facts) {
    const key = normalizeLabel(fact.subject);
    if (key.length === 0) continue;
    const group = bySubject.get(key);
    if (group) group.push(fact);
    else bySubject.set(key, [fact]);
  }

  // Un avertissement ("Attention à ne pas confondre X et Y.") vit souvent
  // dans sa PROPRE phrase, sans motif de relation reconnu — il ne produit
  // donc jamais de RawFact lui-même. On le rattache à une notion existante
  // en le cherchant dans TOUTES les phrases du chapitre, pas seulement dans
  // l'excerpt de chaque fait.
  const pitfallSentences = input.chunks.flatMap((chunk) =>
    splitIntoSentences(chunk.text).filter((sentence) => PITFALL_MARKERS.test(sentence)),
  );

  /*
    DEUX ENTRÉES POUR LA MÊME NOTION, dont une illisible.

    Mesuré sur le cours du trijumeau, la liste contenait À LA FOIS :

        • Le nerf maxillaire — un nerf sensitif
        • Le nerf maxillaire est un nerf sensitif. — (sans définition)

    La seconde vient d'un fait dont le sujet extrait est la phrase entière.
    Ce n'est pas une notion, c'est la même notion mal nommée : son libellé
    COMMENCE par celui de la première. On fusionne donc les groupes dont le
    libellé normalisé en prolonge un autre, en gardant le plus court — celui
    qui ressemble à un intitulé plutôt qu'à une phrase.
  */
  const keys = [...bySubject.keys()].sort((a, b) => a.length - b.length);
  for (const long of [...keys].reverse()) {
    const shorter = keys.find((short) => short !== long && long.startsWith(`${short} `));
    if (!shorter) continue;
    bySubject.get(shorter)!.push(...bySubject.get(long)!);
    bySubject.delete(long);
  }

  const notions: LocalNotion[] = [];
  for (const group of bySubject.values()) {
    const definitionFact = group.find((fact) => fact.predicate === 'definition') ?? null;
    const anchor = definitionFact ?? group[0]!;
    const occurrences = group.length;
    const subjectKey = normalizeLabel(anchor.subject);

    /*
      UNE NOTION SANS DÉFINITION N'APPREND RIEN.

      Six notions sur huit sortaient avec `definition: null`, donc un libellé
      seul à l'écran : « Le nerf ophtalmique de Willis » et rien d'autre. Le
      cours en dit pourtant quelque chose — il le divise en trois branches,
      il le fait cheminer par un canal. À défaut d'une phrase « X est Y », on
      prend donc ce que le cours affirme d'autre sur ce sujet, dans l'ordre
      où un enseignant le donnerait.

      Rien n'est reformulé : `object` et `items` sont des sous-extraits exacts
      du cours, assemblés comme les flashcards le font déjà.
    */
    const described = definitionFact ?? bestDescription(group);
    const definition = described ? describeFact(described) : null;

    /*
      UNE ÉNUMÉRATION EST PRÉCISÉMENT CE QU'IL FAUT APPRENDRE.

      « Les nerfs palatins (x 3 …) » et « 4 muscles droits » sortaient en
      importance 1 — le plancher — parce qu'ils n'apparaissent qu'une fois et
      n'ont pas de phrase de définition. C'est exactement l'inverse de ce
      qu'un examen demande : une liste nommée et comptée est ce qui tombe.
    */
    const carriesList = group.some((fact) => (fact.items?.length ?? 0) >= 2);
    const importance: Importance =
      definitionFact || occurrences >= 3 ? 3 : occurrences === 2 || carriesList ? 2 : 1;

    notions.push({
      label: anchor.subject,
      definition,
      importance,
      isPitfall:
        group.some((fact) => PITFALL_MARKERS.test(fact.sourceExcerpt)) ||
        pitfallSentences.some((sentence) => normalizeLabel(sentence).includes(subjectKey)),
      sourceChunkId: anchor.sourceChunkId,
      sourceExcerpt: anchor.sourceExcerpt,
    });
  }

  return notions.sort((a, b) => b.importance - a.importance).slice(0, input.count);
}

/** Adaptateur — appelé UNIQUEMENT au moment de persister dans `ChapterAnalysis`. */
export function toNotion(notion: LocalNotion, chunk: DocumentChunk, lookup: ContextLookup): Notion {
  return {
    id: uid('cpt'),
    label: notion.label,
    importance: notion.importance,
    isPitfall: notion.isPitfall,
    citations: [citationFromChunk(chunk, lookup, notion.sourceExcerpt)],
  };
}

/** Convertit un lot de notions locales — retrouve chaque chunk source par id. */
export function localNotionsToNotions(
  notions: readonly LocalNotion[],
  chunks: readonly DocumentChunk[],
  lookup: ContextLookup,
): Notion[] {
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return notions
    .map((notion) => {
      const chunk = chunksById.get(notion.sourceChunkId);
      return chunk ? toNotion(notion, chunk, lookup) : null;
    })
    .filter((concept): concept is Notion => concept !== null);
}
