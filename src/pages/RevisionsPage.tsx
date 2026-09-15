import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp, Stagger, StaggerItem } from '@/components/motion/Motion';
import { Button, Card, Chip, EmptyState, Icon, Swatch, Textarea } from '@/components/ui';
import { WisdomQuote } from '@/components/features/misc/WisdomQuote';
import { springSoft } from '@/components/motion/transitions';
import { useSubjectOverviews, useSubjects } from '@/hooks/useSubjects';
import {
  buryCard,
  listAllDueCards,
  listDueCards,
  reviewCardUndoable,
  setCardSuspended,
  undoReview,
  updateCard,
  type UndoableReview,
} from '@/data/repositories/cards';
import { db } from '@/data/db';
import { useProgress } from '@/hooks/useProgress';
import { computeStreak } from '@/core/progress';
import { evaluateAnswer, type AnswerVerdict } from '@/core/revisions/evaluateAnswer';
import { deriveRating, type AutoRating } from '@/core/revisions/autoRating';
import { formatDelay, previewDelays } from '@/core/srs';
import type { Confidence, Flashcard, ID, Rating } from '@/types';
import { agree, plural } from '@/lib/plural';

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
/** Les quatre notes dans l'ordre où elles s'affichent, avec leur couleur. */
const RATING_ORDER: { rating: Rating; variant: 'danger' | 'ghost' | 'secondary' | 'primary' }[] = [
  { rating: 0, variant: 'danger' },
  { rating: 1, variant: 'ghost' },
  { rating: 2, variant: 'secondary' },
  { rating: 3, variant: 'primary' },
];

const CONFIDENCE_FOR_RATING: Record<Rating, Confidence> = {
  0: 'low',
  1: 'medium',
  2: 'medium',
  3: 'high',
};

/*
 * Le verdict est déjà rendu dans SA couleur, sur SON fond teinté. Le rond
 * emoji qui précédait le mot disait donc une troisième fois la même chose —
 * et dans une palette qui n'est pas celle de l'application : le 🟢 d'iOS n'est
 * pas la sauge de `--success`, le 🔴 n'est pas la brique de `--danger`. Deux
 * verts côte à côte, dont un seul est le bon, se voient immédiatement.
 */
const VERDICT_LABEL: Record<AnswerVerdict, { text: string; color: string; tint: string }> = {
  correct: { text: 'Correct', color: 'var(--success)', tint: 'var(--success-tint)' },
  partial: { text: 'Partiellement correct', color: 'var(--warning)', tint: 'var(--warning-tint)' },
  incorrect: { text: 'Incorrect', color: 'var(--danger)', tint: 'var(--danger-tint)' },
  indeterminate: { text: 'Évaluation indisponible', color: 'var(--ink-soft)', tint: 'var(--surface-2)' },
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
  /**
   * QUAND CHAQUE CARTE NOTÉE REVIENDRA — l'échéance SM-2 telle qu'elle vient
   * d'être écrite en base.
   *
   * La fin de séance annonçait « 2/3 cartes réussies · 67 % » et s'arrêtait
   * là. C'est pourtant le moment qui décide si on rouvre l'application demain,
   * et il ne disait rien de ce que le travail venait de produire. Lire « 2
   * cartes reviennent dans 3 jours, 1 demain », c'est voir la répétition
   * espacée fonctionner — et ce sont les dates réelles, pas une promesse.
   */
  returns: string[];
}

/**
 * LE DERNIER GESTE, gardé assez complet pour être défait.
 *
 * Annuler ne peut pas se contenter de toucher la base : la session tient son
 * propre état — la file, dont l'ordre a changé si la note était « Encore », et
 * les compteurs de la séance. Défaire la base sans défaire la session
 * laisserait la carte derrière soi alors qu'elle n'a plus été notée.
 *
 * Une carte mise de côté ne compte PAS comme révisée : les compteurs ne
 * bougent pas, il n'y a donc rien à leur rendre.
 */
