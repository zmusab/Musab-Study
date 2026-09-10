import { aiOrchestrator } from '@/services/ai/orchestrator';
import { extractJsonObject } from '@/services/ai/parsing';
import { splitIntoSentences } from '@/services/local/textStructure';
import type { Note } from '@/types';

/**
 * « Résumer une note » — Assistant IA, catégorie Étudier.
 *
 * Même garantie anti-invention que `services/notes/flashcards.ts` : une note
 * n'est pas fragmentée en `DocumentChunk`, donc la vérification ne peut pas
 * s'appuyer sur des références [Sn]. Elle repose sur le même principe adapté
 * — un EXTRAIT EXACT, copié mot pour mot dans la note, qui illustre le
 * résumé. Un résumé dont l'extrait ne se retrouve pas dans le texte réel de
 * la note est rejeté : mieux vaut le dire que présenter un résumé
 * invérifiable.
 */

const MIN_NOTE_LENGTH = 24;

export class InsufficientNoteContentError extends Error {
  constructor() {
    super('Cette note est trop courte pour en tirer un résumé fiable.');
    this.name = 'InsufficientNoteContentError';
  }
}

export interface RawNoteSummary {
  summary?: unknown;
  excerpt?: unknown;
}

export interface NoteSummary {
  summary: string;
  /** L'extrait réel de la note qui illustre ce résumé — affiché, jamais caché. */
  excerpt: string;
}

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Ne garde le résumé que si son extrait cité se retrouve VRAIMENT dans le texte de la note. */
export function validateNoteSummary(raw: RawNoteSummary, noteText: string): NoteSummary | null {
  if (typeof raw.summary !== 'string' || raw.summary.trim().length === 0) return null;
  if (typeof raw.excerpt !== 'string' || raw.excerpt.trim().length === 0) return null;

  const excerpt = raw.excerpt.trim();
  if (!normalize(noteText).includes(normalize(excerpt))) return null;

  return { summary: raw.summary.trim(), excerpt };
}

function systemPrompt(noteTitle: string, noteText: string): string {
  return `Tu résumes une note personnelle d'un étudiant en dentisterie (UMF Iași, section française), intitulée « ${noteTitle} », reproduite intégralement ci-dessous.

Rédige un résumé clair et concis (3 à 6 phrases) du contenu RÉEL de cette note. N'ajoute aucune information qui n'y figure pas.

RÈGLES ABSOLUES :
- Le champ "excerpt" doit être un EXTRAIT EXACT copié mot pour mot dans la note, qui illustre le cœur du contenu résumé.
- N'utilise QUE le texte de cette note. N'invente rien.
- Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises de code. Format exact :
{"summary":"...","excerpt":"passage exact copié de la note"}

NOTE :
${noteText}`;
}

export interface SummarizeNoteInput {
  note: Note;
  signal?: AbortSignal;
  /**
   * `'local'` par défaut (aucun réseau). `'ai'` est un choix explicite de
   * l'utilisateur, au comportement strictement inchangé.
   */
  source?: 'local' | 'ai';
}

/**
 * RÉSUMÉ LOCAL D'UNE NOTE — les phrases qui la portent, sans réseau.
 *
 * Une note n'a ni titres ni puces : c'est du texte au fil de l'eau. Le résumé
 * extractif y prend donc sa forme la plus ancienne — les premières phrases,
 * qui annoncent ce que la note développe.
 *
 * Rien n'est reformulé, et l'extrait cité est la première de ces phrases :
 * la garantie de vérifiabilité du chemin IA (« cet extrait se retrouve mot
 * pour mot dans la note ») est ici vraie par construction.
 */
const MAX_LOCAL_SENTENCES = 3;

export function summarizeNoteLocally(note: Note): NoteSummary | null {
  const sentences = splitIntoSentences(note.text).filter((sentence) => sentence.length >= 24);
  if (sentences.length === 0) return null;

  const kept = sentences.slice(0, MAX_LOCAL_SENTENCES);
  return { summary: kept.join(' '), excerpt: kept[0]! };
}

export async function summarizeNote(input: SummarizeNoteInput): Promise<NoteSummary | null> {
  if (input.note.text.trim().length < MIN_NOTE_LENGTH) throw new InsufficientNoteContentError();

  /*
    Local par défaut, comme partout ailleurs dans l'application. « Résumer ma
    note » répondait « Ajoute ta clé API dans Paramètres » et ne faisait rien
    de plus — pour un texte que l'utilisateur a écrit lui-même, et qui est
    déjà sur son appareil.
  */
  if (input.source !== 'ai') return summarizeNoteLocally(input.note);

  const raw = await aiOrchestrator.ask({
    system: systemPrompt(input.note.title, input.note.text),
    prompt: 'Résume cette note, au format JSON demandé.',
    maxTokens: 1024,
    signal: input.signal,
    task: 'note-summarize',
  });

  return validateNoteSummary(extractJsonObject<RawNoteSummary>(raw), input.note.text);
}
