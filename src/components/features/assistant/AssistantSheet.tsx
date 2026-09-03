import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Textarea,
  useToast,
  type Segment,
} from '@/components/ui';
import { useProgress } from '@/hooks/useProgress';
import { useSubjectNotes } from '@/hooks/useNotes';
import { listChunks } from '@/data/repositories/documents';
import { getChapterAnalysis, saveChapterAnalysis } from '@/data/repositories/notions';
import { createFlashcard } from '@/data/repositories/cards';
import { hasApiKey } from '@/services/ai/settings';
import { aiOrchestrator } from '@/services/ai/orchestrator';
import { weakPoints } from '@/core/progress';
import { priorityItems, mainRecommendation, upcomingEvaluations } from '@/core/progress/exam';
import { analyzeChapter, InsufficientChapterContentError } from '@/services/courses/notions';
import { studyChapter, loadContextLookup, type ChapterStudyMode } from '@/services/assistant/chapterStudy';
import { COMPREHEND_ACTIONS, comprehendPrompt, type ComprehendAction } from '@/services/assistant/comprehendPrompts';
import { summarizeNote, InsufficientNoteContentError } from '@/services/notes/summarize';
import { generateCardDrafts, NoIndexedContentError } from '@/services/flashcards/generate';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { CardDraft } from '@/services/flashcards/validate';
import type { AnswerProvenance, Chapter, Citation, ID } from '@/types';

/**
 * ASSISTANT IA — les actions, ouvertes À LA DEMANDE.
 *
 * Ce panneau vivait auparavant en permanence au-dessus de la conversation :
 * une douzaine de boutons visibles en continu, qui repoussaient la question
 * — le geste principal — sous la ligne de flottaison. Il s'ouvre désormais
 * depuis l'une des quatre intentions de la page IA, et se referme dès qu'une
 * action est lancée : la conversation reste le centre.
 *
 * AUCUNE capacité n'a été retirée au passage — les quatre panneaux
 * ci-dessous sont inchangés. Aucun n'invente son propre circuit IA :
 *  - Comprendre  → construit une question et la pose au chat existant
 *    (`onAskChat`), qui la traite avec EXACTEMENT le même pipeline que si
 *    l'étudiant l'avait tapée (`buildContext` → `courseSystemPrompt` →
 *    `aiOrchestrator` → `verifyCourseAnswer`).
 *  - Étudier     → même garantie, mais sur TOUT le chapitre plutôt qu'une
 *    question précise (`studyChapter`, `analyzeChapter`, `summarizeNote`),
 *    le résultat rejoint la même conversation via `onPostExchange`.
 *  - Mémoriser   → flashcards : `generateCardDrafts` + `createFlashcard`,
 *    les mêmes fonctions que la page Flashcards, avec son propre
 *    accepter/modifier/refuser. QCM/Vrai-Faux/Examen probable : un lien
 *    direct vers `/quiz`, jamais une génération parallèle.
 *  - Préparer l'examen → `weakPoints`/`priorityItems`/`core/progress`,
 *    entièrement déterministe, aucun appel IA.
 */

export type AssistantCategory = 'comprendre' | 'etudier' | 'memoriser' | 'examen';
type Category = AssistantCategory;

const CATEGORY_SEGMENTS: Segment<Category>[] = [
  { value: 'comprendre', label: 'Comprendre', icon: '💡' },
  { value: 'etudier', label: 'Étudier', icon: '📖' },
  { value: 'memoriser', label: 'Mémoriser', icon: '🧠' },
  { value: 'examen', label: "Préparer l'examen", icon: '🎯' },
];

export interface AssistantExchangeResult {
  text: string;
  provenance: AnswerProvenance | null;
  citations?: Citation[];
}

export interface AssistantSheetProps {
  open: boolean;
  category: AssistantCategory;
  onCategoryChange: (category: AssistantCategory) => void;
  onClose: () => void;
  subjectId: ID;
  chapterId: ID | 'all';
  chapters: Chapter[];
  program: string;
  onAskChat: (promptText: string) => void;
  onPostExchange: (userText: string, assistant: AssistantExchangeResult) => Promise<void>;
}

const INSUFFICIENT_CHAPTER_TEXT =
  '⚠️ Aucun document indexé dans cette portée. Importe un document avant de pouvoir utiliser cette action.';

