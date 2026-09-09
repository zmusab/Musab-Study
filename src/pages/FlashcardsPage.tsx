import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp, Stagger, StaggerItem } from '@/components/motion/Motion';
import { WisdomQuote } from '@/components/features/misc/WisdomQuote';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  Input,
  SegmentedControl,
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
import { aiOrchestrator } from '@/services/ai/orchestrator';
import { masteryStatus, MASTERY_COLOR_VARS } from '@/core/mastery';
import { springSoft } from '@/components/motion/transitions';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { CardDraft } from '@/services/flashcards/validate';
import type { Difficulty, Flashcard, ID, Importance } from '@/types';
import { agree, plural } from '@/lib/plural';

const COUNT_OPTIONS = [5, 8, 12] as const;

/**
 * Action SECONDAIRE : un lien, pas un bouton. Trois `Button` alignés sous le
 * bouton principal se lisent comme trois choix de même importance — c'est
 * exactement ce que cette page reprochait à sa version précédente. La
 * hiérarchie visuelle porte ici l'information : un seul geste compte, les
 * autres sont des replis.
 */
function SubtleAction({
  children,
  expanded,
  disabled,
  onClick,
}: {
  children: ReactNode;
  expanded?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-expanded={expanded}
      onClick={onClick}
      className="underline underline-offset-2 text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function FlashcardsPage() {
  const subjects = useSubjects();
  const { notify } = useToast();
  const confirm = useConfirm();
  const reduced = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();

  const [subjectId, setSubjectId] = useState<ID | ''>('');
  const [chapterId, setChapterId] = useState<ID | 'all'>('all');
  const [filterChapterId, setFilterChapterId] = useState<ID | 'all'>('all');
  const [count, setCount] = useState<(typeof COUNT_OPTIONS)[number]>(8);
  const [importance, setImportance] = useState<Importance>(2);
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<CardDraft[]>([]);
  /** D'où viennent les propositions actuellement affichées — jamais deviné, toujours ce qui a réellement été demandé. */
  const [draftsSource, setDraftsSource] = useState<'local' | 'ai'>('local');
  const [draftIndex, setDraftIndex] = useState(0);
  const [manualQuestion, setManualQuestion] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');
  const [manualChapterId, setManualChapterId] = useState<ID | ''>('');
  const [search, setSearch] = useState('');
  const [originFilter, setOriginFilter] = useState<'all' | 'local' | 'ai' | 'manual'>('all');
  /**
   * Les deux panneaux secondaires sont FERMÉS au départ. Le reproche fait à
   * cette page était d'imposer une file de décisions (mode, nombre,
   * importance, difficulté) avant le seul geste qui compte : produire des
   * cartes depuis le cours. Tout ce qui a une valeur par défaut raisonnable
   * est désormais replié — accessible en un clic, jamais un préalable.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const chapters = useChapters(subjectId || undefined);
  const cards = useFlashcards(subjectId || undefined);

  // Un choix n'est un choix que s'il a au moins deux issues.
  const hasSubjectChoice = (subjects ?? []).length > 1;
  const hasChapterChoice = (chapters ?? []).length > 0;

  // Une matière passée depuis la page de cours (« 🃏 Flashcards ») présélectionne
  // directement cette matière plutôt que la première de la liste.
  useEffect(() => {
    if (subjectId || !subjects || subjects.length === 0) return;
    const fromParam = searchParams.get('subject');
    if (fromParam && subjects.some((s) => s.id === fromParam)) {
      setSubjectId(fromParam);
      setSearchParams({}, { replace: true });
    } else {
      setSubjectId(subjects[0]!.id);
    }
  }, [subjects, subjectId, searchParams, setSearchParams]);

  useEffect(() => {
    setChapterId('all');
    setFilterChapterId('all');
    setManualChapterId('');
    setDrafts([]);
    setDraftIndex(0);
  }, [subjectId]);

  const chapterName = (id: ID | null) => chapters?.find((c) => c.id === id)?.name ?? '';

  /**
   * Ce sur quoi la génération va RÉELLEMENT porter, écrit en toutes lettres
   * sous le bouton : sans les sélecteurs affichés en permanence, la portée
   * doit rester visible quelque part, sinon on clique à l'aveugle.
   */
  const scopeLabel =
    chapterId === 'all'
      ? (subjects ?? []).find((s) => s.id === subjectId)?.name ?? 'ton cours'
      : chapterName(chapterId);

  const filteredCards = useMemo(() => {
    if (!cards) return [];
    const term = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (filterChapterId !== 'all' && card.chapterId !== filterChapterId) return false;
      // « Manuelles » regroupe la saisie à la main et les cartes nées d'une
      // erreur de quiz : aucune des deux n'a été produite par un générateur.
      if (originFilter === 'manual' && card.origin !== 'manual' && card.origin !== 'quiz-error') return false;
      if (originFilter !== 'all' && originFilter !== 'manual' && card.origin !== originFilter) return false;
      if (term.length === 0) return true;
      return card.question.toLowerCase().includes(term) || card.answer.toLowerCase().includes(term);
    });
  }, [cards, filterChapterId, originFilter, search]);

  const localCount = useMemo(() => (cards ?? []).filter((c) => c.origin === 'local').length, [cards]);
  const aiCount = useMemo(() => (cards ?? []).filter((c) => c.origin === 'ai').length, [cards]);
  // « Manuelles » = tout ce qui n'a été produit par aucun générateur : la
  // saisie à la main et les cartes nées d'une erreur de quiz.
  const manualCount = useMemo(
    () => (cards ?? []).filter((c) => c.origin === 'manual' || c.origin === 'quiz-error').length,
    [cards],
  );

  /**
   * `source: 'local'` (par défaut) : moteur à règles, aucune clé requise,
   * aucun appel réseau — c'est ce que le bouton principal déclenche.
   * `source: 'ai'` : régénération explicite via l'IA, seulement si demandée
   * (bouton « Régénérer avec l'IA »), jamais silencieuse.
   */
  const handleGenerate = async (source: 'local' | 'ai' = 'local') => {
    if (!subjectId) return;
    if (source === 'ai' && !aiOrchestrator.hasAvailableProvider()) {
      notify('Ajoute une clé API dans Paramètres pour régénérer avec l’IA.', 'error');
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
        source,
      });

      if (generated.length === 0) {
        notify(
          source === 'ai'
            ? "L'IA n'a proposé aucune carte vérifiable à partir de ce contenu. Essaie une autre portée."
            : "Le moteur local n'a trouvé aucune information exploitable dans ce contenu (définitions, énumérations…). Essaie une autre portée, ou régénère avec l'IA.",
          'error',
        );
      } else {
        setDrafts(generated);
        setDraftsSource(source);
        notify(
          `${plural(generated.length, 'carte')} ${agree(generated.length, 'proposée')} — accepte, modifie ou rejette.`,
          'success',
        );
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
      // La provenance ENREGISTRÉE est celle qui a réellement produit la carte.
      // Auparavant tout était marqué `'ai'`, y compris les cartes que le moteur
      // local avait générées sans le moindre appel réseau : la bibliothèque
      // affichait donc « ✨ IA » sur des cartes purement locales.
      origin: draftsSource === 'ai' ? 'ai' : 'local',
      sourceChunkIds: currentDraft.sourceChunkIds,
      notionKey: currentDraft.notionKey,
      notionLabel: currentDraft.notionLabel,
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
          mark="EF ∈ [1,3 ; 3,2]"
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

      <WisdomQuote className="mb-6" />

      {/*
        PORTÉE — et rien d'autre. Un sélecteur dont la liste ne contient qu'une
        seule entrée ne pose pas de question : il occupe une ligne, exige un
        regard, et n'offre aucun choix. La matière ne s'affiche donc que s'il y
        en a plusieurs, la portée que si le cours a réellement des chapitres.
      */}
      {(hasSubjectChoice || hasChapterChoice) && (
        <FadeUp className="mb-4 grid gap-3 sm:grid-cols-2">
          {hasSubjectChoice && (
            <Select label="Matière" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {(subjects ?? []).map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
          )}
          {hasChapterChoice && (
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
          )}
        </FadeUp>
      )}

      <Card className="mb-6">
        {/*
          UN SEUL BOUTON de premier rang. La version précédente empilait un
          sélecteur de mode (2 onglets), un sélecteur de nombre, deux réglages
          repliés et deux boutons : il fallait trancher quatre questions avant
          d'obtenir la moindre carte. Tout ce qui suit ce bouton est secondaire
          et se lit comme tel — des liens, jamais des boutons de même poids.
        */}
        <Button
          size="lg"
          block
          loading={generating}
          onClick={() => void handleGenerate('local')}
          data-flashcards-generate
        >
          {generating ? 'Analyse de ton cours…' : 'Créer mes flashcards'}
        </Button>
        <p className="mt-2.5 text-center text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
          {plural(count, 'carte')} {agree(count, 'tirée')} du texte réel de {scopeLabel} — aucune clé
          API requise.
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[0.78rem]">
          <SubtleAction expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>
            Réglages
          </SubtleAction>
          <SubtleAction expanded={manualOpen} onClick={() => setManualOpen((open) => !open)}>
            Écrire une carte moi-même
          </SubtleAction>
          <SubtleAction disabled={generating} onClick={() => void handleGenerate('ai')}>
            Régénérer avec l’IA
          </SubtleAction>
        </div>

        <AnimatePresence initial={false}>
          {settingsOpen && (
            <motion.div
              key="settings"
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={springSoft}
              className="overflow-hidden"
            >
              <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-3">
                <Select
                  label="Nombre"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value) as (typeof COUNT_OPTIONS)[number])}
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
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {manualOpen && (
            <motion.div
              key="manual"
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={springSoft}
              className="overflow-hidden"
            >
              <div className="mt-4 flex flex-col gap-3 border-t border-[var(--line)] pt-4">
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
                {hasChapterChoice && (
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
                )}
                <Button variant="secondary" onClick={handleManualCreate}>
                  Ajouter la carte
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
              <div className="flex flex-wrap items-center gap-2">
                <Chip>
                  Carte {draftIndex + 1}/{drafts.length}
                </Chip>
                <Chip color={draftsSource === 'ai' ? 'var(--accent)' : 'var(--ink-faint)'}>
                  {draftsSource === 'ai' ? 'Générée par l’IA' : 'Générée localement'}
                </Chip>
              </div>
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
              <p className="mt-2 flex items-center gap-1.5 text-[0.74rem] text-[var(--ink-faint)]">
                <Icon name="courses" size={13} className="shrink-0" />
                {currentDraft.citations[0]?.documentName}
                {currentDraft.citations[0]?.page !== null && currentDraft.citations[0]?.page !== undefined
                  ? ` — page ${currentDraft.citations[0].page}`
                  : ''}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" icon={<Icon name="check" size={15} />} onClick={handleAcceptDraft}>
                  Accepter
                </Button>
                {/* « Rejeter » et non « Supprimer » : la proposition n'a
                    jamais été enregistrée, il n'y a rien à supprimer. */}
                <Button size="sm" variant="ghost" icon={<Icon name="close" size={15} />} onClick={handleRejectDraft}>
                  Rejeter
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

      <Card>
        <h2 className="mb-4 text-[1.05rem]">Bibliothèque ({cards?.length ?? 0})</h2>
        {/* Une seule bibliothèque : « IA » et « Manuelles » ne sont que des filtres
            sur cette même liste, jamais deux systèmes séparés — une carte générée
            par l'IA reste une flashcard normale, révisée par le même SM-2. */}
        <SegmentedControl
          className="mb-4"
          size="sm"
          segments={[
            { value: 'all', label: `Toutes (${cards?.length ?? 0})` },
            { value: 'local', label: `Locales (${localCount})` },
            { value: 'ai', label: `IA (${aiCount})` },
            { value: 'manual', label: `Manuelles (${manualCount})` },
          ]}
          value={originFilter}
          onChange={setOriginFilter}
        />
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
              const status = masteryStatus(card);
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
                        <Chip color={status.level !== null ? MASTERY_COLOR_VARS[status.level] : undefined}>
                          {status.label}
                        </Chip>
                        {card.chapterId && <Chip>{chapterName(card.chapterId)}</Chip>}
                        {card.origin === 'ai' && <Chip>IA</Chip>}
                        {card.origin === 'local' && <Chip>Locale</Chip>}
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
