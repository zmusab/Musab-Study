import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp, Stagger, StaggerItem } from '@/components/motion/Motion';
import { Button, Card, Chip, EmptyState, Icon, SegmentedControl, Swatch, Textarea } from '@/components/ui';
import { WisdomQuote } from '@/components/features/misc/WisdomQuote';
import { springSoft } from '@/components/motion/transitions';
import { useSubjectOverviews, useSubjects } from '@/hooks/useSubjects';
import { listAllDueCards, listDueCards, reviewCard } from '@/data/repositories/cards';
import { db } from '@/data/db';
import { useProgress } from '@/hooks/useProgress';
import { computeStreak } from '@/core/progress';
import { compareAttempt, type AttemptComparison } from '@/core/revisions/compareAttempt';
import type { Confidence, Flashcard, ID, Rating } from '@/types';

/**
 * Session de révision espacée.
 *
 * La file est construite UNE FOIS au lancement (`buildDueQueue`, déjà testé :
 * les cartes les moins « ease » — donc les moins maîtrisées — passent en
 * premier). C'est exactement l'algorithme « qui comprend mon niveau »
 * demandé : il ne priorise rien arbitrairement, il priorise ce que
 * l'historique de révisions dit être le plus fragile.
 *
 * Une carte notée « Encore » n'est pas simplement replanifiée en base (dans
 * 10 minutes) — elle est aussi réinsérée plus loin dans la file LOCALE de la
 * session, pour revenir avant la fin de la séance plutôt que dans dix
 * minutes que l'utilisateur aura déjà quitté l'écran.
 */

const RATING_LABELS: Record<Rating, string> = {
  0: 'Encore',
  1: 'Difficile',
  2: 'Bien',
  3: 'Facile',
};

const CONFIDENCE_SEGMENTS = [
  { value: 'low' as const, label: 'Peu sûr' },
  { value: 'medium' as const, label: 'Moyen' },
  { value: 'high' as const, label: 'Sûr' },
];

const COMPARISON_LABEL: Record<AttemptComparison, { text: string; color: string }> = {
  close: { text: '✓ Ta réponse semble correspondre', color: 'var(--success)' },
  partial: { text: '≈ Partiellement — vérifie les détails', color: 'var(--warning)' },
  different: { text: '✕ Assez différente de la réponse attendue', color: 'var(--ink-soft)' },
};

interface SessionSummary {
  reviewed: number;
  correct: number;
}