type LastAction =
  | {
      kind: 'review';
      review: UndoableReview;
      queue: Flashcard[];
      reviewed: number;
      correct: number;
      label: string;
    }
  | { kind: 'aside'; card: Flashcard; queue: Flashcard[]; label: string };

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
  /**
   * LES GESTES ANNULABLES, en pile — pas un seul cran.
   *
   * Un seul niveau d'annulation suffit rarement : on s'aperçoit qu'on a mal
   * noté DEUX cartes plus loin, pas tout de suite. Chaque entrée porte un
   * instantané COMPLET de la séance (file, compteurs), donc dépiler restaure
   * un état absolu — l'ordre des annulations ne peut pas dériver.
   */
  /**
   * Échéance de chaque carte notée, par carte : une carte revue deux fois dans
   * la séance (« Encore » la renvoie plus loin dans la file) ne compte qu'une
   * fois, avec sa dernière échéance.
   */
  const [returns, setReturns] = useState<Record<ID, string>>({});
  const [undoStack, setUndoStack] = useState<LastAction[]>([]);
  const lastAction = undoStack[undoStack.length - 1] ?? null;
  const pushUndo = (action: LastAction) => setUndoStack((stack) => [...stack, action]);
  const [busy, setBusy] = useState(false);
  const total = initialQueue.length;

  const current = queue[0];
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  const hasAttempt = attempt.trim().length > 0;
  // La question est transmise à l'évaluation : ce qu'elle nomme déjà (le sujet
  // de la carte) n'a pas à être répété par l'étudiant pour que sa réponse
  // compte comme complète.
  const evaluation = current && hasAttempt ? evaluateAnswer(attempt, current.answer, current.question) : null;

  /*
    Le délai que chaque note entraînerait, calculé par le PLANIFICATEUR
    lui-même (`scheduleNext`, fonction pure) : l'aperçu ne peut donc pas
    diverger de ce qui sera réellement enregistré.
  */
  const delays = current
    ? previewDelays(
        {
          ease: current.ease,
          interval: current.interval,
          reps: current.reps,
          lapses: current.lapses,
          due: current.due,
          lastReview: current.lastReview,
          importance: current.importance,
          difficulty: current.difficulty,
        },
        (rating) => CONFIDENCE_FOR_RATING[rating],
      )
    : null;

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

  /** Remet l'écran dans l'état « carte non encore vue ». */
  const resetCardView = () => {
    setRevealed(false);
    setAttempt('');
    setPending(null);
    setOverriding(false);
    setAnsweredInMs(0);
    setCardStartedAt(Date.now());
  };

  const handleRate = async (rating: Rating, confidence: Confidence = CONFIDENCE_FOR_RATING[rating]) => {
    if (!current || busy) return;
    setBusy(true);
    const review = await reviewCardUndoable(current.id, rating, confidence, answeredInMs);
    pushUndo({
      kind: 'review',
      review,
      queue,
      reviewed,
      correct,
      label: `Note « ${RATING_LABELS[rating]} » annulée.`,
    });

    const rest = queue.slice(1);
    const nextQueue = rating === 0 ? [...rest.slice(0, 2), current, ...rest.slice(2)] : rest;

    const nextReviewed = reviewed + 1;
    const nextCorrect = correct + (rating >= 2 ? 1 : 0);
    const nextReturns = { ...returns, [current.id]: review.card.due };
    setReviewed(nextReviewed);
    setCorrect(nextCorrect);
    setReturns(nextReturns);
    setQueue(nextQueue);
    resetCardView();
    setBusy(false);

    if (nextQueue.length === 0)
      onFinish({ reviewed: nextReviewed, correct: nextCorrect, returns: Object.values(nextReturns) });
  };

  /**
   * METTRE LA CARTE DE CÔTÉ sans la noter.
   *
   * Répondre à une carte qu'on ne veut pas traiter maintenant fausserait deux
   * choses d'un coup : son échéance SM-2 et les statistiques de la séance. Ni
   * suspendre ni enterrer n'écrit de réponse — le compteur de cartes révisées
   * ne bouge donc pas, parce qu'aucune révision n'a eu lieu.
   */
  const handleSetAside = async (what: 'suspend' | 'bury') => {
    if (!current || busy) return;
    setBusy(true);
    if (what === 'suspend') await setCardSuspended(current.id, true);
    else await buryCard(current.id);
    pushUndo({
      kind: 'aside',
      card: current,
      queue,
      label: what === 'suspend' ? 'Carte remise en circulation.' : 'Enterrement annulé.',
    });

    // Retirer TOUTES ses occurrences : une carte notée « Encore » plus tôt dans
    // la séance a été réinsérée plus loin, et la suspendre doit la faire
    // disparaître de la file entière, pas seulement de sa place actuelle.
    const nextQueue = queue.filter((card) => card.id !== current.id);
    setQueue(nextQueue);
    resetCardView();
    setBusy(false);

    if (nextQueue.length === 0) onFinish({ reviewed, correct, returns: Object.values(returns) });
  };

  /**
   * ANNULER — la base ET la session, ensemble.
   *
   * `undoReview` restaure l'état de planification exact d'avant la note et
   * retire sa ligne de journal ; ici on remet la file et les compteurs de la
   * séance tels qu'ils étaient. La carte annulée revient donc devant, et c'est
   * bien ce qu'on attend d'une annulation.
   */
  const handleUndo = async () => {
    if (!lastAction || busy) return;
    setBusy(true);
    if (lastAction.kind === 'review') {
      const restored = await undoReview(lastAction.review);
      // Carte supprimée entre-temps depuis un autre écran : il n'y a plus rien
      // à remettre dans la file, et ce n'est pas une erreur.
      setQueue(
        restored
          ? lastAction.queue
          : lastAction.queue.filter((card) => card.id !== lastAction.review.card.id),
      );
      setReviewed(lastAction.reviewed);
      setCorrect(lastAction.correct);
      // L'échéance annulée ne doit pas rester dans le bilan de fin de séance.
      setReturns((current) => {
        const { [lastAction.review.card.id]: _annulee, ...reste } = current;
        return reste;
      });
    } else {
      await updateCard(lastAction.card.id, {
        suspended: lastAction.card.suspended ?? false,
        buriedUntil: lastAction.card.buriedUntil ?? null,
      });
      setQueue(lastAction.queue);
    }
    setUndoStack((stack) => stack.slice(0, -1));
    resetCardView();
    setBusy(false);
  };

  if (!current) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Chip>{subjectName(current.subjectId)}</Chip>
        <p className="text-[0.8rem] text-[var(--ink-faint)]">
          {reviewed}/{total} {agree(reviewed, 'révisée')} · {plural(queue.length, 'restante')}
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

      {/*
        ANNULER LE DERNIER GESTE — la touche d'Anki qui manquait.
        Une note posée par erreur (le doigt qui glisse sur « Facile », la
        réponse qu'on relit trop tard) repoussait la carte d'un mois sans
        aucun recours : il fallait retrouver la carte dans la bibliothèque et
        la supprimer pour effacer la faute. Le bandeau ne s'affiche qu'une
        fois qu'il y a réellement quelque chose à défaire.
      */}
      <AnimatePresence initial={false}>
        {lastAction && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={springSoft}
            className="overflow-hidden"
          >
            <div className="mb-3 flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[0.78rem] text-[var(--ink-soft)]">
                {lastAction.kind === 'review' ? 'Dernière note enregistrée.' : 'Carte mise de côté.'}
                {undoStack.length > 1 && (
                  <span className="text-[var(--ink-faint)]"> · {undoStack.length} gestes annulables</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => void handleUndo()}
                disabled={busy}
                className="shrink-0 text-[0.78rem] font-semibold text-[var(--accent-ink)] underline underline-offset-2 disabled:opacity-50"
                data-review-undo
              >
                Annuler
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
              {/*
                CHAQUE BOUTON ANNONCE SON DÉLAI — « Encore · 10 min »,
                « Facile · 1 mois ». C'est ce qui rend la répétition espacée
                croyable : on ne note plus à l'aveugle, on voit la
                conséquence. Le délai vient de `scheduleNext` lui-même, donc
                il ne peut pas mentir sur ce qui sera enregistré.
              */}
              <div className="grid grid-cols-4 gap-2">
                {RATING_ORDER.map(({ rating, variant }) => (
                  <Button
                    key={rating}
                    variant={variant}
                    onClick={() => void handleRate(rating)}
                    className="flex-col gap-0 py-2 leading-tight"
                  >
                    <span>{RATING_LABELS[rating]}</span>
                    {delays && (
                      <span className="text-[0.68rem] font-normal opacity-75">{delays[rating]}</span>
                    )}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/*
        SUSPENDRE / ENTERRER — sortir une carte de la séance sans la noter.

        Sans ces deux gestes, une carte mal formulée ou déjà donnée par sa
        jumelle n'avait que deux issues : une note qui ne mesure rien, ou la
        suppression, qui efface son historique. Ni l'une ni l'autre ne
        touche à l'échéance SM-2 : c'est la VISIBILITÉ qui change.
      */}
      <div className="mt-4 flex items-center justify-center gap-4 border-t border-[var(--line)] pt-3">
        <button
          type="button"
          onClick={() => void handleSetAside('bury')}
          disabled={busy}
          className="text-[0.78rem] text-[var(--ink-faint)] underline underline-offset-2 disabled:opacity-50"
          data-review-bury
        >
          Enterrer jusqu’à demain
        </button>
        <button
          type="button"
          onClick={() => void handleSetAside('suspend')}
          disabled={busy}
          className="text-[0.78rem] text-[var(--ink-faint)] underline underline-offset-2 disabled:opacity-50"
          data-review-suspend
        >
          Suspendre cette carte
        </button>
      </div>
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

  /*
    « 2 demain · 1 dans 3 jours » — les échéances regroupées par délai.

    `formatDelay` est celui des boutons de note : l'aperçu promis pendant la
    séance et le bilan de fin ne peuvent donc pas diverger, c'est la même
    fonction sur la même donnée.
  */
  const returnLines = useMemo(() => {
    if (!summary || summary.returns.length === 0) return [];
    const from = Date.now();
    const groupes = new Map<string, { combien: number; quand: number }>();
    for (const due of summary.returns) {
      const delai = formatDelay(from, due);
      const existant = groupes.get(delai);
      if (existant) existant.combien += 1;
      else groupes.set(delai, { combien: 1, quand: new Date(due).getTime() });
    }
    return (
      [...groupes.entries()]
        // Du plus proche au plus lointain : « 2 demain · 1 dans 7 j » se lit
        // dans l'ordre où les cartes reviendront, pas dans celui du hasard.
        .sort((a, b) => a[1].quand - b[1].quand)
        .map(([delai, { combien }]) =>
          // « 1 dans 1 j » ne se dit pas en français.
          delai === '1 j' ? `${combien} demain` : `${combien} dans ${delai}`,
        )
    );
  }, [summary]);

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
          <p className="text-[1.05rem] font-semibold">
            {/* Mettre de côté les dernières cartes termine la séance sans
                qu'aucune note ait été posée : annoncer « 0/0 carte réussie »
                là ressemblerait à un échec, alors qu'il ne s'est rien passé. */}
            {summary.reviewed === 0 ? 'Séance close' : 'Révision terminée'}
          </p>
          <p className="mt-1 text-[0.88rem] text-[var(--ink-soft)]">
            {summary.reviewed === 0
              ? 'Aucune carte notée — tu as mis de côté ce qui restait.'
              : `${summary.correct}/${summary.reviewed} carte${summary.reviewed > 1 ? 's' : ''} réussie${
                  summary.correct > 1 ? 's' : ''
                } · ${Math.round((summary.correct / summary.reviewed) * 100)}%`}
          </p>

          {/*
            CE QUE LA SÉANCE VIENT DE PRODUIRE.

            L'écran s'arrêtait au score. Or le score n'est pas ce qu'on gagne
            en révisant — ce qu'on gagne, c'est que les cartes sues reviennent
            PLUS TARD. Le dire avec les échéances réelles, c'est montrer la
            répétition espacée en train de fonctionner ; sans cela, l'étudiant
            n'a aucun moyen de voir que son travail a servi à quelque chose.

            Et la SÉRIE, qui est le seul chiffre qui donne envie de revenir
            demain : elle était affichée plus bas sur la page, jamais au
            moment où elle vient d'être prolongée.
          */}
          {returnLines.length > 0 && (
            <p className="mt-2 text-[0.82rem] text-[var(--ink-soft)]" data-review-returns>
              Tu les revois : {returnLines.join(' · ')}.
            </p>
          )}
          {streak && streak.current > 0 && summary.reviewed > 0 && (
            <p className="mt-1 text-[0.82rem] font-medium" style={{ color: 'var(--accent-ink)' }} data-review-streak>
              {streak.current === 1
                ? 'Première journée de ta série. Reviens demain pour la tenir.'
                : `${streak.current} jours d’affilée. Continue.`}
            </p>
          )}
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
                      {due > 0 ? plural(due, 'due') : 'à jour'}
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