const CATEGORY_TITLES: Record<Category, string> = {
  comprendre: 'Comprendre',
  etudier: 'Étudier',
  memoriser: 'Mémoriser',
  examen: "Préparer l'examen",
};

export function AssistantSheet({
  open,
  category,
  onCategoryChange,
  onClose,
  subjectId,
  chapterId,
  chapters,
  program,
  onAskChat,
  onPostExchange,
}: AssistantSheetProps) {
  return (
    <Modal open={open} onClose={onClose} title={CATEGORY_TITLES[category]} size="lg">
      <div className="flex flex-col gap-4" data-assistant-sheet>
        {/* Changer d'intention sans refermer : les quatre groupes restent
            atteignables, mais un seul est déplié à la fois. */}
        <SegmentedControl segments={CATEGORY_SEGMENTS} value={category} onChange={onCategoryChange} size="sm" />

        {category === 'comprendre' && <ComprehendPanel onAskChat={onAskChat} />}
        {category === 'etudier' && (
          <StudyPanel subjectId={subjectId} chapterId={chapterId} chapters={chapters} program={program} onPostExchange={onPostExchange} />
        )}
        {category === 'memoriser' && <MemorizePanel subjectId={subjectId} chapterId={chapterId} />}
        {category === 'examen' && <ExamPrepPanel subjectId={subjectId} chapterId={chapterId} />}
      </div>
    </Modal>
  );
}

// ────────────────────────────── Comprendre ──────────────────────────────

function ComprehendPanel({ onAskChat }: { onAskChat: (promptText: string) => void }) {
  const [action, setAction] = useState<ComprehendAction>('explain');
  const [notion, setNotion] = useState('');
  const [notionB, setNotionB] = useState('');

  const ready = action === 'compare' ? notion.trim().length > 0 && notionB.trim().length > 0 : notion.trim().length > 0;

  return (
    <div className="flex flex-col gap-3" data-assistant-comprehend>
      <div className="flex flex-wrap gap-2">
        {COMPREHEND_ACTIONS.map((entry) => (
          <button
            key={entry.action}
            type="button"
            onClick={() => setAction(entry.action)}
            className={
              'rounded-full border px-3 py-1.5 text-[0.8rem] font-medium transition-colors ' +
              (action === entry.action
                ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-ink)]'
                : 'border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--surface-2)]')
            }
          >
            <span aria-hidden>{entry.icon}</span> {entry.label}
          </button>
        ))}
      </div>

      <Input
        label={action === 'compare' ? 'Première notion' : 'Notion'}
        placeholder="Ex. le nerf trijumeau"
        value={notion}
        onChange={(event) => setNotion(event.target.value)}
        data-assistant-comprehend-notion
      />
      {action === 'compare' && (
        <Input
          label="Deuxième notion"
          placeholder="Ex. le nerf facial"
          value={notionB}
          onChange={(event) => setNotionB(event.target.value)}
          data-assistant-comprehend-notion-b
        />
      )}

      <Button
        disabled={!ready}
        onClick={() => onAskChat(comprehendPrompt(action, notion, notionB))}
        data-assistant-comprehend-ask
      >
        Demander à l’assistant
      </Button>

      <p className="text-[0.78rem] text-[var(--ink-faint)]">
        Pour une question libre (« répondre à une question »), utilise directement le champ de conversation ci-dessous.
      </p>
    </div>
  );
}

// ────────────────────────────── Étudier ──────────────────────────────

