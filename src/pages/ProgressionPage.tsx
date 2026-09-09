import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp } from '@/components/motion/Motion';
import { Reveal } from '@/components/motion/Reveal';
import { Button, Card, EmptyState, Icon, Input, Modal, useToast } from '@/components/ui';
import { BandDot, EmptyHint, MasteryBar, SectionTitle } from '@/components/features/progress/ProgressBits';
import { ProgressOverview } from '@/components/features/progress/ProgressOverview';
import { ReadinessPanel } from '@/components/features/progress/ReadinessPanel';
import { EvaluationsCard } from '@/components/features/progress/EvaluationsCard';
import { PriorityList } from '@/components/features/progress/PriorityList';
import { WeakStrongPair } from '@/components/features/progress/WeakStrongPair';
import { SecondaryPanels, type Period } from '@/components/features/progress/SecondaryPanels';
import { useProgress } from '@/hooks/useProgress';
import { useProfile } from '@/hooks/useProfile';
import { saveProfile } from '@/data/repositories/profile';
import { progressView } from '@/core/progress/view';
import {
  chapterProgress,
  formatDuration,
  masteryBand,
  type ChapterProgress,
  type SubjectProgress,
} from '@/core/progress';
import type { SubjectReadiness } from '@/core/progress/view';
import type { ID } from '@/types';

/**
 * PROGRESSION — le centre de pilotage des études.
 *
 * Principe directeur : chaque chiffre affiché ici se déduit d'une ligne
 * réellement enregistrée (`flashcards`, `reviewLogs`, `subjects`,
 * `chapters`). Quand une mesure n'est pas encore possible, la section
 * l'annonce et explique ce qui la déclenchera — jamais un nombre de
 * démonstration, jamais « fonctionnalité en construction ».
 *
 * Le calcul est fait par `progressView`, une fonction pure mémorisée : le
 * filtre par matière et le changement de période ne relisent pas la base.
 */

