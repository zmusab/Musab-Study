import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageTransition } from '@/components/layout/PageTransition';
import { FadeUp } from '@/components/motion/Motion';
import { Button, EmptyState, Icon, Input, Spinner, useToast } from '@/components/ui';
import { ChatMessageView, type AnswerAction } from '@/components/features/chat/ChatMessageView';
import { AssistantSheet, type AssistantCategory, type AssistantExchangeResult } from '@/components/features/assistant/AssistantSheet';
import { useChapters, useSubjects } from '@/hooks/useSubjects';
import { useProfile } from '@/hooks/useProfile';
import { db } from '@/data/db';
import { appendChatMessage, clearChat } from '@/data/repositories/chat';
import { createNote } from '@/data/repositories/notes';
import { listChunks } from '@/data/repositories/documents';
import { bm25Retriever, buildContext, type ContextLookup } from '@/services/rag/retrieval';
import {
  courseSystemPrompt,
  internetSystemPrompt,
  verifyCourseAnswer,
  verifyInternetAnswer,
} from '@/services/ai/tutor';
import { aiOrchestrator, resolveProviderChoice } from '@/services/ai/orchestrator';
import { getPreferredProvider, hasApiKey, setPreferredProvider, type PreferredProvider } from '@/services/ai/settings';
import { cn } from '@/lib/cn';
import type { ChatMessage, ID } from '@/types';

/**
 * IA — une page, une conversation.
 *
 * Tout ce qui n'est pas « poser une question » est SECONDAIRE et le reste
 * visuellement : quatre intentions ouvrent le reste des actions à la
 * demande (`AssistantSheet`), la source et l'assistant tiennent sur une
 * ligne discrète. Aucune capacité n'a disparu — elles sont regroupées.
 */

type Mode = 'cours' | 'internet';

/** Nombre de fragments transmis au modèle. */
const RETRIEVAL_LIMIT = 8;

const INTENTS: { category: AssistantCategory; label: string; icon: string }[] = [
  { category: 'comprendre', label: 'Comprendre', icon: '🧠' },
  { category: 'etudier', label: 'Étudier', icon: '📚' },
  { category: 'memoriser', label: 'Mémoriser', icon: '🎴' },
  { category: 'examen', label: "Préparer l'examen", icon: '🎯' },
];

