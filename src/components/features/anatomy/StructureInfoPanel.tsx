import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icon, SegmentedControl, Spinner, Textarea, useToast } from '@/components/ui';
import { aiOrchestrator } from '@/services/ai/orchestrator';
import { hasApiKey } from '@/services/ai/settings';
import { courseSystemPrompt, internetSystemPrompt, verifyCourseAnswer, verifyInternetAnswer, type VerifiedAnswer } from '@/services/ai/tutor';
import { bm25Retriever, buildContext, type ContextLookup } from '@/services/rag/retrieval';
import { explainStructure } from '@/services/anatomy/explain';
import { generateAnatomyCardDrafts, NoStructureContentError } from '@/services/anatomy/flashcards';
import { saveAnatomySheet } from '@/data/repositories/anatomy';
import { useAnatomySheet } from '@/hooks/useAnatomy';
import { createFlashcard } from '@/data/repositories/cards';
import type { AnatomyStructure, Citation, DocumentChunk } from '@/types';
import type { CardDraft } from '@/services/flashcards/validate';

const RETRIEVAL_LIMIT = 8;

function uniqueCitations(citations: Citation[]): Citation[] {
  return citations.filter(
    (c, i) => citations.findIndex((o) => o.documentId === c.documentId && o.page === c.page) === i,
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  const unique = uniqueCitations(citations);
  if (unique.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {unique.map((c, i) => (
        <Link
          key={`${c.documentId}-${i}`}
          to={c.page !== null ? `/document/${c.documentId}?page=${c.page}` : `/document/${c.documentId}`}
          className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent-tint)] px-2.5 py-1 text-[0.72rem] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-tint)]/70"
        >
          📚 {c.documentName}
          {c.page !== null ? ` — page ${c.page}` : ''}
        </Link>
      ))}
    </div>
  );
}

function SheetContent({ text }: { text: string }) {
  const blocks = text.split(/\n(?=##\s)/).filter((b) => b.trim().length > 0);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        const match = /^##\s*(.+?)\n([\s\S]*)$/.exec(block.trim());
        if (!match) {
          return (
            <p key={i} className="whitespace-pre-wrap text-[0.86rem] leading-relaxed text-[var(--ink)]">
              {block.trim()}
            </p>
          );
        }
        return (
          <div key={i}>
            <p className="text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--accent-ink)]">{match[1]}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[0.86rem] leading-relaxed text-[var(--ink)]">{match[2]!.trim()}</p>
          </div>
        );
      })}
    </div>
  );
}

