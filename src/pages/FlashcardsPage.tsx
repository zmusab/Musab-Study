import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp, Stagger, StaggerItem } from '@/components/motion/Motion';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  Input,
  Select,
  Textarea,
  useConfirm,
  useToast,
} from '@/components/ui';
import { useChapters, useSubjects } from '@/hooks/useSubjects';
import { useFlashcards } from '@/hooks/useFlashcards';
import { db } from '@/data/db';
import { createFlashcard, deleteCard, updateCard } from '@/data/repositories/cards';
import { listChunks } from '@/data/repositories/documents';
import { generateCardDrafts, NoIndexedContentError } from '@/services/flashcards/generate';
import { hasApiKey } from '@/services/ai/settings';
import { describeAiError } from '@/services/ai/client';
import { masteryLevel, masteryPct, MASTERY_COLOR_VARS, MASTERY_LABELS } from '@/core/mastery';
import { springSoft } from '@/components/motion/transitions';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { CardDraft } from '@/services/flashcards/validate';
import type { Difficulty, Flashcard, ID, Importance } from '@/types';

const COUNT_OPTIONS = [5, 8, 12] as const;

export function FlashcardsPage() {
  const subjects = useSubjects();
  const { notify } = useToast();
  const confirm = useConfirm();
  const reduced = useReducedMotion();

  const [subjectId, setSubjectId] = useState<ID | ''>('');
  const [chapterId, setChapterId] = useState<ID | 'all'>('all');
  const [filterChapterId, setFilterChapterId] = useState<ID | 'all'>('all');
  const [count, setCount] = useState<(typeof COUNT_OPTIONS)[number]>(8);
  const [importance, setImportance] = useState<Importance>(2);
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<CardDraft[]>([]);
  const [draftIndex, setDraftIndex] = useState(0);
  const [manualQuestion, setManualQuestion] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');
  const [manualChapterId, setManualChapterId] = useState<ID | ''>('');
  const [search, setSearch] = useState('');

  const chapters = useChapters(subjectId || undefined);
  const cards = useFlashcards(subjectId || undefined);

  useEffect(() => {
    if (!subjectId && subjects && subjects.length > 0) setSubjectId(subjects[0]!.id);
  }, [subjects, subjectId]);

  useEffect(() => {
    setChapterId('all');
    setFilterChapterId('all');
    setManualChapterId('');
    setDrafts([]);
  }, [subjectId]);

  const chapterName = (id: ID | null) => chapters?.find((c) => c.id === id)?.name ?? '';

  const filteredCards = useMemo(() => {
    if (!cards) return [];
    const term = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (filterChapterId !== 'all' && card.chapterId !== filterChapterId) return false;
      if (term.length === 0) return true;
      return card.question.toLowerCase().includes(term) || card.answer.toLowerCase().includes(term);
    });
  }, [cards, filterChapterId, search]);

  const handleGenerate = async () => {
    if (!subjectId) return;
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour générer des cartes.', 'error');
      return;
    }

    setGenerating(true);
    setDrafts([]);
    setDraftIndex(0);
    try {
      const scopeChapterId = chapterId === 'all' ? null : chapterId;
      const chunks = await listChunks({ subjectId, chapterId: scopeChapterId });

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

      const generated = await generateCardDrafts({
        count,
        importance,
        difficulty,
        chunks,
        lookup,
      });

      if (generated.length === 0) {
        notify(
          "L'IA n'a proposé aucune carte vérifiable à partir de ce contenu. Essaie une autre portée.",
          'error',
        );
      } else {
        setDrafts(generated);
        notify(`${generated.length} carte(s) proposée(s) — accepte, modifie ou supprime.`, 'success');
      }
    } catch (error) {
      notify(
        error instanceof NoIndexedContentError ? error.message : describeAiError(error),
        'error',
      );
    } finally {
      setGenerating(false);
    }
  };

  const currentDraft = drafts[draftIndex];

  const handleAcceptDraft = async () => {
    if (!subjectId || !currentDraft) return;
    const scopeChapterId = chapterId === 'all' ? null : chapterId;
    await createFlashcard({
      subjectId,
      chapterId: scopeChapterId,
      question: currentDraft.question,
      answer: currentDraft.answer,
      importance: currentDraft.importance,
      difficulty: currentDraft.difficulty,
      origin: 'ai',
      sourceChunkIds: currentDraft.sourceChunkIds,
    });
    setDraftIndex((i) => i + 1);
  };

  const handleRejectDraft = () => setDraftIndex((i) => i + 1);

  const handleManualCreate = async () => {
    if (!subjectId) return;
    if (manualQuestion.trim().length === 0 || manualAnswer.trim().length === 0) {
      notify('Question et réponse requises.', 'error');
      return;
    }
    await createFlashcard({
      subjectId,
      chapterId: manualChapterId || null,
      question: manualQuestion,
      answer: manualAnswer,
      origin: 'manual',
    });
    setManualQuestion('');
    setManualAnswer('');
    notify('Carte ajoutée.', 'success');
  };

  const handleDelete = async (card: Flashcard) => {
    const ok = await confirm({
      title: 'Supprimer cette carte ?',
      description: 'Son historique de révision sera supprimé avec elle.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!ok) return;
    await deleteCard(card.id);
    notify('Carte supprimée.', 'info');
  };

  if (subjects && subjects.length === 0) {
    return (
      <PageTransition>
        <PageHeader title="Flashcards" />
        <EmptyState
          icon={<Icon name="cards" size={30} />}
          title="Importe d’abord un cours"
          description="Les flashcards se génèrent à partir de tes documents. Crée une matière et ajoute un document avant d’en générer."
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
        title="Flashcards"
        subtitle="Générées depuis tes cours, sourcées, ou créées à la main."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Select label="Matière" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {(subjects ?? []).map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </Select>
        <Select
          label="Portée"
          value={chapterId}
          onChange={(e) => setChapterId(e.target.value as ID | 'all')}
        >
          <option value="all">Toute la matière</option>
          {(chapters ?? []).map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.name}
            </option>
          ))}
        </Select>
      </div>

      <Card className="mb-6">
        <h2 className="mb-4 text-[1.05rem]">✨ Générer avec l’IA</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Nombre"
            value={count}
            onChange={(e) =>
              setCount(Number(e.target.value) as (typeof COUNT_OPTIONS)[number])
            }
          >
            {COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} cartes
              </option>
            ))}
          </Select>
          <Select
            label="Importance"
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value) as Importance)}
          >
            <option value={1}>Normale</option>
            <option value={2}>Importante</option>
            <option value={3}>Examen</option>
          </Select>
          <Select
            label="Difficulté"
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value) as Difficulty)}
          >
            <option value={1}>Facile</option>
            <option value={2}>Moyenne</option>
            <option value={3}>Difficile</option>
          </Select>
        </div>
        <Button className="mt-4" loading={generating} onClick={handleGenerate} block>
          ✨ Générer {count} cartes
        </Button>

        <AnimatePresence mode="wait">
          {currentDraft && (
            <motion.div
              key={draftIndex}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
              transition={springSoft}
              className="mt-5 rounded-[var(--radius-card)] border border-[var(--accent)] bg-[var(--accent-tint)] p-4"
            >
              <Chip>
                Carte {draftIndex + 1}/{drafts.length}
              </Chip>
              <input
                className="mt-2 w-full bg-transparent text-[0.98rem] font-semibold outline-none"
                value={currentDraft.question}
                onChange={(e) =>
                  setDrafts((list) =>
                    list.map((d, i) => (i === draftIndex ? { ...d, question: e.target.value } : d)),
                  )
                }
              />
              <textarea
                className="mt-2 w-full resize-y bg-transparent text-[0.9rem] leading-relaxed outline-none"
                rows={3}
                value={currentDraft.answer}
                onChange={(e) =>
                  setDrafts((list) =>
                    list.map((d, i) => (i === draftIndex ? { ...d, answer: e.target.value } : d)),
                  )
                }
              />
              <p className="mt-2 text-[0.74rem] text-[var(--ink-faint)]">
                📚 {currentDraft.citations[0]?.documentName}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={handleAcceptDraft}>
                  ✅ Accepter
                </Button>
                <Button size="sm" variant="ghost" onClick={handleRejectDraft}>
                  ❌ Supprimer
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {drafts.length > 0 && draftIndex >= drafts.length && (
          <FadeUp className="mt-4 text-center text-[0.85rem] text-[var(--ink-soft)]">
            Toutes les cartes proposées ont été traitées.
          </FadeUp>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-4 text-[1.05rem]">Créer une carte manuellement</h2>
        <div className="flex flex-col gap-3">
          <Input
            label="Question"
            value={manualQuestion}
            onChange={(e) => setManualQuestion(e.target.value)}
          />
          <Textarea
            label="Réponse"
            rows={3}
            value={manualAnswer}
            onChange={(e) => setManualAnswer(e.target.value)}
          />
          <Select
            label="Chapitre"
            value={manualChapterId}
            onChange={(e) => setManualChapterId(e.target.value)}
          >
            <option value="">Aucun</option>
            {(chapters ?? []).map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={handleManualCreate}>
            Ajouter la carte
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-[1.05rem]">Bibliothèque ({cards?.length ?? 0})</h2>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={filterChapterId} onChange={(e) => setFilterChapterId(e.target.value as ID | 'all')}>
            <option value="all">Tous les chapitres</option>
            {(chapters ?? []).map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.name}
              </option>
            ))}
          </Select>
        </div>

        {filteredCards.length === 0 ? (
          <EmptyState
            icon={<Icon name="cards" size={26} />}
            title="Aucune carte"
            description="Génère des cartes avec l’IA ci-dessus, ou ajoute-en une manuellement."
          />
        ) : (
          <Stagger className="flex flex-col gap-3">
            {filteredCards.map((card) => {
              const level = masteryLevel(card);
              const pct = masteryPct(card);
              return (
                <StaggerItem key={card.id}>
                  <div className="rounded-[var(--radius-control)] border border-[var(--line)] p-3.5">
                    <input
                      className="w-full bg-transparent text-[0.92rem] font-semibold outline-none"
                      defaultValue={card.question}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== card.question) {
                          void updateCard(card.id, { question: e.target.value.trim() });
                        }
                      }}
                    />
                    <textarea
                      className="mt-1.5 w-full resize-y bg-transparent text-[0.85rem] leading-relaxed text-[var(--ink-soft)] outline-none"
                      rows={2}
                      defaultValue={card.answer}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== card.answer) {
                          void updateCard(card.id, { answer: e.target.value.trim() });
                        }
                      }}
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip color={MASTERY_COLOR_VARS[level]}>
                          {MASTERY_LABELS[level]} · {pct}%
                        </Chip>
                        {card.chapterId && <Chip>{chapterName(card.chapterId)}</Chip>}
                        {card.origin === 'ai' && <Chip>✨ IA</Chip>}
                      </div>
                      <Button size="sm" variant="danger" onClick={() => handleDelete(card)}>
                        Suppr.
                      </Button>
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </Card>
    </PageTransition>
  );
}
