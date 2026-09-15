import { extractFacts, type RawFact } from './relationExtraction';
import { comparisonKey } from '@/core/text';
import { citationFromChunk } from './citation';
import { isDuplicateQuestion } from '@/services/flashcards/dedupe';
import type { CardDraft } from '@/services/flashcards/validate';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk, Difficulty, Importance } from '@/types';

/**
 * Génération de flashcards SANS IA — moteur à règles, à partir des relations
 * détectées par `relationExtraction.ts`. Produit EXACTEMENT la même forme
 * (`CardDraft`) que `services/flashcards/generate.ts` : aucun composant en
 * aval (validation, dédoublonnage, création de la carte, SM-2) n'a besoin de
 * savoir d'où vient la proposition.
 *
 * Garantie identique au chemin IA : chaque réponse porte une citation vers
 * un extrait réel, jamais reformulé. La différence est la SOURCE de la
 * garantie — ici structurelle (l'extrait EST la réponse), là vérifiée après
 * coup (référence `[Sn]` recoupée avec le contexte transmis).
 */

/**
 * « a, b et c » — mais SEULEMENT quand ce sont des éléments, pas des phrases.
 *
 * Vu à l'écran : « C'est un nerf sensitif. ET Il chemine par le canal moyen
 * du cavum Meckeli… ». Coordonner deux phrases complètes par « et » ne
 * produit pas une liste, ça produit une faute de français.
 *
 * Dès qu'un des éléments se termine par une ponctuation de phrase, on les
 * met bout à bout comme le document les avait — c'est un enchaînement, pas
 * une énumération.
 */
const ITEMS_JOINER = (items: string[]): string => {
  if (items.length === 1) return items[0]!;

  const sentences = items.some((item) => /[.!?]$/.test(item.trim()));
  if (sentences) return items.map((item) => item.trim()).join(' ');

  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
};

const capitalize = (text: string): string => (text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text);

/**
 * Un sujet arrive tel qu'il est écrit dans le cours, donc avec la majuscule de
 * début de phrase : inséré au milieu d'une question, il donnait
 * « Qu'est-ce que Le muscle masséter ? ». La majuscule n'est retirée que
 * lorsque le premier mot est un DÉTERMINANT — jamais sur « Willis » ni sur un
 * terme qui porte légitimement sa capitale.
 */
/*
 * Pas de `\b` après la forme élidée : en JavaScript, `\b` ne connaît que les
 * caractères ASCII, donc dans « L'émail » la frontière entre l'apostrophe et
 * le « é » n'existe pas et `l['’]\b` ne matche JAMAIS. La forme élidée est
 * donc reconnue seule, et les déterminants pleins exigent l'espace qui suit.
 */
const LEADING_DETERMINER = /^(?:l['’]|(?:le|la|les|un|une|des|du|de)\s)/i;

const inlineSubject = (subject: string): string =>
  LEADING_DETERMINER.test(subject) ? subject[0]!.toLowerCase() + subject.slice(1) : subject;

interface QuestionAnswer {
  question: string;
  answer: string;
}

function questionAnswerFor(fact: RawFact): QuestionAnswer | null {
  const subject = inlineSubject(fact.subject);
  switch (fact.predicate) {
    case 'definition':
      return { question: `Qu'est-ce que ${subject} ?`, answer: capitalize(fact.object) };
    case 'composition':
      return {
        question: `De quoi se compose ${subject} ?`,
        answer: fact.items ? capitalize(ITEMS_JOINER(fact.items)) : capitalize(fact.object),
      };
    case 'possession':
      return {
        question: `Que possède ${subject} ?`,
        answer: fact.items ? capitalize(ITEMS_JOINER(fact.items)) : capitalize(fact.object),
      };
    case 'function':
      return { question: `Quelle est la fonction de ${subject} ?`, answer: capitalize(fact.object) };
    case 'location':
      return { question: `Où se situe ${subject} ?`, answer: capitalize(fact.object) };
    case 'classification':
      return {
        question: `Quels sont les types de ${subject} ?`,
        answer: fact.items ? capitalize(ITEMS_JOINER(fact.items)) : capitalize(fact.object),
      };
    default:
      return null;
  }
}

/** Carte à trous quand le fait porte un compte explicite ("trois branches"). */
function clozeFor(fact: RawFact): QuestionAnswer | null {
  if (!fact.countWord || !fact.countNoun) return null;
  return {
    question: `${capitalize(fact.subject)} ${predicateVerb(fact.predicate)} ___ ${fact.countNoun}.`,
    answer: fact.countWord,
  };
}

function predicateVerb(predicate: RawFact['predicate']): string {
  return predicate === 'composition' ? 'se compose de' : 'possède';
}

export interface GenerateLocalCardsInput {
  chunks: DocumentChunk[];
  lookup: ContextLookup;
  count: number;
  importance: Importance;
  difficulty: Difficulty;
  /** Questions déjà présentes dans la bibliothèque — jamais reproposées. */
  existingQuestions: readonly string[];
}

/**
 * Génère des propositions de cartes sans le moindre appel réseau. Un fait de
 * confiance insuffisante ('low', ou tout simplement absent de l'extraction —
 * voir `relationExtraction.ts`) ne produit jamais de carte : mieux ne rien
 * proposer qu'une carte potentiellement fausse.
 */
/**
 * UNE CARTE À TROUS N'EST PAS UN DOUBLON DE SA QUESTION DIRECTE.
 *
 * « Que possède le nerf trijumeau ? » et « Le nerf trijumeau possède ___
 * branches. » portent sur le même fait, mais ce sont deux EXERCICES
 * différents : l'un demande de restituer la liste, l'autre le compte. Les
 * comparer entre eux faisait disparaître la carte à trous, parce qu'ils
 * partagent forcément tout leur vocabulaire — c'est même ce qui fait d'eux
 * une paire cohérente.
 *
 * Chaque forme est donc dédoublonnée contre les questions de SA forme.
 */
const isCloze = (question: string): boolean => question.includes('___');

export function generateLocalCardDrafts(input: GenerateLocalCardsInput): CardDraft[] {
  const drafts: CardDraft[] = [];
  const proposedQuestions: string[] = [...input.existingQuestions];

  for (const chunk of input.chunks) {
    for (const fact of extractFacts(chunk)) {
      if (fact.confidence === 'low') continue;

      const citation = citationFromChunk(chunk, input.lookup, fact.sourceExcerpt);
      const candidates = [questionAnswerFor(fact), clozeFor(fact)].filter(
        (candidate): candidate is QuestionAnswer => candidate !== null,
      );

      for (const candidate of candidates) {
        if (candidate.answer.trim().length === 0) continue;
        const sameForm = proposedQuestions.filter((question) => isCloze(question) === isCloze(candidate.question));
        if (isDuplicateQuestion(candidate.question, sameForm)) continue;

        drafts.push({
          question: candidate.question,
          answer: candidate.answer,
          citations: [citation],
          sourceChunkIds: [chunk.id],
          importance: input.importance,
          difficulty: input.difficulty,
          // La carte RETIENT la notion d'où elle sort. Notions et flashcards
          // naissaient déjà du même sujet extrait, mais chacune l'oubliait
          // aussitôt : c'est ce qui empêchait l'application de dire « tu
          // maîtrises le nerf trijumeau » plutôt que « la carte n°123 ».
          notionKey: comparisonKey(fact.subject),
          notionLabel: fact.subject,
        });
        proposedQuestions.push(candidate.question);

        if (drafts.length >= input.count) return drafts;
      }
    }
  }

  return drafts;
}
