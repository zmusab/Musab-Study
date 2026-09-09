import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp, Stagger, StaggerItem } from '@/components/motion/Motion';
import { Button, Card, Chip, EmptyState, Icon, Swatch, Textarea } from '@/components/ui';
import { WisdomQuote } from '@/components/features/misc/WisdomQuote';
import { springSoft } from '@/components/motion/transitions';
import { useSubjectOverviews, useSubjects } from '@/hooks/useSubjects';
import { listAllDueCards, listDueCards, reviewCard } from '@/data/repositories/cards';
import { db } from '@/data/db';
import { useProgress } from '@/hooks/useProgress';
import { computeStreak } from '@/core/progress';
import { evaluateAnswer, type AnswerVerdict } from '@/core/revisions/evaluateAnswer';
import { deriveRating, type AutoRating } from '@/core/revisions/autoRating';
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

/**
 * La confiance n'est plus demandée séparément : elle découle de la note. Un
 * étudiant qui note « Facile » était sûr de lui, un « Encore » ne l'était pas.
 * Poser les deux questions revenait à lui faire saisir deux fois la même
 * information — et `scheduleNext` attend toujours les deux.
 */
const CONFIDENCE_FOR_RATING: Record<Rating, Confidence> = {
  0: 'low',
  1: 'medium',
  2: 'medium',
  3: 'high',
};

const VERDICT_LABEL: Record<AnswerVerdict, { text: string; color: string; tint: string }> = {
  correct: { text: '🟢 Correct', color: 'var(--success)', tint: 'var(--success-tint)' },
  partial: { text: '🟡 Partiellement correct', color: 'var(--warning)', tint: 'var(--warning-tint)' },
  incorrect: { text: '🔴 Incorrect', color: 'var(--danger)', tint: 'var(--danger-tint)' },
  indeterminate: { text: '⚪ Évaluation indisponible', color: 'var(--ink-soft)', tint: 'var(--surface-2)' },
};

const VERDICT_MESSAGE: Record<AnswerVerdict, string | null> = {
  correct: null,
  partial: null,
  incorrect: null,
  indeterminate: 'Je ne peux pas déterminer automatiquement si ta réponse est correcte. Juge ta réponse toi-même.',
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
  const [cardStartedAt, setCardStartedAt] = useState(() => Date.now());
  /** Note DÉDUITE de la réponse, figée à la vérification. `null` = le moteur n'a pas pu trancher. */
  const [pending, setPending] = useState<AutoRating | null>(null);
  /** L'étudiant a demandé à corriger la note déduite. */
  const [overriding, setOverriding] = useState(false);
  /** Temps réellement mis pour répondre — figé au moment de vérifier, pas au moment de noter. */
  const [answeredInMs, setAnsweredInMs] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0);
  const total = initialQueue.length;

  const current = queue[0];
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  const hasAttempt = attempt.trim().length > 0;
  // La question est transmise à l'évaluation : ce qu'elle nomme déjà (le sujet
  // de la carte) n'a pas à être répété par l'étudiant pour que sa réponse
  // compte comme complète.
  const evaluation = current && hasAttempt ? evaluateAnswer(attempt, current.answer, current.question) : null;

  /**
   * Vérifier fige DEUX choses : le temps réellement mis à répondre, et la note
   * qui en découle. Rien n'est encore écrit en base — l'étudiant voit d'abord
   * la note déduite et peut la corriger.
   */
  const handleVerify = () => {
    if (!current) return;
    const elapsed = Date.now() - cardStartedAt;
    setAnsweredInMs(elapsed);
    setRevealed(true);
    const verdict = hasAttempt ? evaluateAnswer(attempt, current.answer, current.question).verdict : null;
    setPending(verdict ? deriveRating(verdict, elapsed, current.answer) : null);
  };

  const handleRate = async (rating: Rating, confidence: Confidence = CONFIDENCE_FOR_RATING[rating]) => {
    if (!current) return;
    await reviewCard(current.id, rating, confidence, answeredInMs);

    const rest = queue.slice(1);
    const nextQueue = rating === 0 ? [...rest.slice(0, 2), current, ...rest.slice(2)] : rest;

    const nextReviewed = reviewed + 1;
    const nextCorrect = correct + (rating >= 2 ? 1 : 0);
    setReviewed(nextReviewed);
    setCorrect(nextCorrect);
    setQueue(nextQueue);
    setRevealed(false);
    setAttempt('');
    setPending(null);
    setOverriding(false);
    setAnsweredInMs(0);
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
                  {hasAttempt && (
                    <div className="mt-4 border-t border-[var(--line)] pt-4">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                        Ta réponse
                      </p>
                      <p className="mt-1 text-[0.9rem] leading-relaxed text-[var(--ink-soft)]" data-review-your-answer>
                        {attempt}
                      </p>
                      {evaluation && (
                        <div
                          className="mt-3 rounded-[var(--radius-control)] px-3 py-2"
                          style={{ backgroundColor: VERDICT_LABEL[evaluation.verdict].tint }}
                          data-review-verdict={evaluation.verdict}
                        >
                          <p
                            className="text-[0.84rem] font-semibold"
                            style={{ color: VERDICT_LABEL[evaluation.verdict].color }}
                          >
                            {VERDICT_LABEL[evaluation.verdict].text}
                          </p>
                          {(evaluation.explanation ?? VERDICT_MESSAGE[evaluation.verdict]) && (
                            <p className="mt-1 text-[0.78rem] leading-relaxed text-[var(--ink-soft)]">
                              {evaluation.explanation ?? VERDICT_MESSAGE[evaluation.verdict]}
                            </p>
                          )}
                        </div>
                      )}
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
          <Button block onClick={handleVerify} data-review-validate>
            Vérifier ma réponse
          </Button>
          <button
            type="button"
            onClick={handleVerify}
            className="self-center text-[0.78rem] text-[var(--ink-faint)] underline underline-offset-2"
            data-review-see-answer
          >
            Je bloque — voir la réponse
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {/*
            La note n'est plus RÉCLAMÉE, elle est DÉDUITE : de ce que l'étudiant
            a répondu et du temps qu'il a mis. Elle reste affichée avec sa
            raison et corrigeable — une note automatique invisible ou
            irrattrapable serait pire que la question qu'elle remplace.
          */}
          {pending && !overriding ? (
            <div className="flex flex-col items-center gap-2 text-center" data-review-auto-rating={pending.rating}>
              <p className="text-[0.9rem]">
                Noté automatiquement : <strong>{RATING_LABELS[pending.rating]}</strong>
              </p>
              <p className="text-[0.78rem] text-[var(--ink-soft)]">{pending.reason}</p>
              <Button block className="mt-1" onClick={() => void handleRate(pending.rating, pending.confidence)} data-review-next>
                Carte suivante
              </Button>
              <button
                type="button"
                onClick={() => setOverriding(true)}
                className="text-[0.78rem] text-[var(--ink-faint)] underline underline-offset-2"
                data-review-override
              >
                Ce n’est pas juste — noter moi-même
              </button>
            </div>
          ) : (
            <>
              <p className="text-center text-[0.78rem] text-[var(--ink-soft)]">
                {pending
                  ? 'Choisis la note qui correspond vraiment à ton rappel.'
                  : 'Le moteur ne peut pas juger cette réponse tout seul — à toi de dire ce que valait ton rappel.'}
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
            </>
          )}
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
