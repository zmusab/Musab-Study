import { aiOrchestrator } from '@/services/ai/orchestrator';
import { extractJsonArray } from '@/services/ai/parsing';
import { buildContext, type ContextLookup, type ScoredChunk } from '@/services/rag/retrieval';
import { listCards } from '@/data/repositories/cards';
import { validateCardDrafts, type CardDraft, type RawCardDraft } from './validate';
import { isDuplicateQuestion } from './dedupe';
import { generateLocalCardDrafts } from '@/services/local/localFlashcards';
import type { DocumentChunk, Difficulty, Importance } from '@/types';

export { isDuplicateQuestion };

/**
 * SOURCE PAR DÉFAUT : le moteur local (`services/local/localFlashcards.ts`),
 * sans le moindre appel réseau — Musab Study doit rester utilisable sans API
 * IA externe. L'IA reste disponible via `source: 'ai'`, un choix explicite
 * (bouton « Régénérer avec l'IA »), avec un comportement strictement
 * inchangé par rapport à avant ce chantier.
 */

/** Budget de contexte : une génération de cartes couvre tout un chapitre, pas une question ciblée. */
const CONTEXT_BUDGET = 24_000;

/** Nombre maximal de questions existantes montrées au modèle — au-delà, le rappel n'ajoute plus rien et gonfle le prompt pour rien. */
const MAX_EXISTING_QUESTIONS = 60;

function chunksInReadingOrder(chunks: DocumentChunk[]): ScoredChunk[] {
  return [...chunks]
    .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.index - b.index)
    .map((chunk) => ({ chunk, score: 0, matchedTerms: [] }));
}

function systemPrompt(count: number, context: string, existingQuestions: string[]): string {
  const existingBlock =
    existingQuestions.length > 0
      ? `\n\nCARTES DÉJÀ EXISTANTES POUR CE COURS (ne recrée AUCUNE de ces questions, même reformulée — propose autre chose) :\n${existingQuestions.map((q) => `- ${q}`).join('\n')}`
      : '';

  return `Tu prépares des flashcards de révision pour un étudiant en dentisterie (UMF Iași, section française), à partir de ses propres extraits de cours numérotés ci-dessous.

Génère jusqu'à ${count} flashcards question/réponse. Chaque carte doit :
- tester UNE SEULE idée précise (jamais une question à tiroirs qui en couvre plusieurs) ;
- avoir une question courte et sans ambiguïté, et une réponse aussi précise que concise ;
- porter sur une notion réellement importante pour l'examen — pas un détail secondaire, pas une reformulation d'une carte déjà proposée dans ce lot ;
- conserver une relation anatomique ou fonctionnelle (innervation, vascularisation, insertion, rapport, mécanisme) quand elle fait partie de ce qu'il faut retenir — ne simplifie JAMAIS au point de supprimer une information indispensable à l'examen.

Exemple de MAUVAISE carte (question à tiroirs, imprécise) : « Décris complètement le trajet, les rapports et les branches de ce nerf. »
Exemple de MEILLEURE carte (une idée, réponse exploitable) : « Quel nerf innerve ce muscle ? » → réponse courte et précise.
Adapte bien sûr chaque carte au contenu réel fourni ci-dessous — ces deux phrases ne sont que le principe, pas un sujet imposé.

RÈGLES ABSOLUES :
- Chaque réponse doit citer la référence de l'extrait qui la soutient, entre crochets : "S1", "S2".
- N'utilise QUE les extraits ci-dessous. Si une information n'y est pas clairement présente, ne l'invente pas et ne la propose pas comme si elle en provenait — complète JAMAIS avec des connaissances générales absentes du texte.
- Utilise la terminologie EXACTE du cours (nom d'une structure anatomique, d'un nerf, d'un muscle...) telle qu'elle apparaît dans les extraits — ne la traduis pas, ne l'abrège pas, ne la remplace pas par un synonyme. Si un terme anatomique est ambigu ou absent des extraits, ne propose PAS de carte dessus plutôt que d'inventer ou de deviner une dénomination.
- Ne propose pas deux cartes qui testent la même information sous une forme différente.
- Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ni après, sans balises de code. Format exact :
[{"question":"...","answer":"réponse concise avec sa référence [S1]","refs":["S1"]}]

EXTRAITS DE COURS :
${context}${existingBlock}`;
}

export interface GenerateCardsInput {
  count: number;
  importance: Importance;
  difficulty: Difficulty;
  chunks: DocumentChunk[];
  lookup: ContextLookup;
  signal?: AbortSignal;
  /**
   * 'local' (par défaut) : moteur à règles, aucun appel réseau. 'ai' :
   * régénération explicite via l'IA — comportement strictement identique à
   * avant ce chantier, jamais choisi automatiquement.
   */
  source?: 'local' | 'ai';
}

export class NoIndexedContentError extends Error {
  constructor() {
    super("Ce chapitre ne contient aucun document indexé. Importe d'abord un document.");
    this.name = 'NoIndexedContentError';
  }
}

/**
 * Cartes déjà présentes pour ce cours (mêmes chapitres que les extraits
 * fournis, plus les cartes non rattachées à un chapitre précis) — réutilise
 * `listCards`, déjà lu par la Bibliothèque de la page Flashcards ; aucune
 * nouvelle table, aucun nouvel appel IA.
 */
async function existingCardsFor(chunks: DocumentChunk[]) {
  const subjectId = chunks[0]?.subjectId;
  if (!subjectId) return [];
  const chapterIds = new Set(chunks.map((c) => c.chapterId));
  const cards = await listCards(subjectId);
  return cards.filter((card) => card.chapterId === null || chapterIds.has(card.chapterId));
}

/** Génère des propositions de cartes, déjà vérifiées, sourcées, et filtrées des doublons évidents avec la bibliothèque existante. */
export async function generateCardDrafts(input: GenerateCardsInput): Promise<CardDraft[]> {
  if (input.chunks.length === 0) throw new NoIndexedContentError();

  const existingCards = await existingCardsFor(input.chunks);
  const existingQuestions = existingCards.map((card) => card.question);

  if ((input.source ?? 'local') === 'local') {
    return generateLocalCardDrafts({
      chunks: input.chunks,
      lookup: input.lookup,
      count: input.count,
      importance: input.importance,
      difficulty: input.difficulty,
      existingQuestions,
      existingAnswerKeys: existingCards.flatMap((card) =>
        card.notionKey ? [`${card.notionKey}|${card.answer}`] : []),
    });
  }

  const context = buildContext(chunksInReadingOrder(input.chunks), input.lookup, CONTEXT_BUDGET);

  const raw = await aiOrchestrator.ask({
    system: systemPrompt(input.count, context.text, existingQuestions.slice(0, MAX_EXISTING_QUESTIONS)),
    prompt: `Génère jusqu'à ${input.count} flashcards demandées, au format JSON.`,
    maxTokens: 3072,
    signal: input.signal,
    task: 'flashcards-generate',
  });

  const rawDrafts = extractJsonArray<RawCardDraft>(raw);
  const validated = validateCardDrafts(rawDrafts, context, input.importance, input.difficulty, input.count);

  return validated.filter((draft) => !isDuplicateQuestion(draft.question, existingQuestions));
}