export function ProgressionPage() {
  const source = useProgress();
  const profile = useProfile();
  const { notify } = useToast();

  const [subjectId, setSubjectId] = useState<ID | null>(null);
  const [openSubject, setOpenSubject] = useState<ID | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [goalsOpen, setGoalsOpen] = useState(false);

  const view = useMemo(() => {
    if (!source) return null;
    return progressView(source.tables, {
      subjectId,
      goals: source.goals,
      now: new Date(source.loadedAt),
    });
  }, [source, subjectId]);

  const chapters = useMemo<ChapterProgress[]>(() => {
    if (!source || !openSubject) return [];
    return chapterProgress(openSubject, source.tables.chapters, source.tables.cards, source.tables.logs);
  }, [source, openSubject]);

  if (!source || !view) return null;

  // Le même en-tête que toutes les autres pages — surtitre scientifique et
  // filet de séparation compris. Cette page dessinait le sien à la main, et
  // c'était la seule à ne pas porter la marque de sa section.
  const hero = (
    <PageHeader
      title="Progression"
      subtitle="Suis ta progression, identifie tes points faibles et concentre tes révisions là où elles sont les plus utiles."
    />
  );

  // ── Aucune matière : rien n'est mesurable, et le dire vaut mieux que
  //    dessiner un tableau de bord vide rempli de zéros. ──
  if (!view.hasAnySubject) {
    return (
      <PageTransition>
        {hero}
        <div className="mt-6">
          <EmptyState
            icon={<Icon name="progress" size={30} />}
            mark="R = e^(−t/S)"
            title="Ta progression se construit à partir de tes cours"
            description="Crée une matière, importe un cours et transforme-le en flashcards : dès la première révision, cette page mesure ta maîtrise, ton temps de révision, tes points faibles et ta régularité — uniquement à partir de tes vraies réponses."
            action={
              <Link to="/cours">
                <Button>Créer ma première matière</Button>
              </Link>
            }
          />
        </div>
      </PageTransition>
    );
  }

  const { mastery, time, weak, activity, trend, upcoming, goals, streak: regularity } = view;

  // MATIÈRE MISE EN AVANT pour la suffisance examen : celle dont l'évaluation
  // est la plus proche si une date existe au calendrier, sinon la plus
  // fragile parmi celles réellement mesurables. Sans aucune mesure, la
  // section entière disparaît plutôt que d'afficher une carte vide.
  const measuredReadiness = view.readiness.filter((entry) => entry.readiness.pct !== null);
  const readinessFocus: SubjectReadiness | null =
    view.focus ??
    (measuredReadiness.length > 0
      ? measuredReadiness.reduce((low, entry) => (entry.readiness.pct! < low.readiness.pct! ? entry : low))
      : null);

  const focusChapters = readinessFocus
    ? chapterProgress(
        readinessFocus.subject.id,
        source.tables.chapters,
        source.tables.cards,
        source.tables.logs,
      )
    : [];

  // Cartes par chapitre : un lien « renforcer » n'est proposé que s'il ouvre
  // réellement une séance.
  const focusChapterCards = new Map<string, string[]>();
  if (readinessFocus) {
    for (const card of source.tables.cards) {
      if (card.subjectId !== readinessFocus.subject.id) continue;
      const key = card.chapterId ?? 'orphan';
      const list = focusChapterCards.get(key);
      if (list) list.push(card.id);
      else focusChapterCards.set(key, [card.id]);
    }
  }
  const focusWeakCards = readinessFocus
    ? focusChapters
        .filter((chapter) => chapter.masteryPct === null || chapter.masteryPct < 70)
        .flatMap((chapter) => focusChapterCards.get(chapter.chapterId ?? 'orphan') ?? [])
    : [];
  const focusReviseHref = focusWeakCards.length > 0 ? `/revisions?cards=${focusWeakCards.join(',')}` : null;
  // La même suffisance que partout ailleurs, indexée par matière pour être
  // affichée en regard de chaque échéance.
  const readinessBySubject = new Map(
    view.readiness.map((entry) => [entry.subject.id, entry.readiness.pct] as const),
  );
  const periodMs = period === 'week' ? time.weekMs : period === 'month' ? time.monthMs : view.totalStudyMs;
  const activeSubject = source.tables.subjects.find((entry) => entry.id === subjectId) ?? null;

  return (
    <PageTransition>
      {hero}

      {/* FILTRE — une seule commande globale, volontairement : la page reste
          lisible et l'on sait toujours de quel périmètre on parle. */}
      {source.tables.subjects.length > 1 && (
        <FadeUp>
          <div className="mt-5 flex flex-wrap items-center gap-2" data-progress-filter>
            <button
              type="button"
              onClick={() => setSubjectId(null)}
              aria-pressed={subjectId === null}
              className={chipClass(subjectId === null)}
            >
              Toutes les matières
            </button>
            {source.tables.subjects.map((subject) => (
              <button
                key={subject.id}
                type="button"
                onClick={() => setSubjectId(subject.id)}
                aria-pressed={subjectId === subject.id}
                className={chipClass(subjectId === subject.id)}
              >
                <span
                  aria-hidden
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: subject.color }}
                />
                {subject.name}
              </button>
            ))}
          </div>
          {/* Le périmètre doit rester visible : sans ce rappel, on peut lire
              un tableau de bord filtré en croyant voir l'ensemble. */}
          {activeSubject && (
            <p className="mt-2 text-[0.82rem] text-[var(--ink-faint)]">
              Toute la page est restreinte à {activeSubject.name}.
            </p>
          )}
        </FadeUp>
      )}

      {/*
        ═══ 1. VUE D'ENSEMBLE — où j'en suis, sans une seule action. ═══

        À partir d'ici, chaque section est enveloppée d'un `<Reveal>` : elle
        monte en fondu au moment où elle entre dans la fenêtre. Sur une page de
        cette longueur, une animation jouée au montage se termine plusieurs
        écrans avant qu'on ne l'atteigne — autant ne pas en avoir. Seuls
        `opacity` et `transform` bougent : le texte et les chiffres restent
        dans le DOM, exacts, même sans avoir jamais défilé jusqu'à eux.
      */}
      <FadeUp className="mt-5">
        <ProgressOverview
          masteryPct={mastery.pct}
          masteryMissing={mastery.missing}
          totalCards={mastery.totalCards}
          answers={view.answers}
          readinessPct={view.globalReadiness?.pct ?? null}
          readinessSubjects={view.globalReadiness?.subjects ?? 0}
          time={time}
          streak={regularity}
        />
      </FadeUp>

      {/* ═══ 2. À FAIRE MAINTENANT — la section la plus importante. ═══
             La recommandation dit QUOI et POURQUOI en deux phrases ; les trois
             priorités détaillent le classement, chacune avec sa raison mesurée
             et son bouton de révision. */}
      <Reveal className="mt-7">
        <SectionTitle
          hint={
            view.evaluations.length > 0
              ? 'Croise ta maîtrise, tes erreurs, tes cartes dues et les échéances de ton calendrier.'
              : 'Croise ta maîtrise, tes erreurs et tes cartes dues. Aucune date d’examen n’est nécessaire.'
          }
        >
          À faire maintenant
        </SectionTitle>

        {/* Même signal que la session recommandée de l'accueil : un filet
            d'accent épais sur le bord gauche, comme une marque de correcteur.
            La carte la plus importante de la page doit se distinguer sans
            qu'on ait à lire son titre. */}
        {view.recommendation !== null && (
          <Card data-progress-reco className="mb-2 border-l-[3px] border-l-[var(--accent)] bg-[var(--accent-tint)]">
            <p className="flex items-center gap-2 text-[0.78rem] font-medium uppercase tracking-wide text-[var(--accent)]">
              <Icon name="sparkles" size={14} /> Priorité du jour
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[1.05rem] font-semibold leading-snug">{view.recommendation.title}</p>
                <p className="mt-1 max-w-[44rem] text-[0.88rem] leading-relaxed text-[var(--ink-soft)]">
                  {view.recommendation.body}
                </p>
              </div>
              {view.recommendation.cardIds.length > 0 && (
                <Link to={`/revisions?cards=${view.recommendation.cardIds.join(',')}`} className="shrink-0">
                  <Button>Réviser</Button>
                </Link>
              )}
            </div>
          </Card>
        )}

        {view.priorities.length === 0 ? (
          <EmptyHint title="Rien à classer pour l’instant.">
            Les priorités se calculent sur tes flashcards et tes réponses. Ajoute des cartes à tes cours, puis
            lance une séance.
          </EmptyHint>
        ) : (
          <PriorityList items={view.priorities} />
        )}
      </Reveal>

      {/* ═══ 3. PROCHAINES ÉVALUATIONS — dans l'ordre du calendrier. ═══ */}
      <Reveal className="mt-7">
        <SectionTitle hint="Lues dans ton calendrier, avec ton niveau de préparation en regard. Aucune date n’est déduite.">
          Prochaines évaluations
        </SectionTitle>
        <EvaluationsCard
          evaluations={view.evaluations}
          subjects={source.tables.subjects}
          readinessBySubject={readinessBySubject}
        />

        {/* Détail de la préparation : avec une date au calendrier c'est une
            préparation d'examen ; sans date, la matière la plus fragile. Rien
            n'est inventé dans les deux cas. */}
        {readinessFocus && (
          <div className="mt-3">
            <SectionTitle
              hint={
                readinessFocus.evaluation
                  ? 'Ton niveau croisé avec la date réelle de l’évaluation. La date change l’urgence, jamais la note.'
                  : 'Aucune date d’examen n’est enregistrée — la préparation reste estimable à partir de tes seules révisions.'
              }
            >
              {readinessFocus.evaluation ? 'Préparation à l’examen' : 'Suffisance examen'}
            </SectionTitle>
            <ReadinessPanel
              subjectName={readinessFocus.subject.name}
              readiness={readinessFocus.readiness}
              evaluation={readinessFocus.evaluation}
              chapters={focusChapters}
              chapterCardIds={focusChapterCards}
              reviseHref={focusReviseHref}
            />
          </div>
        )}
      </Reveal>

      {/* ═══ 4. PROGRESSION PAR MATIÈRE ═══ */}
      <Reveal className="mt-7">
        <SectionTitle hint="Touche une matière pour ouvrir le détail de ses chapitres.">
          Progression par matière
        </SectionTitle>
        {view.subjects.length === 0 ? (
          <EmptyHint title="Aucune matière ne contient encore de flashcard.">
            Ouvre un cours et génère ou saisis des cartes : la maîtrise, le taux de réussite et le temps passé se
            calculeront matière par matière.
          </EmptyHint>
        ) : (
          <ul className="flex flex-col gap-2" data-progress-subjects>
            {view.subjects.map((entry) => (
              <li key={entry.subject.id}>
                <SubjectRow
                  entry={entry}
                  readiness={view.readiness.find((row) => row.subject.id === entry.subject.id) ?? null}
                  open={openSubject === entry.subject.id}
                  onToggle={() =>
                    setOpenSubject((current) => (current === entry.subject.id ? null : entry.subject.id))
                  }
                  onFocusSubject={() => {
                    setSubjectId(entry.subject.id);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  chapters={openSubject === entry.subject.id ? chapters : []}
                />
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      {/* ═══ 5. POINTS FAIBLES ET POINTS FORTS — compacts, côte à côte. ═══ */}
      <Reveal className="mt-7">
        {/* Sans phrase d'accroche : les deux cartes juste en dessous
            s'intitulent « Tes points faibles » et « Tes points forts » et
            portent chacune son propre critère chiffré. La redire ici ne
            faisait qu'ajouter une ligne de préambule avant la première
            donnée. */}
        <SectionTitle>Points faibles et points forts</SectionTitle>
        <WeakStrongPair weak={weak} strengths={view.strengths} />
      </Reveal>

      {/* ═══ 6. ACTIVITÉ ET ÉVOLUTION — la progression dans le temps. ═══ */}
      <Reveal className="mt-8 mb-4">
        {/* Idem : la phrase se contentait d'énumérer les titres des cartes
            qui suivent immédiatement. */}
        <SectionTitle>Activité et évolution</SectionTitle>
        <SecondaryPanels
          activity={activity}
          time={time}
          trend={trend}
          goals={goals}
          streak={regularity}
          upcoming={upcoming}
          hasAnyCard={view.hasAnyCard}
          loadedAt={source.loadedAt}
          period={period}
          onPeriodChange={setPeriod}
          periodMs={periodMs}
          onEditGoals={() => setGoalsOpen(true)}
        />
      </Reveal>

      <GoalsModal
        open={goalsOpen}
        onClose={() => setGoalsOpen(false)}
        minutes={profile.weeklyStudyMinutesGoal}
        reviews={profile.weeklyReviewGoal}
        onSave={async (minutes, reviews) => {
          await saveProfile({ weeklyStudyMinutesGoal: minutes, weeklyReviewGoal: reviews });
          setGoalsOpen(false);
          notify('Objectifs enregistrés.', 'success');
        }}
      />
    </PageTransition>
  );
}

// ───────────────────────────── Sous-composants ─────────────────────────────

/**
 * Barre de suffisance : même forme que `MasteryBar`, mais teintée par le
 * NIVEAU de préparation et non par le palier de maîtrise. Une valeur absente
 * reste une piste grise et vide, jamais une barre à zéro.
 */
function ReadinessMiniBar({ pct, color }: { pct: number | null; color: string | null }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <span
        className="block h-full rounded-full"
        style={{
          width: `${pct ?? 0}%`,
          backgroundColor: color ?? 'var(--line-strong)',
          transition: 'width 700ms cubic-bezier(0.22, 0.61, 0.36, 1)',
        }}
      />
    </span>
  );
}

const chipClass = (active: boolean) =>
  'rounded-full border px-3 py-1.5 text-[0.83rem] transition-colors ' +
  (active
    ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-ink)]'
    : 'border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--surface-2)]');

/** Une matière, dépliable sur ses chapitres réels. */
function SubjectRow({
  entry,
  readiness,
  open,
  onToggle,
  onFocusSubject,
  chapters,
}: {
  entry: SubjectProgress;
  readiness: SubjectReadiness | null;
  open: boolean;
  onToggle: () => void;
  onFocusSubject: () => void;
  chapters: ChapterProgress[];
}) {
  const band = entry.masteryPct === null ? null : masteryBand(entry.masteryPct);
  return (
    <Card padded={false} className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-progress-subject-row
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[var(--surface-2)]"
      >
        <span
          aria-hidden
          className="h-8 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: entry.subject.color }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[1rem] font-medium">{entry.subject.name}</span>
              {/* Le palier en toutes lettres : « 62 % » demande un barème,
                  « Correct » se lit sans en connaître un. */}
              {band && (
                <span
                  data-progress-subject-band
                  className="shrink-0 rounded-full px-2 py-0.5 text-[0.72rem] font-medium"
                  style={{
                    color: band.colorVar,
                    backgroundColor: `color-mix(in srgb, ${band.colorVar} 14%, transparent)`,
                  }}
                >
                  {band.label}
                </span>
              )}
            </span>
            {readiness?.evaluation && (
              <span
                className="shrink-0 text-[0.8rem] font-medium"
                style={{ color: readiness.evaluation.daysUntil <= 3 ? 'var(--mastery-0)' : 'var(--mastery-1)' }}
              >
                {readiness.evaluation.label}{' '}
                {readiness.evaluation.daysUntil === 0
                  ? 'aujourd’hui'
                  : `dans ${readiness.evaluation.daysUntil} j`}
              </span>
            )}
          </span>

          {/* PROGRESSION et SUFFISANCE, chacune nommée et avec sa barre : ce
              sont deux mesures différentes, et les empiler ainsi est la seule
              façon de les comparer d'un coup d'œil sans les confondre (§25). */}
          <span className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
            <span className="text-[0.78rem] text-[var(--ink-soft)]">Progression</span>
            <MasteryBar pct={entry.masteryPct} />
            <span className="w-14 text-right text-[0.85rem] font-semibold tabular-nums">
              {entry.masteryPct === null ? '—' : `${entry.masteryPct} %`}
            </span>

            <span className="text-[0.78rem] text-[var(--ink-soft)]">Suffisance</span>
            <ReadinessMiniBar pct={readiness?.readiness.pct ?? null} color={readiness?.readiness.level?.colorVar ?? null} />
            <span
              className="w-14 text-right text-[0.85rem] font-semibold tabular-nums"
              style={{ color: readiness?.readiness.level?.colorVar ?? 'var(--ink-faint)' }}
            >
              {readiness == null || readiness.readiness.pct === null ? '—' : `${readiness.readiness.pct} %`}
            </span>
          </span>
          <span
            data-progress-subject-facts
            className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.8rem] text-[var(--ink-faint)]"
          >
            <span>{formatDuration(entry.studyMs)} de révision</span>
            <span>
              {entry.reviews} réponse{entry.reviews > 1 ? 's' : ''}
            </span>
            {entry.successRate !== null && <span>{Math.round(entry.successRate * 100)} % de réussite</span>}
            {/* Les cartes dues sont un FAIT du jour : elles se disent même
                quand la maîtrise n'est pas encore publiable. Le retard, quand
                il existe, est signalé à part et en couleur. */}
            {entry.dueCards > 0 && (
              <span>
                {entry.dueCards} carte{entry.dueCards > 1 ? 's' : ''} due{entry.dueCards > 1 ? 's' : ''}
                {entry.lateCards > 0 && (
                  <span style={{ color: 'var(--mastery-0)' }}>
                    {' '}
                    · dont {entry.lateCards} en retard
                  </span>
                )}
              </span>
            )}
            {/* Une matière sans chapitre afficherait « 0/0 chapitre étudié »,
                ce qui se lirait comme un échec alors qu'il n'y a simplement
                rien à découper. */}
            {entry.chaptersTotal > 0 && (
              <span>
                {entry.chaptersStudied}/{entry.chaptersTotal} chapitre
                {entry.chaptersTotal > 1 ? 's' : ''} étudié{entry.chaptersStudied > 1 ? 's' : ''}
              </span>
            )}
          </span>
        </span>
        <span
          aria-hidden
          className="shrink-0 text-[var(--ink-faint)] transition-transform duration-200"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
        >
          <Icon name="chevronRight" size={16} />
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--line)] px-4 py-3">
          {chapters.length === 0 ? (
            <p className="text-[0.85rem] text-[var(--ink-faint)]">
              Aucune carte n’est encore rattachée à un chapitre de cette matière.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={onFocusSubject}
                data-progress-focus-subject
                className="mb-3 rounded-full border border-[var(--line)] px-3 py-1.5 text-[0.8rem] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                Voir la préparation de cette matière
              </button>
              <ul className="flex flex-col gap-2.5" data-progress-chapters>
              {chapters.map((chapter) => (
                <li key={chapter.chapterId ?? 'orphan'} className="reveal">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[0.88rem]">{chapter.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[0.85rem] tabular-nums text-[var(--ink-soft)]">
                      <BandDot pct={chapter.masteryPct} size={7} />
                      {chapter.masteryPct === null ? '—' : `${chapter.masteryPct} %`}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <MasteryBar pct={chapter.masteryPct} height={4} />
                  </div>
                  <p className="mt-1 text-[0.76rem] text-[var(--ink-faint)]">
                    {chapter.cards} carte{chapter.cards > 1 ? 's' : ''}
                    {chapter.reviews > 0 && ` · ${chapter.reviews} réponse${chapter.reviews > 1 ? 's' : ''}`}
                    {chapter.successRate !== null && ` · ${Math.round(chapter.successRate * 100)} % de réussite`}
                    {chapter.reviewedCards === 0 && ' · jamais révisé'}
                  </p>
                </li>
              ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function GoalsModal({
  open,
  onClose,
  minutes,
  reviews,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  minutes: number;
  reviews: number;
  onSave: (minutes: number, reviews: number) => void | Promise<void>;
}) {
  const [minutesValue, setMinutesValue] = useState(String(minutes));
  const [reviewsValue, setReviewsValue] = useState(String(reviews));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Objectifs hebdomadaires"
      description="Ils servent uniquement de repère : ils n’entrent dans aucune statistique."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={() =>
              onSave(
                Math.max(0, Math.round(Number(minutesValue) || 0)),
                Math.max(0, Math.round(Number(reviewsValue) || 0)),
              )
            }
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Temps de révision par semaine (minutes)"
          type="number"
          min={0}
          value={minutesValue}
          onChange={(event) => setMinutesValue(event.target.value)}
        />
        <Input
          label="Réponses par semaine"
          type="number"
          min={0}
          value={reviewsValue}
          onChange={(event) => setReviewsValue(event.target.value)}
        />
      </div>
    </Modal>
  );
}
