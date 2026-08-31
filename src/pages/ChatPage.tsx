import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp } from '@/components/motion/Motion';
import {
  Button,
  EmptyState,
  Icon,
  Input,
  SegmentedControl,
  Select,
  Spinner,
  useToast,
} from '@/components/ui';
import { ChatMessageView } from '@/components/features/chat/ChatMessageView';
import { useChapters, useSubjects } from '@/hooks/useSubjects';
import { useProfile } from '@/hooks/useProfile';
import { db } from '@/data/db';
import { appendChatMessage, clearChat } from '@/data/repositories/chat';
import { listChunks } from '@/data/repositories/documents';
import { bm25Retriever, buildContext, type ContextLookup } from '@/services/rag/retrieval';
import {
  courseSystemPrompt,
  internetSystemPrompt,
  verifyCourseAnswer,
  verifyInternetAnswer,
} from '@/services/ai/tutor';
import { ask, describeAiError } from '@/services/ai/client';
import { hasApiKey } from '@/services/ai/settings';
import type { ChatMessage, ID } from '@/types';

type Mode = 'cours' | 'internet';

/** Nombre de fragments transmis au modèle. */
const RETRIEVAL_LIMIT = 8;

const MODES = [
  { value: 'cours' as const, label: 'Mes cours', icon: '📚' },
  { value: 'internet' as const, label: 'Internet', icon: '🌐' },
];

export function ChatPage() {
  const subjects = useSubjects();
  const profile = useProfile();
  const { notify } = useToast();

  const [subjectId, setSubjectId] = useState<ID | ''>('');
  const [chapterId, setChapterId] = useState<ID | 'all'>('all');
  const [mode, setMode] = useState<Mode>('cours');
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [streamed, setStreamed] = useState('');

  const chapters = useChapters(subjectId || undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Sélectionne la première matière dès qu'elles sont chargées.
  useEffect(() => {
    if (!subjectId && subjects && subjects.length > 0) setSubjectId(subjects[0]!.id);
  }, [subjects, subjectId]);

  // Le chapitre choisi doit toujours appartenir à la matière courante.
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

  const handleSend = async () => {
    const trimmed = question.trim();
    if (trimmed.length === 0 || !subjectId || pending) return;

    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour utiliser l’assistant.', 'error');
      return;
    }

    setQuestion('');
    setStreamed('');
    setPending(trimmed);
    await appendChatMessage({ subjectId, role: 'user', text: trimmed });

    try {
      // 1. Récupération : uniquement dans la portée choisie.
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

      // 2. Court-circuit : sans le moindre extrait pertinent, interroger le
      // modèle ne pourrait produire qu'une réponse invérifiable. On économise
      // l'appel et on répond honnêtement.
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

      // 3. Interrogation du modèle.
      const program = profile.program || 'dentisterie';
      const raw = await ask({
        system:
          mode === 'cours'
            ? courseSystemPrompt(context, program)
            : internetSystemPrompt(context, program),
        prompt: trimmed,
        webSearch: mode === 'internet',
        onText: mode === 'cours' ? (delta) => setStreamed((current) => current + delta) : undefined,
      });

      // 4. Vérification : c'est ici que la provenance est établie.
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
        text: describeAiError(error),
        provenance: 'error',
      });
    } finally {
      setPending(null);
      setStreamed('');
    }
  };

  if (subjects && subjects.length === 0) {
    return (
      <PageTransition>
        <PageHeader title="Assistant IA" />
        <EmptyState
          icon={<Icon name="ai" size={30} />}
          title="Importe d’abord un cours"
          description="L’assistant répond uniquement à partir de tes propres documents. Crée une matière, ajoute un chapitre et importe un PDF — il pourra alors le citer précisément."
          action={
            <Link to="/cours">
              <Button>Aller aux cours</Button>
            </Link>
          }
        />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <PageHeader
        title="Assistant IA"
        subtitle="Il répond à partir de tes cours et cite ses sources. Ce qu’il ne peut pas prouver, il ne l’affirme pas."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Select
          label="Matière"
          value={subjectId}
          onChange={(event) => setSubjectId(event.target.value)}
        >
          {(subjects ?? []).map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </Select>
        <Select
          label="Portée"
          value={chapterId}
          onChange={(event) => setChapterId(event.target.value as ID | 'all')}
        >
          <option value="all">Toute la matière</option>
          {(chapters ?? []).map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl segments={MODES} value={mode} onChange={setMode} size="sm" />
        {messages && messages.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (subjectId) await clearChat(subjectId);
            }}
          >
            Effacer la conversation
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {messages?.map((message) => <ChatMessageView key={message.id} message={message} />)}

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

        {messages?.length === 0 && !pending && (
          <EmptyState
            icon={<Icon name="ai" size={30} />}
            title="Pose ta première question"
            description={
              <>
                Par exemple : « Quelle est l’innervation du masséter ? ». En mode{' '}
                <strong>Mes cours</strong>, chaque affirmation sera rattachée à un passage précis de
                tes documents — et si l’information n’y est pas, l’assistant te le dira au lieu de
                l’inventer.
              </>
            }
          />
        )}

        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-24 z-10 mt-5 flex gap-2 md:bottom-6">
        <Input
          value={question}
          placeholder={
            mode === 'cours' ? 'Une question sur tes cours…' : 'Une question, cours + internet…'
          }
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          loading={pending !== null}
          disabled={question.trim().length === 0}
          onClick={handleSend}
        >
          Envoyer
        </Button>
      </div>
    </PageTransition>
  );
}