export function StructureInfoPanel({
  structure,
  chunks,
  lookup,
  program,
  onClose,
  onCreatedFlashcard,
}: {
  structure: AnatomyStructure;
  chunks: DocumentChunk[];
  lookup: ContextLookup;
  program: string;
  onClose: () => void;
  onCreatedFlashcard?: () => void;
}) {
  const { notify } = useToast();
  const courseSheet = useAnatomySheet(structure.id, 'course');
  const internetSheet = useAnatomySheet(structure.id, 'internet');

  const [tab, setTab] = useState<'informations' | 'cours'>('informations');
  const [generating, setGenerating] = useState<'course' | 'internet' | null>(null);
  const [asking, setAsking] = useState(false);
  const [showAskBox, setShowAskBox] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<VerifiedAnswer | null>(null);
  const [drafts, setDrafts] = useState<CardDraft[]>([]);
  const [draftIndex, setDraftIndex] = useState(0);
  const [generatingCards, setGeneratingCards] = useState(false);

  const citationCount = useMemo(
    () => (courseSheet ? uniqueCitations(courseSheet.citations).length : 0),
    [courseSheet],
  );

  const runGenerate = async (origin: 'course' | 'internet') => {
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour générer une fiche.', 'error');
      return;
    }
    setGenerating(origin);
    try {
      const result = await explainStructure({ structure, chunks, lookup, program, origin });
      await saveAnatomySheet(structure.id, origin, result.text, result.citations);
    } catch (error) {
      notify(aiOrchestrator.describeAiError(error), 'error');
    } finally {
      setGenerating(null);
    }
  };

  const askQuestion = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour utiliser l’assistant.', 'error');
      return;
    }
    setAsking(true);
    setAnswer(null);
    try {
      const query = `${structure.name} ${structure.latinName} ${trimmed}`;
      const scored = bm25Retriever.retrieve(query, chunks, RETRIEVAL_LIMIT);
      const context = buildContext(scored, lookup);
      const raw = await aiOrchestrator.ask({
        system: courseSystemPrompt(context, program),
        prompt: trimmed,
        task: 'anatomy-explain',
      });
      setAnswer(verifyCourseAnswer(raw, context));
    } catch (error) {
      notify(aiOrchestrator.describeAiError(error), 'error');
    } finally {
      setAsking(false);
    }
  };

  const askInternetFallback = async () => {
    setAsking(true);
    try {
      const scored = bm25Retriever.retrieve(question, chunks, RETRIEVAL_LIMIT);
      const context = buildContext(scored, lookup);
      const raw = await aiOrchestrator.ask({
        system: internetSystemPrompt(context, program),
        prompt: question.trim(),
        webSearch: true,
        task: 'anatomy-explain',
      });
      setAnswer(verifyInternetAnswer(raw, context));
    } catch (error) {
      notify(aiOrchestrator.describeAiError(error), 'error');
    } finally {
      setAsking(false);
    }
  };

  const runGenerateCards = async () => {
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour générer des flashcards.', 'error');
      return;
    }
    setGeneratingCards(true);
    try {
      const cards = await generateAnatomyCardDrafts({ structure, chunks, lookup, importance: 2, difficulty: 2 });
      setDrafts(cards);
      setDraftIndex(0);
    } catch (error) {
      if (error instanceof NoStructureContentError) notify(error.message, 'error');
      else notify(aiOrchestrator.describeAiError(error), 'error');
    } finally {
      setGeneratingCards(false);
    }
  };

  const currentDraft = drafts[draftIndex];

  const acceptDraft = async () => {
    if (!currentDraft) return;
    // La structure n'est pas toujours liée à une matière : à défaut, on
    // retrouve la matière réelle via le chunk source de la carte plutôt que
    // d'inventer un rattachement.
    const sourceChunk = chunks.find((c) => currentDraft.sourceChunkIds.includes(c.id));
    const subjectId = structure.subjectId ?? sourceChunk?.subjectId;
    if (!subjectId) {
      notify('Impossible de déterminer la matière associée à cette carte.', 'error');
      return;
    }
    await createFlashcard({
      subjectId,
      chapterId: sourceChunk?.chapterId ?? null,
      question: currentDraft.question,
      answer: currentDraft.answer,
      importance: currentDraft.importance,
      difficulty: currentDraft.difficulty,
      origin: 'ai',
      sourceChunkIds: currentDraft.sourceChunkIds,
    });
    notify('Flashcard ajoutée.', 'success');
    onCreatedFlashcard?.();
    setDraftIndex((i) => i + 1);
  };

  const hasInsufficientCourse = courseSheet === null || (courseSheet && courseSheet.content.startsWith('⚠️'));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--line)] p-4">
        <div className="min-w-0">
          <p className="truncate text-[1.05rem] font-semibold text-[var(--ink)]">{structure.name}</p>
          {structure.latinName && <p className="truncate text-[0.8rem] italic text-[var(--ink-faint)]">{structure.latinName}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le panneau"
          data-touch-target
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="border-b border-[var(--line)] px-4 py-2.5">
        <SegmentedControl
          size="sm"
          // `flex-nowrap` local : la colonne Informations est étroite, le
          // sélecteur doit rester sur une ligne ici sans changer son
          // comportement partout ailleurs dans l'app.
          className="w-full flex-nowrap"
          segments={[
            // Libellés courts : la colonne Informations est étroite sur
            // iPad, des libellés longs faisaient passer le sélecteur sur
            // deux lignes.
            { value: 'informations', label: 'Informations' },
            { value: 'cours', label: citationCount > 0 ? `Cours (${citationCount})` : 'Cours' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'informations' ? (
          <>
            {courseSheet === undefined ? (
              <Spinner size={16} />
            ) : courseSheet && courseSheet.content.length > 0 ? (
              <SheetContent text={courseSheet.content} />
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[0.82rem] text-[var(--ink-faint)]">
                  {courseSheet === null ? 'Aucune fiche générée pour l’instant.' : '⚠️ Information insuffisante dans tes cours.'}
                </p>
                <Button size="sm" loading={generating === 'course'} onClick={() => void runGenerate('course')}>
                  ✨ Générer depuis mes cours
                </Button>
              </div>
            )}

            {hasInsufficientCourse && (
              <div className="mt-3 border-t border-[var(--line)] pt-3">
                {internetSheet ? (
                  <div className="rounded-[var(--radius-control)] border border-[var(--nav-blue)]/30 bg-[var(--nav-blue)]/5 p-3">
                    <p className="mb-1.5 text-[0.72rem] font-semibold text-[var(--nav-blue)]">🌐 Depuis Internet — à vérifier</p>
                    <SheetContent text={internetSheet.content} />
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" loading={generating === 'internet'} onClick={() => void runGenerate('internet')}>
                    🌐 Compléter avec Internet
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <div>
            {courseSheet && citationCount > 0 ? (
              <>
                <p className="mb-2 text-[0.8rem] text-[var(--ink-soft)]">
                  {citationCount} passage{citationCount > 1 ? 's' : ''} de tes cours ont servi à générer cette fiche.
                </p>
                <CitationList citations={courseSheet.citations} />
              </>
            ) : (
              <p className="text-[0.82rem] text-[var(--ink-faint)]">
                Aucune source de cours pour l’instant — génère une fiche depuis l’onglet Informations.
              </p>
            )}
          </div>
        )}

        {showAskBox && (
          <section className="mt-5 border-t border-[var(--line)] pt-4">
            <Textarea
              autoFocus
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={`Pose une question sur ${structure.name}…`}
              rows={2}
            />
            <Button size="sm" className="mt-2" loading={asking} onClick={() => void askQuestion()} disabled={question.trim().length === 0}>
              Envoyer
            </Button>

            {answer && (
              <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--surface-2)] p-3">
                <p className="whitespace-pre-wrap text-[0.86rem] leading-relaxed text-[var(--ink)]">{answer.text}</p>
                <CitationList citations={answer.citations} />
                {answer.provenance === 'insufficient' && (
                  <Button size="sm" variant="secondary" className="mt-2" loading={asking} onClick={() => void askInternetFallback()}>
                    🌐 Rechercher sur Internet
                  </Button>
                )}
              </div>
            )}
          </section>
        )}

        {currentDraft && (
          <section className="mt-3 rounded-[var(--radius-control)] border border-[var(--line)] p-3">
            <p className="text-[0.78rem] font-semibold text-[var(--ink-soft)]">Proposition de flashcard</p>
            <p className="mt-1 text-[0.86rem] font-medium text-[var(--ink)]">{currentDraft.question}</p>
            <p className="mt-1 text-[0.84rem] text-[var(--ink-soft)]">{currentDraft.answer}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void acceptDraft()}>
                ✅ Accepter
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraftIndex((i) => i + 1)}>
                ❌ Supprimer
              </Button>
            </div>
          </section>
        )}
        {drafts.length > 0 && draftIndex >= drafts.length && (
          <p className="mt-2 text-[0.8rem] text-[var(--ink-faint)]">Toutes les cartes proposées ont été traitées.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-[var(--line)] p-3">
        <Button size="sm" variant={showAskBox ? 'secondary' : 'ghost'} onClick={() => setShowAskBox((v) => !v)}>
          <Icon name="sparkles" size={14} /> Demander à l’IA
        </Button>
        <Button size="sm" variant="ghost" loading={generatingCards} onClick={() => void runGenerateCards()}>
          🃏 Créer une flashcard
        </Button>
        <Link to="/quiz">
          <Button size="sm" variant="ghost">
            ❓ Me tester
          </Button>
        </Link>
      </div>
    </div>
  );
}
