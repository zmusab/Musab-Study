import { useState } from 'react';
import { Button, Icon, Spinner, useToast } from '@/components/ui';
import { db } from '@/data/db';
import { listChunks } from '@/data/repositories/documents';
import { buildContext, type ContextLookup, type ScoredChunk } from '@/services/rag/retrieval';
import { courseSystemPrompt, verifyCourseAnswer } from '@/services/ai/tutor';
import { studyChapter } from '@/services/assistant/chapterStudy';
import { aiOrchestrator } from '@/services/ai/orchestrator';
import { hasApiKey } from '@/services/ai/settings';
import type { Citation, ID } from '@/types';

/**
 * Panneau IA du lecteur — les deux actions du mockup : « Explique cette page »
 * (chunks dont la pagination couvre la page affichée) et « Résume ce
 * chapitre » (tous les chunks du chapitre). Même garde-fou que partout
 * ailleurs dans l'app : la réponse n'est acceptée que si elle cite un
 * fragment réellement transmis (`verifyCourseAnswer`).
 *
 * « Résume ce chapitre » délègue à `studyChapter()` — EXACTEMENT la fonction
 * que l'Assistant IA (onglet « Étudier ») utilise pour la même action. Avant,
 * les deux endroits reconstruisaient chacun leur propre prompt (budget de
 * contexte différent, ordre des extraits différent, texte légèrement
 * différent) : un résumé déjà obtenu depuis l'un ne pouvait jamais servir de
 * cache pour l'autre, alors qu'il s'agit de la même question sur le même
 * chapitre. Un seul appelant, un seul texte de requête → le cache de
 * `aiOrchestrator` (voir `services/ai/cache.ts`) les reconnaît désormais
 * comme identiques.
 */
export function PdfAiPanel({
  subjectId,
  chapterId,
  documentId,
  currentPage,
  program,
  onJumpToPage,
  onClose,
}: {
  subjectId: ID;
  chapterId: ID;
  documentId: ID;
  currentPage: number;
  program: string;
  onJumpToPage: (page: number) => void;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [loading, setLoading] = useState<'page' | 'chapter' | null>(null);
  const [answer, setAnswer] = useState<{ text: string; citations: Citation[] } | null>(null);

  const run = async (scope: 'page' | 'chapter') => {
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour utiliser l’assistant.', 'error');
      return;
    }

    setLoading(scope);
    setAnswer(null);
    try {
      // « Résume ce chapitre » est la MÊME question que l'action « Résumer ce
      // cours » de l'Assistant IA — voir `studyChapter()` : un seul appelant,
      // pour que le cache reconnaisse un résumé déjà obtenu pour ce chapitre,
      // quelle que soit la porte d'entrée utilisée.
      if (scope === 'chapter') {
        const result = await studyChapter({ subjectId, chapterId }, 'summary', program);
        if (!result) {
          notify('Aucun contenu indexé pour ce chapitre.', 'error');
          return;
        }
        setAnswer({ text: result.verified.text, citations: result.verified.citations });
        return;
      }

      const allChunks = await listChunks({ subjectId, chapterId });
      const relevant = allChunks.filter(
        (chunk) =>
          chunk.documentId === documentId &&
          chunk.pageStart !== null &&
          chunk.pageStart <= currentPage &&
          (chunk.pageEnd ?? chunk.pageStart) >= currentPage,
      );

      if (relevant.length === 0) {
        notify("Cette page n'a pas pu être associée à un passage indexé.", 'error');
        return;
      }

      const scored: ScoredChunk[] = relevant.map((chunk) => ({ chunk, score: 1, matchedTerms: [] }));

      const [subjectRows, chapterRows, documentRows] = await Promise.all([
        db.subjects.toArray(),
        db.chapters.where('subjectId').equals(subjectId).toArray(),
        db.documents.where('subjectId').equals(subjectId).toArray(),
      ]);
      const lookup: ContextLookup = {
        subjects: new Map(subjectRows.map((row) => [row.id, row])),
        chapters: new Map(chapterRows.map((row) => [row.id, row])),
        documents: new Map(documentRows.map((row) => [row.id, { id: row.id, name: row.name }])),
      };
      const context = buildContext(scored, lookup);

      const raw = await aiOrchestrator.ask({
        system: courseSystemPrompt(context, program),
        prompt: `Explique cette page de mon cours en langage clair et pédagogique, comme à un étudiant qui la découvre.`,
        task: 'pdf-explain-page',
      });

      const verified = verifyCourseAnswer(raw, context);
      setAnswer({ text: verified.text, citations: verified.citations });
    } catch (error) {
      notify(aiOrchestrator.describeAiError(error), 'error');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--line)] p-3">
        <p className="flex items-center gap-1.5 text-[0.85rem] font-semibold">
          <Icon name="sparkles" size={16} />
          Assistant IA
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer l’assistant"
          data-touch-target
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="secondary" loading={loading === 'page'} onClick={() => void run('page')}>
            Explique-moi cette page ({currentPage})
          </Button>
          <Button size="sm" variant="secondary" loading={loading === 'chapter'} onClick={() => void run('chapter')}>
            Résume-moi ce chapitre
          </Button>
        </div>

        {loading && !answer && (
          <div className="mt-6 flex items-center justify-center gap-2 text-[0.82rem] text-[var(--ink-soft)]">
            <Spinner size={14} />
            Lecture de tes cours…
          </div>
        )}

        {answer && (
          <div className="mt-4">
            <div className="whitespace-pre-wrap rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3.5 py-3 text-[0.86rem] leading-relaxed">
              {answer.text}
            </div>
            {answer.citations.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {answer.citations
                  .filter((c) => c.page !== null)
                  .map((c, i) => (
                    <button
                      key={`${c.chunkId}-${i}`}
                      type="button"
                      onClick={() => onJumpToPage(c.page!)}
                      className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent-tint)] px-2.5 py-1 text-[0.74rem] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-tint)]/70"
                    >
                      page {c.page}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