function StudyPanel({
  subjectId,
  chapterId,
  chapters,
  program,
  onPostExchange,
}: {
  subjectId: ID;
  chapterId: ID | 'all';
  chapters: Chapter[];
  program: string;
  onPostExchange: (userText: string, assistant: AssistantExchangeResult) => Promise<void>;
}) {
  const { notify } = useToast();
  const [running, setRunning] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<ID | ''>('');
  const notes = useSubjectNotes(subjectId);

  const scopeChapterId = chapterId === 'all' ? null : chapterId;
  const scopeLabel = chapterId === 'all' ? 'toute la matière' : chapters.find((c) => c.id === chapterId)?.name ?? 'ce chapitre';

  const runChapterStudy = async (mode: ChapterStudyMode, key: string, userText: string) => {
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour utiliser l’assistant.', 'error');
      return;
    }
    setRunning(key);
    try {
      const result = await studyChapter({ subjectId, chapterId: scopeChapterId }, mode, program);
      if (!result) {
        await onPostExchange(userText, { text: INSUFFICIENT_CHAPTER_TEXT, provenance: 'insufficient' });
        return;
      }
      await onPostExchange(userText, {
        text: result.verified.text,
        provenance: result.verified.provenance,
        citations: result.verified.citations,
      });
    } catch (error) {
      notify(aiOrchestrator.describeAiError(error), 'error');
    } finally {
      setRunning(null);
    }
  };

  const runNotions = async () => {
    if (chapterId === 'all') {
      notify('Choisis un chapitre précis (Portée, en haut) pour cette action.', 'error');
      return;
    }
    // `analyzeChapter` utilise par défaut le moteur local (aucune clé
    // requise) — voir services/courses/notions.ts. Aucun garde-fou sur la
    // clé API ici : cette action fonctionne sans IA.
    const chapter = chapters.find((c) => c.id === chapterId);
    const userText = `Identifie les notions importantes et difficiles du chapitre « ${chapter?.name ?? ''} ».`;
    setRunning('notions');
    try {
      let analysis = await getChapterAnalysis(chapterId);
      if (!analysis) {
        const chunks = await listChunks({ subjectId, chapterId });
        const lookup: ContextLookup = await loadContextLookup(subjectId);
        const notions = await analyzeChapter({ chunks, lookup });
        analysis = await saveChapterAnalysis(subjectId, chapterId, notions);
      }
      const important = analysis.notions.filter((n) => n.importance === 3);
      const difficult = analysis.notions.filter((n) => n.isPitfall);
      const lines: string[] = [];
      lines.push(
        important.length > 0
          ? `Notions importantes :\n${important.map((n) => `• ${n.label}`).join('\n')}`
          : 'Aucune notion marquée comme essentielle dans ce chapitre.',
      );
      lines.push(
        difficult.length > 0
          ? `Notions difficiles (pièges fréquents) :\n${difficult.map((n) => `• ${n.label}`).join('\n')}`
          : 'Aucun piège fréquent identifié dans ce chapitre.',
      );
      const citations = [...important, ...difficult].flatMap((n) => n.citations).slice(0, 8);
      await onPostExchange(userText, {
        text: lines.join('\n\n'),
        provenance: citations.length > 0 ? 'course' : 'insufficient',
        citations,
      });
    } catch (error) {
      notify(
        error instanceof InsufficientChapterContentError ? error.message : aiOrchestrator.describeAiError(error),
        'error',
      );
    } finally {
      setRunning(null);
    }
  };

  const runNoteSummary = async () => {
    if (!noteId || !notes) return;
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour utiliser l’assistant.', 'error');
      return;
    }
    setRunning('note');
    try {
      const summary = await summarizeNote({ note });
      if (!summary) {
        await onPostExchange(`Résume ma note « ${note.title} ».`, {
          text: '⚠️ Cette note ne permet pas de produire un résumé vérifiable.',
          provenance: 'insufficient',
        });
        return;
      }
      await onPostExchange(`Résume ma note « ${note.title} ».`, {
        text: `${summary.summary}\n\n📝 Basé sur ta note « ${note.title} » : « ${summary.excerpt} »`,
        provenance: 'course',
      });
    } catch (error) {
      notify(
        error instanceof InsufficientNoteContentError ? error.message : aiOrchestrator.describeAiError(error),
        'error',
      );
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-assistant-study>
      <p className="text-[0.78rem] text-[var(--ink-faint)]">Portée actuelle : {scopeLabel}.</p>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={running === 'summary'}
          disabled={running !== null && running !== 'summary'}
          onClick={() => void runChapterStudy('summary', 'summary', `Résume ${scopeLabel === 'toute la matière' ? 'ce cours' : scopeLabel}.`)}
          data-assistant-study-summary
        >
          Résumer ce cours
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={running === 'sheet'}
          disabled={running !== null && running !== 'sheet'}
          onClick={() => void runChapterStudy('sheet', 'sheet', `Prépare une fiche de révision pour ${scopeLabel}.`)}
          data-assistant-study-sheet
        >
          Créer une fiche de révision
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={running === 'notions'}
          disabled={running !== null && running !== 'notions'}
          onClick={() => void runNotions()}
          data-assistant-study-notions
        >
          Notions importantes / difficiles
        </Button>
      </div>

      <div className="border-t border-[var(--line)] pt-3">
        <p className="mb-2 text-[0.85rem] font-medium">Résumer une note</p>
        {notes && notes.length === 0 ? (
          <p className="text-[0.8rem] text-[var(--ink-faint)]">Aucune note dans cette matière pour l’instant.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Select
              value={noteId}
              onChange={(event) => setNoteId(event.target.value)}
              className="min-w-[12rem] flex-1"
              data-assistant-study-note-select
            >
              <option value="">Choisir une note…</option>
              {(notes ?? []).map((note) => (
                <option key={note.id} value={note.id}>
                  {note.title}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              loading={running === 'note'}
              disabled={!noteId || (running !== null && running !== 'note')}
              onClick={() => void runNoteSummary()}
              data-assistant-study-note-summarize
            >
              Résumer
            </Button>
          </div>
        )}
      </div>

      <p className="text-[0.78rem] text-[var(--ink-faint)]">Les réponses apparaissent dans la conversation ci-dessous.</p>
    </div>
  );
}

// ────────────────────────────── Mémoriser ──────────────────────────────

function MemorizePanel({ subjectId, chapterId }: { subjectId: ID; chapterId: ID | 'all' }) {
  const { notify } = useToast();
  const navigate = useNavigate();
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<CardDraft[]>([]);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const scopeChapterId = chapterId === 'all' ? null : chapterId;
  const current = drafts[index];

  const generate = async () => {
    // `generateCardDrafts` utilise par défaut le moteur local (aucune clé
    // requise) — voir services/flashcards/generate.ts. Aucun garde-fou sur
    // la clé API ici : cette action fonctionne sans IA.
    setGenerating(true);
    setDrafts([]);
    setIndex(0);
    try {
      const chunks = await listChunks({ subjectId, chapterId: scopeChapterId });
      const lookup: ContextLookup = await loadContextLookup(subjectId);
      const generated = await generateCardDrafts({ count: 5, importance: 2, difficulty: 2, chunks, lookup });
      if (generated.length === 0) {
        notify("Aucune carte vérifiable n'a pu être proposée à partir de ce contenu.", 'error');
      } else {
        setDrafts(generated);
      }
    } catch (error) {
      notify(
        error instanceof NoIndexedContentError ? error.message : aiOrchestrator.describeAiError(error),
        'error',
      );
    } finally {
      setGenerating(false);
    }
  };

  const accept = async () => {
    if (!current || saving) return;
    setSaving(true);
    try {
      await createFlashcard({
        subjectId,
        chapterId: scopeChapterId,
        question: current.question,
        answer: current.answer,
        importance: current.importance,
        difficulty: current.difficulty,
        origin: 'ai',
        sourceChunkIds: current.sourceChunkIds,
      });
      setIndex((i) => i + 1);
    } finally {
      setSaving(false);
    }
  };

  const reject = () => setIndex((i) => i + 1);

  const quizLink = (format: 'qcm' | 'vf') => {
    const params = new URLSearchParams({ format, count: '10', difficulty: 'mixed' });
    if (scopeChapterId === null) {
      params.set('scope', 'subject');
      params.set('subject', subjectId);
    } else {
      params.set('scope', 'chapter');
      params.set('subject', subjectId);
      params.set('chapter', scopeChapterId);
    }
    navigate(`/quiz?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4" data-assistant-memorize>
      <div>
        <p className="mb-2 text-[0.85rem] font-medium">Proposer des flashcards</p>
        <p className="mb-2 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
          Rien n’est enregistré tant que tu n’as pas accepté chaque carte — tu peux la modifier avant, ou la refuser.
        </p>
        <Button size="sm" loading={generating} onClick={() => void generate()} data-assistant-memorize-generate>
          {generating ? 'Analyse du cours et génération…' : '✨ Proposer 5 flashcards'}
        </Button>

        {current && (
          <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--accent)] bg-[var(--accent-tint)] p-4" data-assistant-memorize-draft key={index}>
            <p className="text-[0.74rem] font-medium text-[var(--ink-faint)]">
              Proposition {index + 1}/{drafts.length}
            </p>
            <Textarea
              label="Question"
              rows={2}
              value={current.question}
              onChange={(event) => setDrafts((list) => list.map((d, i) => (i === index ? { ...d, question: event.target.value } : d)))}
            />
            <Textarea
              label="Réponse"
              rows={3}
              value={current.answer}
              onChange={(event) => setDrafts((list) => list.map((d, i) => (i === index ? { ...d, answer: event.target.value } : d)))}
            />
            <p className="mt-1 text-[0.74rem] text-[var(--ink-faint)]">
              📚 {current.citations[0]?.documentName}
              {current.citations[0]?.page !== null && current.citations[0]?.page !== undefined ? ` — page ${current.citations[0].page}` : ''}
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" loading={saving} onClick={() => void accept()} data-assistant-memorize-accept>
                ✓ Accepter
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={reject} data-assistant-memorize-reject>
                ✕ Refuser
              </Button>
            </div>
          </div>
        )}

        {drafts.length > 0 && index >= drafts.length && (
          <p className="mt-3 text-[0.82rem] text-[var(--ink-soft)]">Toutes les propositions ont été traitées.</p>
        )}
      </div>

      <div className="border-t border-[var(--line)] pt-3">
        <p className="mb-2 text-[0.85rem] font-medium">Se tester</p>
        <p className="mb-2 text-[0.78rem] text-[var(--ink-faint)]">
          Ouvre le Quiz existant, déjà réglé sur cette portée.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => quizLink('qcm')} data-assistant-memorize-qcm>
            Lancer un QCM
          </Button>
          <Button size="sm" variant="secondary" onClick={() => quizLink('vf')} data-assistant-memorize-vf>
            Lancer un Vrai/Faux
          </Button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── Préparer l'examen ──────────────────────────────

function ExamPrepPanel({ subjectId, chapterId }: { subjectId: ID; chapterId: ID | 'all' }) {
  const navigate = useNavigate();
  const source = useProgress();

  if (!source) return null;

  const { subjects, chapters, cards, logs, events } = source.tables;
  const now = new Date(source.loadedAt);
  const weak = weakPoints(subjects, chapters, cards, logs, 5);
  const evaluations = upcomingEvaluations(events, subjects, now);
  const priorities = priorityItems(subjects, chapters, cards, logs, evaluations, now, 5);
  const recommendation = mainRecommendation(priorities);
  const nextExam = evaluations.find((e) => e.subjectId === subjectId) ?? null;

  const examLikelyLink = () => {
    const params = new URLSearchParams({ scope: 'exam-likely', subject: subjectId, format: 'mixed', count: '10' });
    if (chapterId !== 'all') params.set('chapter', chapterId);
    if (nextExam) params.set('evaluation', nextExam.event.id);
    navigate(`/quiz?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4" data-assistant-examprep>
      <div>
        <p className="mb-2 text-[0.85rem] font-medium">Points faibles réellement mesurés</p>
        {weak.length === 0 ? (
          <p className="text-[0.8rem] text-[var(--ink-faint)]">
            Pas encore assez de réponses enregistrées pour identifier un point faible.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-assistant-examprep-weak>
            {weak.map((point) => (
              <li key={point.id} className="text-[0.82rem] text-[var(--ink-soft)]">
                • {point.title} — {Math.round(point.successRate * 100)}% de réussite ({point.subjectName})
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--line)] pt-3">
        <p className="mb-2 text-[0.85rem] font-medium">Notions prioritaires</p>
        {recommendation ? (
          <div data-assistant-examprep-priority>
            <p className="text-[0.85rem] font-semibold">{recommendation.title}</p>
            <p className="mt-1 text-[0.82rem] text-[var(--ink-soft)]">{recommendation.body}</p>
          </div>
        ) : (
          <p className="text-[0.8rem] text-[var(--ink-faint)]">Rien à prioriser pour l’instant.</p>
        )}
      </div>

      <div className="border-t border-[var(--line)] pt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => navigate('/calendrier?plan=week')} data-assistant-examprep-plan>
          Préparer une session de révision
        </Button>
        <Button size="sm" variant="secondary" onClick={examLikelyLink} data-assistant-examprep-examlikely>
          Examen probable
        </Button>
      </div>
    </div>
  );
}
