import { aiOrchestrator } from '@/services/ai/orchestrator';
import { extractJsonArray } from '@/services/ai/parsing';
import { chunkDocument } from '@/services/rag/chunking';
import { generateLocalCardDrafts } from '@/services/local/localFlashcards';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { DocumentChunk, Note } from '@/types';

/**
 * « Créer des flashcards avec l'IA » à partir d'une note.
 *
 * Une note n'est pas indexée en fragments (`DocumentChunk`) comme un PDF —
 * elle est courte, et son texte intégral est transmis tel quel au modèle.
 * La garantie anti-invention reste néanmoins STRUCTURELLE, pas une promesse
 * du modèle : chaque proposition doit citer un EXTRAIT EXACT, copié mot
 * pour mot dans la note, et vérifié ici par une simple recherche de
 * sous-chaîne — exactement le même principe que la vérification par
 * citation utilisée partout ailleurs (`validateCardDrafts`,
 * `validateConcepts`), adapté à une source non fragmentée. Un extrait qui ne
 * se retrouve pas mot pour mot dans la note fait rejeter la proposition
 * entière : rien de plausible-mais-invérifiable n'atteint l'utilisateur.
 *
 * Rien n'est enregistré ici : `generateNoteCardDrafts` renvoie des
 * PROPOSITIONS. C'est seulement quand l'utilisateur accepte une proposition
 * (voir `NoteFlashcardDrafts.tsx`) qu'une vraie flashcard est créée via
 * `createFlashcard` — le même chemin, la même répétition espacée SM-2, que
 * n'importe quelle carte créée à la main.
 */

const MIN_NOTE_LENGTH = 24;

export class InsufficientNoteContentError extends Error {
  constructor() {
    super('Cette note est trop courte pour en tirer des flashcards fiables.');
    this.name = 'InsufficientNoteContentError';
  }
}

export interface RawNoteCardDraft {
  question?: unknown;
  answer?: unknown;
  /** Extrait exact de la note censé justifier la réponse — vérifié avant d'être accepté. */
  excerpt?: unknown;
}

export interface NoteCardDraft {
  question: string;
  answer: string;
  /** L'extrait réel de la note qui justifie cette carte — affiché à l'utilisateur, jamais caché. */
  excerpt: string;
}

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Ne garde que les propositions dont l'extrait cité se retrouve VRAIMENT,
 * mot pour mot (à la casse et aux espaces près), dans le texte de la note.
 */
export function validateNoteCardDrafts(raw: readonly RawNoteCardDraft[], noteText: string, limit: number): NoteCardDraft[] {
  const normalizedNote = normalize(noteText);
  const drafts: NoteCardDraft[] = [];

  for (const item of raw) {
    if (typeof item.question !== 'string' || item.question.trim().length === 0) continue;
    if (typeof item.answer !== 'string' || item.answer.trim().length === 0) continue;
    if (typeof item.excerpt !== 'string' || item.excerpt.trim().length === 0) continue;

    const excerpt = item.excerpt.trim();
    if (!normalizedNote.includes(normalize(excerpt))) continue;

    drafts.push({ question: item.question.trim(), answer: item.answer.trim(), excerpt });
    if (drafts.length >= limit) break;
  }

  return drafts;
}

function systemPrompt(count: number, noteTitle: string, noteText: string): string {
  return `Tu prépares des flashcards de révision pour un étudiant en dentisterie (UMF Iași, section française), à partir du texte intégral d'UNE de ses notes personnelles, intitulée « ${noteTitle} » et reproduite ci-dessous telle quelle.

Génère jusqu'à ${count} flashcards question/réponse, précises et concises, une notion par carte. N'en propose pas plus que ce que la note permet réellement de couvrir.

RÈGLES ABSOLUES :
- Chaque carte doit citer, dans le champ "excerpt", un EXTRAIT EXACT copié mot pour mot dans la note ci-dessous, qui justifie la réponse.
- N'utilise QUE le texte de cette note. N'invente aucune information qui n'y figure pas.
- Si la note ne permet vraiment de construire aucune carte fiable, réponds avec un tableau vide : [].
- Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ni après, sans balises de code. Format exact :
[{"question":"...","answer":"...","excerpt":"passage exact copié de la note"}]

NOTE :
${noteText}`;
}

export interface GenerateNoteCardsInput {
  note: Note;
  count: number;
  signal?: AbortSignal;
  /**
   * `'local'` par défaut (aucun réseau) : la génération de cartes depuis une
   * NOTE était la dernière à exiger une clé, alors que la génération depuis
   * un COURS est locale depuis longtemps. Deux portes voisines, une seule
   * fermée, pour le même geste.
   */
  source?: 'local' | 'ai';
}

/**
 * CARTES DEPUIS UNE NOTE, SANS RÉSEAU.
 *
 * Une note n'est pas un document indexé : elle n'a pas de `DocumentChunk`. On
 * la découpe donc à la volée, exactement comme un document importé, et on la
 * confie au MÊME moteur que les cours (`generateLocalCardDrafts`). Une carte
 * tirée d'une note et une carte tirée d'un PDF sont la même chose ; il n'y
 * avait aucune raison qu'elles empruntent deux chemins différents.
 *
 * L'extrait affiché est la citation du fait : il vient mot pour mot de la
 * note, ce qui satisfait par construction la vérification qu'on impose au
 * chemin IA.
 */
export function generateNoteCardDraftsLocally(note: Note, count: number): NoteCardDraft[] {
  const chunks: DocumentChunk[] = chunkDocument(note.text).map((draft, index) => ({
    ...draft,
    id: `note-${note.id}-${index}`,
    documentId: `note-${note.id}`,
    subjectId: note.subjectId,
    chapterId: note.chapterId ?? '',
    embedding: null,
  }));

  const lookup: ContextLookup = { subjects: new Map(), chapters: new Map(), documents: new Map() };
  const drafts = generateLocalCardDrafts({
    chunks,
    lookup,
    count,
    importance: 2,
    difficulty: 2,
    existingQuestions: [],
  });

  return drafts
    .map((draft) => ({
      question: draft.question,
      answer: draft.answer,
      excerpt: draft.citations[0]?.excerpt ?? draft.answer,
    }))
    // Même garantie que le chemin IA : l'extrait doit VRAIMENT être dans la note.
    .filter((draft) => normalize(note.text).includes(normalize(draft.excerpt)));
}

/** Génère des propositions de cartes depuis une note, déjà vérifiées contre son texte réel. */
export async function generateNoteCardDrafts(input: GenerateNoteCardsInput): Promise<NoteCardDraft[]> {
  if (input.note.text.trim().length < MIN_NOTE_LENGTH) throw new InsufficientNoteContentError();

  if (input.source !== 'ai') return generateNoteCardDraftsLocally(input.note, input.count);

  const raw = await aiOrchestrator.ask({
    system: systemPrompt(input.count, input.note.title, input.note.text),
    prompt: `Génère jusqu'à ${input.count} flashcards à partir de cette note, au format JSON.`,
    maxTokens: 2048,
    signal: input.signal,
    task: 'flashcards-generate',
  });

  const rawDrafts = extractJsonArray<RawNoteCardDraft>(raw);
  return validateNoteCardDrafts(rawDrafts, input.note.text, input.count);
}