const ASSISTANT_OPTIONS: { value: PreferredProvider; label: string }[] = [
  { value: 'auto', label: 'Automatique' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'openai', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
];

export function ChatPage() {
  const subjects = useSubjects();
  const profile = useProfile();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const [subjectId, setSubjectId] = useState<ID | ''>('');
  const [chapterId, setChapterId] = useState<ID | 'all'>('all');
  const [mode, setMode] = useState<Mode>('cours');
  const [question, setQuestion] = useState(() => searchParams.get('prompt') ?? '');
  const [pending, setPending] = useState<string | null>(null);
  const [streamed, setStreamed] = useState('');
  const [assistant, setAssistant] = useState<PreferredProvider>(getPreferredProvider);
  const [sheet, setSheet] = useState<AssistantCategory | null>(null);

  const chapters = useChapters(subjectId || undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Sélectionne la première matière dès qu'elles sont chargées.
  useEffect(() => {
    if (!subjectId && subjects && subjects.length > 0) setSubjectId(subjects[0]!.id);
  }, [subjects, subjectId]);

  // Une question passée depuis l'accueil pré-remplit le champ plutôt que
  // d'être envoyée seule : la matière n'est pas encore choisie à ce stade.
  useEffect(() => {
    const prompt = searchParams.get('prompt');
    if (prompt) {
      setQuestion(prompt);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setChapterId('all');
  }, [subjectId]);

  const messages = useLiveQuery(async () => {
    if (!subjectId) return [] as ChatMessage[];
    const list = await db.chatMessages.where('subjectId').equals(subjectId).toArray();
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [subjectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamed]);

  const scopeLabel = useMemo(() => {
    if (chapterId === 'all') return 'toute la matière';
    return chapters?.find((chapter) => chapter.id === chapterId)?.name ?? 'ce chapitre';
  }, [chapterId, chapters]);

  /**
   * Le mode Internet exige un fournisseur capable de CHERCHER sur le web —
   * une seule intégration l'est réellement aujourd'hui. Plutôt que de
   * laisser l'étudiant découvrir l'échec après avoir écrit sa question, on le
   * dit ici, avant l'envoi (voir aussi `taskRouter`, qui refuse la tâche).
   */
  const internetBlocked = useMemo(() => {
    if (mode !== 'internet') return null;
    const choice = resolveProviderChoice('chat-internet');
    if (!choice.providerId || choice.providerId === 'anthropic') return null;
    const label = ASSISTANT_OPTIONS.find((option) => option.value === choice.providerId)?.label ?? choice.providerId;
    return `${label} ne sait pas chercher sur le web. Choisis Claude ou Automatique pour ce mode.`;
  }, [mode, assistant]);

  const handleSend = async (overrideText?: string) => {
    const trimmed = (overrideText ?? question).trim();
    if (trimmed.length === 0 || !subjectId || pending) return;

    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour utiliser l’assistant.', 'error');
      return;
    }

    if (!overrideText) setQuestion('');
    setStreamed('');
    setPending(trimmed);
    await appendChatMessage({ subjectId, role: 'user', text: trimmed });

    try {
      const chunks = await listChunks({
        subjectId,
        chapterId: chapterId === 'all' ? null : chapterId,
      });
      const scored = bm25Retriever.retrieve(trimmed, chunks, RETRIEVAL_LIMIT);

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

      // Sans le moindre extrait pertinent, interroger le modèle ne pourrait
      // produire qu'une réponse invérifiable : on économise l'appel.
      if (mode === 'cours' && context.sources.length === 0) {
        await appendChatMessage({
          subjectId,
          role: 'assistant',
          text:
            '⚠️ Aucun passage de tes cours ne correspond à cette question.\n\n' +
            `Portée interrogée : ${scopeLabel}. Essaie d’élargir à toute la matière, de reformuler avec les termes du cours, ou d’importer le document concerné.`,
          provenance: 'insufficient',
        });
        return;
      }

      const program = profile.program || 'dentisterie';
      const raw = await aiOrchestrator.ask({
        system:
          mode === 'cours'
            ? courseSystemPrompt(context, program)
            : internetSystemPrompt(context, program),
        prompt: trimmed,
        webSearch: mode === 'internet',
        onText: mode === 'cours' ? (delta) => setStreamed((current) => current + delta) : undefined,
        task: mode === 'cours' ? 'chat-course' : 'chat-internet',
      });

      const verified =
        mode === 'cours' ? verifyCourseAnswer(raw, context) : verifyInternetAnswer(raw, context);

      if (verified.invalidReferences.length > 0) {
        notify(
          `${verified.invalidReferences.length} source(s) citée(s) par l’IA n’existaient pas et ont été retirées.`,
          'info',
        );
      }

      await appendChatMessage({
        subjectId,
        role: 'assistant',
        text: verified.text,
        provenance: verified.provenance,
        citations: verified.citations,
      });
    } catch (error) {
      await appendChatMessage({
        subjectId,
        role: 'assistant',
        text: aiOrchestrator.describeAiError(error),
        provenance: 'error',
      });
    } finally {
      setPending(null);
      setStreamed('');
    }
  };

  /**
   * Actions proposées sous la dernière réponse. Chacune REPREND une
   * fonctionnalité existante — la page Flashcards, le Quiz, les Notes — au
   * lieu d'en refaire une variante ici.
   */
  const answerActions = (text: string): AnswerAction[] => {
    if (!subjectId) return [];
    const scopedChapterId = chapterId === 'all' ? null : chapterId;
    return [
      {
        label: '🧠 Créer des flashcards',
        onClick: () => navigate(`/flashcards?subject=${subjectId}`),
      },
      {
        label: '📝 Créer un quiz',
        onClick: () => {
          const params = new URLSearchParams({ format: 'mixed', count: '10', subject: subjectId });
          if (scopedChapterId) {
            params.set('scope', 'chapter');
            params.set('chapter', scopedChapterId);
          } else {
            params.set('scope', 'subject');
          }
          navigate(`/quiz?${params.toString()}`);
        },
      },
      {
        label: '📚 Ajouter aux notes',
        onClick: () => {
          void createNote({
            subjectId,
            chapterId: scopedChapterId,
            title: `Réponse de l’assistant — ${new Date().toLocaleDateString('fr-FR')}`,
            text,
          }).then(() => notify('Réponse enregistrée dans tes notes.', 'success'));
        },
      },
    ];
  };

  /** Les actions « Étudier » écrivent dans la MÊME conversation que le chat. */
  const postExchange = async (userText: string, assistantMessage: AssistantExchangeResult) => {
    if (!subjectId) return;
    await appendChatMessage({ subjectId, role: 'user', text: userText });
    await appendChatMessage({
      subjectId,
      role: 'assistant',
      text: assistantMessage.text,
      provenance: assistantMessage.provenance,
      citations: assistantMessage.citations ?? [],
    });
  };

  if (subjects && subjects.length === 0) {
    return (
      <PageTransition>
        <h1 className="text-[1.75rem] leading-tight">IA</h1>
        <div className="mt-6">
          <EmptyState
            icon={<Icon name="ai" size={30} />}
            title="Importe d’abord un cours"
            description="L’assistant répond à partir de tes propres documents. Crée une matière, ajoute un chapitre et importe un PDF — il pourra alors le citer précisément."
            action={
              <Link to="/cours">
                <Button>Aller aux cours</Button>
              </Link>
            }
          />
        </div>
      </PageTransition>
    );
  }

  const conversationEmpty = messages?.length === 0;

  return (
    <PageTransition>
      <div className="mx-auto flex w-full max-w-[46rem] flex-col">
        <h1 className="text-[1.75rem] leading-tight">IA</h1>
        <p className="mt-1 text-[0.95rem] text-[var(--ink-soft)]">
          {profile.name ? `Bonjour ${profile.name}, que veux-tu travailler ?` : 'Que veux-tu travailler ?'}
        </p>

        {/* Quatre intentions. Tout le reste des actions vit derrière elles. */}
        <div className="mt-4 flex flex-wrap gap-2" data-ai-intents>
          {INTENTS.map((intent) => (
            <button
              key={intent.category}
              type="button"
              onClick={() => setSheet(intent.category)}
              data-touch-target
              data-ai-intent={intent.category}
              className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-[0.85rem] font-medium transition-colors hover:bg-[var(--surface-2)] [-webkit-tap-highlight-color:transparent]"
            >
              <span aria-hidden>{intent.icon}</span> {intent.label}
            </button>
          ))}
        </div>

        {/* Le champ de question, toujours au même endroit, jamais à chercher. */}
        <div className="mt-4 flex gap-2">
          <Input
            value={question}
            placeholder={mode === 'cours' ? 'Une question sur tes cours…' : 'Une question, cours + internet…'}
            className="flex-1"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            data-ai-question
          />
          <Button loading={pending !== null} disabled={question.trim().length === 0} onClick={() => void handleSend()}>
            Envoyer
          </Button>
        </div>

        {/* Source, portée, assistant : une seule ligne, volontairement sobre. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--line)] pt-3 text-[0.82rem]">
          <div className="flex gap-1" role="group" aria-label="Source des réponses">
            {(['cours', 'internet'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                data-touch-target
                data-ai-source={value}
                className={cn(
                  'rounded-full px-3 py-1.5 font-medium transition-colors [-webkit-tap-highlight-color:transparent]',
                  mode === value
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--ink-soft)] hover:bg-[var(--surface-2)]',
                )}
              >
                {value === 'cours' ? '📚 Mes cours' : '🌐 Internet'}
              </button>
            ))}
          </div>

          <span className="text-[var(--ink-faint)]" aria-hidden>
            ·
          </span>

          <select
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            aria-label="Matière"
            data-ai-subject
            className="max-w-[10rem] truncate bg-transparent text-[var(--ink-soft)] outline-none"
          >
            {(subjects ?? []).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>

          <select
            value={chapterId}
            onChange={(event) => setChapterId(event.target.value as ID | 'all')}
            aria-label="Portée"
            data-ai-scope
            className="max-w-[10rem] truncate bg-transparent text-[var(--ink-soft)] outline-none"
          >
            <option value="all">Toute la matière</option>
            {(chapters ?? []).map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.name}
              </option>
            ))}
          </select>

          <select
            value={assistant}
            onChange={(event) => {
              const value = event.target.value as PreferredProvider;
              setAssistant(value);
              setPreferredProvider(value);
            }}
            aria-label="Assistant"
            data-ai-assistant
            className="ml-auto bg-transparent text-[var(--ink-soft)] outline-none"
          >
            {ASSISTANT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Assistant : {option.label}
              </option>
            ))}
          </select>
        </div>

        {internetBlocked && (
          <p
            className="mt-2 rounded-[var(--radius-control)] border border-[var(--warning)] bg-[var(--warning-tint)] px-3.5 py-2.5 text-[0.8rem] leading-relaxed"
            data-ai-internet-blocked
          >
            {internetBlocked}
          </p>
        )}

        {/* ────────────── La conversation ────────────── */}
        <div className="mt-6 flex flex-col gap-4">
          {!conversationEmpty && (
            <div className="flex items-center justify-between">
              <h2 className="text-[0.85rem] font-semibold text-[var(--ink-faint)]">Conversation</h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (subjectId) await clearChat(subjectId);
                }}
              >
                Effacer
              </Button>
            </div>
          )}

          {messages?.map((message, index) => (
            <ChatMessageView
              key={message.id}
              message={message}
              // Seulement sous la DERNIÈRE réponse : proposer de reprendre un
              // échange déjà enfoui n'a pas de sens, et répéter trois boutons
              // sous chaque message reconstituerait l'encombrement qu'on vient
              // de retirer.
              actions={index === (messages?.length ?? 0) - 1 ? answerActions(message.text) : undefined}
            />
          ))}

          {pending && (
            <FadeUp className="max-w-[94%]">
              <div className="surface-card whitespace-pre-wrap px-4 py-3 text-[0.92rem] leading-relaxed">
                {streamed.length > 0 ? (
                  streamed
                ) : (
                  <span className="flex items-center gap-2 text-[var(--ink-soft)]">
                    <Spinner size={14} />
                    {mode === 'internet' ? 'Recherche internet…' : 'Lecture de tes cours…'}
                  </span>
                )}
              </div>
            </FadeUp>
          )}

          {conversationEmpty && !pending && (
            <p className="text-[0.85rem] leading-relaxed text-[var(--ink-faint)]">
              Par exemple : « Quelle est l’innervation du masséter ? ». En mode <strong>Mes cours</strong>, chaque
              affirmation est rattachée à un passage précis de tes documents — et si l’information n’y est pas,
              l’assistant le dit au lieu de l’inventer.
            </p>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {subjectId && (
        <AssistantSheet
          open={sheet !== null}
          category={sheet ?? 'comprendre'}
          onCategoryChange={setSheet}
          onClose={() => setSheet(null)}
          subjectId={subjectId}
          chapterId={chapterId}
          chapters={chapters ?? []}
          program={profile.program || 'dentisterie'}
          onAskChat={(promptText) => {
            setSheet(null);
            void handleSend(promptText);
          }}
          onPostExchange={async (userText, result) => {
            setSheet(null);
            await postExchange(userText, result);
          }}
        />
      )}
    </PageTransition>
  );
}
