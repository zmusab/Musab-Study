import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, useToast } from '@/components/ui';
import { db } from '@/data/db';
import { listChunks } from '@/data/repositories/documents';
import { getChapterAnalysis, saveChapterAnalysis } from '@/data/repositories/notions';
import { analyzeChapter, InsufficientChapterContentError } from '@/services/courses/notions';
import { aiOrchestrator } from '@/services/ai/orchestrator';
import { hasApiKey } from '@/services/ai/settings';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { Chapter, ID } from '@/types';

/**
 * Détection des notions par chapitre — réutilise `analyzeChapter`
 * (services/courses/notions.ts), lui-même bâti sur le pipeline de validation
 * du podcast. Rien n'est affiché avant que l'analyse soit réellement
 * terminée : pas de nombre de notions inventé pendant le chargement.
 */
function ChapterAnalysisCard({ subjectId, chapter }: { subjectId: ID; chapter: Chapter }) {
  const { notify } = useToast();
  const navigate = useNavigate();
  const analysis = useLiveQuery(() => getChapterAnalysis(chapter.id), [chapter.id]);
  const [analyzing, setAnalyzing] = useState(false);

  const runAnalysis = async () => {
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour analyser ce chapitre.', 'error');
      return;
    }
    setAnalyzing(true);
    try {
      const chunks = await listChunks({ subjectId, chapterId: chapter.id });
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

      const notions = await analyzeChapter({ chunks, lookup });
      await saveChapterAnalysis(subjectId, chapter.id, notions);
      notify(`« ${chapter.name} » analysé — ${notions.length} notion(s) détectée(s).`, 'success');
    } catch (error) {
      if (error instanceof InsufficientChapterContentError) {
        notify(error.message, 'error');
      } else {
        notify(aiOrchestrator.describeAiError(error), 'error');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[0.92rem] font-medium">{chapter.name}</h3>
          {analysis && (
            <p className="mt-0.5 text-[0.76rem] text-[var(--ink-faint)]">
              {analysis.notions.length} notion(s) détectée(s)
            </p>
          )}
        </div>
        <Button size="sm" variant="secondary" loading={analyzing} onClick={() => void runAnalysis()}>
          {analyzing ? 'Analyse en cours…' : analysis ? 'Ré-analyser' : 'Analyser ce chapitre'}
        </Button>
      </div>

      {analysis && analysis.notions.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 border-t border-[var(--line)] pt-3">
          {analysis.notions.map((notion) => {
            const firstCitation = notion.citations[0];
            return (
              <li
                key={notion.id}
                className="flex items-start justify-between gap-2 rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-[0.86rem] font-medium">
                    {notion.label}
                    {notion.isPitfall && <span className="ml-1.5 text-[0.72rem] text-[var(--danger)]">⚠️ piège fréquent</span>}
                  </p>
                </div>
                {firstCitation && firstCitation.page !== null && (
                  <button
                    type="button"
                    onClick={() => navigate(`/document/${firstCitation.documentId}?page=${firstCitation.page}`)}
                    className="shrink-0 rounded-full border border-[var(--accent)]/40 bg-[var(--accent-tint)] px-2.5 py-1 text-[0.72rem] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-tint)]/70"
                  >
                    📚 page {firstCitation.page}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function NotionsTab({ subjectId, chapters }: { subjectId: ID; chapters: Chapter[] }) {
  const analyses = useLiveQuery(
    () => db.chapterAnalyses.where('subjectId').equals(subjectId).toArray(),
    [subjectId],
  );

  const analyzedCount = analyses?.length ?? 0;
  const notionCount = analyses?.reduce((sum, a) => sum + a.notions.length, 0) ?? 0;

  if (chapters.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[0.85rem] text-[var(--ink-faint)]">
        Ajoute d'abord un chapitre avec des documents dans l'onglet Documents.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {analyses !== undefined && (
        <p className="flex items-center gap-1.5 text-[0.82rem] text-[var(--ink-soft)]">
          <Icon name="sparkles" size={14} />
          {analyzedCount === 0
            ? "Aucun chapitre analysé pour l'instant."
            : `Cours analysé — ${analyzedCount} chapitre(s), ${notionCount} notion(s) détectée(s)`}
        </p>
      )}
      {chapters.map((chapter) => (
        <ChapterAnalysisCard key={chapter.id} subjectId={subjectId} chapter={chapter} />
      ))}
    </div>
  );
}
