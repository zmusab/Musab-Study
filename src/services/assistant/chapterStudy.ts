import { listChunks } from '@/data/repositories/documents';
import { db } from '@/data/db';
import { aiOrchestrator } from '@/services/ai/orchestrator';
import { buildLocalStudySheet } from '@/services/local/localSummary';
import { courseSystemPrompt, verifyCourseAnswer, type VerifiedAnswer } from '@/services/ai/tutor';
import { buildContext, type ContextLookup, type ScoredChunk } from '@/services/rag/retrieval';
import type { DocumentChunk, ID } from '@/types';

/**
 * Actions « Étudier » de l'Assistant IA portant sur TOUT un chapitre (ou
 * toute une matière) — résumer un cours, préparer une fiche de révision.
 *
 * Contrairement au chat (`ChatPage`), qui ne retient que les fragments les
 * plus proches d'une QUESTION précise (BM25), ces actions portent sur
 * l'ensemble du contenu indexé de la portée choisie — exactement le principe
 * déjà utilisé par `PdfAiPanel` pour « Résumer ce chapitre » et par
 * `generateCardDrafts` / `analyzeChapter` pour la génération de cartes et la
 * détection de notions. Même primitives (`buildContext`, `courseSystemPrompt`,
 * `verifyCourseAnswer`, `aiOrchestrator`), même garantie anti-invention.
 */

const CONTEXT_BUDGET = 24_000;

export type ChapterStudyMode = 'summary' | 'sheet';

export interface ChapterStudyScope {
  subjectId: ID;
  /** `null` = toute la matière. */
  chapterId: ID | null;
}

export interface ChapterStudyResult {
  verified: VerifiedAnswer;
  chunkCount: number;
}

function chunksInReadingOrder(chunks: DocumentChunk[]): ScoredChunk[] {
  return [...chunks]
    .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.index - b.index)
    .map((chunk) => ({ chunk, score: 0, matchedTerms: [] }));
}

function instructionFor(mode: ChapterStudyMode): string {
  return mode === 'summary'
    ? 'Résume ce cours de façon claire et structurée (idées principales, dans l’ordre), en citant les extraits qui soutiennent chaque affirmation.'
    : "Prépare une fiche de révision structurée : définitions clés, points essentiels à retenir, puis pièges fréquents s'ils apparaissent dans les extraits. Cite les extraits qui soutiennent chaque point.";
}

export async function loadContextLookup(subjectId: ID): Promise<ContextLookup> {
  const [subjectRows, chapterRows, documentRows] = await Promise.all([
    db.subjects.toArray(),
    db.chapters.where('subjectId').equals(subjectId).toArray(),
    db.documents.where('subjectId').equals(subjectId).toArray(),
  ]);
  return {
    subjects: new Map(subjectRows.map((row) => [row.id, row])),
    chapters: new Map(chapterRows.map((row) => [row.id, row])),
    documents: new Map(documentRows.map((row) => [row.id, { id: row.id, name: row.name }])),
  };
}

/**
 * Résumé ou fiche de révision sur toute la portée choisie. `null` quand
 * aucun contenu indexé n'existe dans cette portée — l'appelant doit alors
 * afficher un message honnête plutôt que d'appeler le modèle pour rien.
 */
export async function studyChapter(
  scope: ChapterStudyScope,
  mode: ChapterStudyMode,
  program: string,
  signal?: AbortSignal,
  /**
   * `'local'` par défaut : le résumé et la fiche se construisent SANS RÉSEAU,
   * comme les flashcards et les notions. `'ai'` est un choix explicite de
   * l'utilisateur (« Régénérer avec l'IA »), au comportement inchangé.
   */
  source: 'local' | 'ai' = 'local',
): Promise<ChapterStudyResult | null> {
  const chunks = await listChunks({ subjectId: scope.subjectId, chapterId: scope.chapterId });
  if (chunks.length === 0) return null;

  const lookup = await loadContextLookup(scope.subjectId);

  /*
    LE MOTEUR LOCAL D'ABORD.

    Le résumé de chapitre et la fiche de révision étaient les deux dernières
    fonctions d'étude entièrement bloquées derrière une clé API : sans clé,
    l'assistant répondait « Ajoute ta clé API dans Paramètres » et il ne se
    passait rien. Elles sont maintenant EXTRACTIVES par défaut — le cours
    rangé, jamais réécrit — et l'IA reste disponible pour une reformulation,
    sur demande explicite.
  */
  if (source === 'local') {
    const local = buildLocalStudySheet(mode, chunks, lookup);
    if (local) {
      return {
        verified: {
          text: local.text,
          // `course-local` et non `course` : l'interface doit dire d'où vient
          // la fiche. Présenter un rangement local comme une réponse d'IA
          // serait exactement le mensonge que ce projet s'interdit.
          provenance: 'course-local',
          citations: local.citations,
          // Rien à invalider : chaque ligne EST un extrait du cours, il n'y a
          // pas de référence inventée à écarter comme pour une réponse de
          // modèle de langue.
          invalidReferences: [],
        },
        chunkCount: chunks.length,
      };
    }
    // Rien d'exploitable localement : on le dit, on n'appelle pas le réseau
    // dans le dos de l'utilisateur.
    return null;
  }

  const context = buildContext(chunksInReadingOrder(chunks), lookup, CONTEXT_BUDGET);

  const raw = await aiOrchestrator.ask({
    system: courseSystemPrompt(context, program),
    prompt: instructionFor(mode),
    signal,
    task: 'pdf-summarize-chapter',
  });

  return { verified: verifyCourseAnswer(raw, context), chunkCount: chunks.length };
}