function ReviewSession({
  initialQueue,
  subjectName,
  onFinish,
}: {
  initialQueue: Flashcard[];
  subjectName: (subjectId: ID) => string;
  onFinish: (summary: SessionSummary) => void;
}) {
  const reduced = useReducedMotion();
  const [queue, setQueue] = useState(initialQueue);
  const [revealed, setRevealed] = useState(false);
  const [attempt, setAttempt] = useState('');
  const [confidence, setConfidence] = useState<Confidence>('medium');
  const [cardStartedAt, setCardStartedAt] = useState(() => Date.now());
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0);
  const total = initialQueue.length;

  const current = queue[0];
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  const comparison = current ? compareAttempt(attempt, current.answer) : null;

  const handleRate = async (rating: Rating) => {
    if (!current) return;
    const elapsedMs = Date.now() - cardStartedAt;
    await reviewCard(current.id, rating, confidence, elapsedMs);

    const rest = queue.slice(1);
    const nextQueue = rating === 0 ? [...rest.slice(0, 2), current, ...rest.slice(2)] : rest;

    const nextReviewed = reviewed + 1;
    const nextCorrect = correct + (rating >= 2 ? 1 : 0);
    setReviewed(nextReviewed);
    setCorrect(nextCorrect);
    setQueue(nextQueue);
    setRevealed(false);
    setAttempt('');
    setConfidence('medium');
    setCardStartedAt(Date.now());

    if (nextQueue.length === 0) onFinish({ reviewed: nextReviewed, correct: nextCorrect });
  };

  if (!current) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Chip>{subjectName(current.subjectId)}</Chip>
        <p className="text-[0.8rem] text-[var(--ink-faint)]">
          {reviewed}/{total} révisée(s) · {queue.length} restante(s)
        </p>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
        <motion.div
          className="h-full rounded-full bg-[var(--accent)]"
          initial={false}
          animate={{ width: `${progressPct}%` }}
          transition={springSoft}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
          transition={springSoft}
        >
          <Card className="min-h-56">
            <p className="text-[1.08rem] leading-relaxed font-medium">{current.question}</p>

            <AnimatePresence>
              {revealed && (
                <motion.div
                  initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={springSoft}
                  className="overflow-hidden"
                >
                  {attempt.trim().length > 0 && (
                    <div className="mt-4 border-t border-[var(--line)] pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                          Ta réponse
                        </p>
                        {comparison && (
                          <span
                            className="text-[0.74rem] font-medium"
                            style={{ color: COMPARISON_LABEL[comparison].color }}
                            data-review-comparison={comparison}
                          >
                            {COMPARISON_LABEL[comparison].text}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[0.9rem] leading-relaxed text-[var(--ink-soft)]" data-review-your-answer>
                        {attempt}
                      </p>
                    </div>
                  )}
                  <div className="mt-4 border-t border-[var(--line)] pt-4">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--accent-ink)]">
                      Réponse attendue
                    </p>
                    <p className="mt-1 text-[0.95rem] leading-relaxed">{current.answer}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>
      </AnimatePresence>

      {!revealed ? (
        <div className="mt-4 flex flex-col gap-2.5">
          <Textarea
            placeholder="Écris ta réponse ici, avant de la voir — le rappel actif retient mieux qu'une simple relecture."
            rows={3}
            value={attempt}
            onChange={(e) => setAttempt(e.target.value)}
            data-review-attempt
          />
          <Button block onClick={() => setRevealed(true)} data-review-validate>
            Valider
          </Button>
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="self-center text-[0.78rem] text-[var(--ink-faint)] underline underline-offset-2"
            data-review-see-answer
          >
            Je bloque — voir la réponse
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-[0.78rem] text-[var(--ink-faint)]">
              {attempt.trim().length > 0
                ? 'La comparaison ci-dessus n’est qu’un indice approximatif — c’est à toi de juger : ta réponse correspondait-elle vraiment ?'
                : 'Avant de voir la réponse, tu étais…'}
            </span>
            <SegmentedControl segments={CONFIDENCE_SEGMENTS} value={confidence} onChange={setConfidence} size="sm" />
          </div>
          <p className="text-center text-[0.78rem] font-medium text-[var(--ink-soft)]">
            Choisis honnêtement : c’est CE choix, pas la comparaison ci-dessus, qui programme ta prochaine révision.
          </p>
          <div className="grid grid-cols-4 gap-2">
            <Button variant="danger" onClick={() => void handleRate(0)}>
              {RATING_LABELS[0]}
            </Button>
            <Button variant="ghost" onClick={() => void handleRate(1)}>
              {RATING_LABELS[1]}
            </Button>
            <Button variant="secondary" onClick={() => void handleRate(2)}>
              {RATING_LABELS[2]}
            </Button>
            <Button variant="primary" onClick={() => void handleRate(3)}>
              {RATING_LABELS[3]}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RevisionsPage() {
  const subjects = useSubjects();
  const overviews = useSubjectOverviews();
  const progress = useProgress();
  const [queue, setQueue] = useState<Flashcard[] | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const subjectName = (id: ID) => subjects?.find((s) => s.id === id)?.name ?? 'Matière';

  const totalDue = useMemo(() => {
    if (!overviews) return 0;
    return Object.values(overviews).reduce((sum, o) => sum + o.dueCards, 0);
  }, [overviews]);

  // Même calcul que « Progression » (`core/progress`, purement local, aucun
  // appel IA) — la régularité mérite d'être vue ici, là où elle se construit,
  // pas seulement sur un tableau de bord séparé.
  const streak = useMemo(() => (progress ? computeStreak(progress.tables.logs) : null), [progress]);

  const startAll = async () => {
    setSummary(null);
    setQueue(await listAllDueCards());
  };

  const startSubject = async (subjectId: ID) => {
    setSummary(null);
    setQueue(await listDueCards(subjectId));
  };

  const startCards = async (ids: ID[]) => {
    setSummary(null);
    const cards = await db.flashcards.bulkGet(ids);
    setQueue(cards.filter((card): card is Flashcard => card !== undefined));
  };

  // Points d'entrée depuis l'accueil : « Commencer ma session » saute
  // directement dans la file due, « Voir mes points faibles » ouvre une
  // session composée exactement des cartes fragiles identifiées — sans
  // obliger à revenir cliquer manuellement sur un bouton ici.
  const consumedParamsRef = useRef(false);
  useEffect(() => {
    if (consumedParamsRef.current) return;
    const cardIds = searchParams.get('cards');
    const autostart = searchParams.get('autostart');
    if (!cardIds && !autostart) return;
    consumedParamsRef.current = true;
    setSearchParams({}, { replace: true });
    if (cardIds) void startCards(cardIds.split(',').filter(Boolean));
    else void startAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (subjects && subjects.length === 0) {
    return (
      <PageTransition>
        <PageHeader title="Révisions" />
        <EmptyState
          icon={<Icon name="review" size={30} />}
          title="Importe d’abord un cours"
          description="La répétition espacée porte sur tes flashcards. Crée une matière, ajoute un document, puis des cartes avant de réviser."
          action={
            <Link to="/cours">
              <Button>Aller aux cours</Button>
            </Link>
          }
        />
      </PageTransition>
    );
  }

  if (queue && queue.length > 0) {
    return (
      <PageTransition>
        <PageHeader title="Révisions" />
        <ReviewSession
          initialQueue={queue}
          subjectName={subjectName}
          onFinish={(finished) => {
            setSummary(finished);
            setQueue(null);
          }}
        />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <PageHeader
        title="Révisions"
        subtitle="Les cartes les moins maîtrisées reviennent en premier, automatiquement."
      />

      {streak && streak.current > 0 && (
        <p className="mb-4 text-[0.82rem] text-[var(--ink-soft)]">
          Série en cours : <strong>{streak.current} jour{streak.current > 1 ? 's' : ''}</strong> de révision.
        </p>
      )}

      <WisdomQuote className="mb-6" />

      {summary && (
        <FadeUp className="mb-6 rounded-[var(--radius-card)] border border-[var(--success)]/40 bg-[var(--success-tint)] p-5 text-center">
          <p className="text-[1.05rem] font-semibold">Révision terminée</p>
          <p className="mt-1 text-[0.88rem] text-[var(--ink-soft)]">
            {summary.correct}/{summary.reviewed} carte{summary.reviewed > 1 ? 's' : ''} réussie{summary.correct > 1 ? 's' : ''}
            {summary.reviewed > 0 ? ` · ${Math.round((summary.correct / summary.reviewed) * 100)}%` : ''}
          </p>
          {totalDue === 0 ? (
            <p className="mt-1 text-[0.8rem] text-[var(--ink-faint)]">Plus aucune carte due pour l’instant.</p>
          ) : (
            <p className="mt-1 text-[0.8rem] text-[var(--ink-faint)]">
              {totalDue} carte{totalDue > 1 ? 's' : ''} encore due{totalDue > 1 ? 's' : ''}.
            </p>
          )}
        </FadeUp>
      )}

      {totalDue === 0 ? (
        <EmptyState
          icon={<Icon name="review" size={30} />}
          title="Tout est à jour"
          description="Aucune carte due pour l’instant. Reviens quand la répétition espacée en aura reprogrammé."
        />
      ) : (
        <Button className="mb-6" size="lg" block onClick={() => void startAll()}>
          Commencer ma révision — {totalDue} carte{totalDue > 1 ? 's' : ''} due{totalDue > 1 ? 's' : ''}
        </Button>
      )}

      <Stagger className="flex flex-col gap-3">
        {(subjects ?? []).map((subject) => {
          const stats = overviews?.[subject.id];
          const due = stats?.dueCards ?? 0;
          return (
            <StaggerItem key={subject.id}>
              <div className="surface-card flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Swatch color={subject.color} size={11} />
                  <div className="min-w-0">
                    <p className="truncate text-[0.95rem] font-medium">{subject.name}</p>
                    <p className="text-[0.78rem] text-[var(--ink-faint)]">
                      {due > 0 ? `${due} due(s)` : 'à jour'}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={due > 0 ? 'secondary' : 'ghost'}
                  disabled={due === 0}
                  onClick={() => void startSubject(subject.id)}
                >
                  Réviser
                </Button>
              </div>
            </StaggerItem>
          );
        })}
      </Stagger>
    </PageTransition>
  );
}
