import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageTransition } from '@/components/layout/PageTransition';
import { FadeUp, Stagger, StaggerItem } from '@/components/motion/Motion';
import { Button, Card, EmptyState, Icon, Input, Modal, SegmentedControl, useToast } from '@/components/ui';
import {
  BandDot,
  EmptyHint,
  GoalBar,
  MasteryBar,
  MasteryRing,
  SectionTitle,
  StatTile,
} from '@/components/features/progress/ProgressBits';
import { StudyTimeChart } from '@/components/features/progress/StudyTimeChart';
import { TrendChart } from '@/components/features/progress/TrendChart';
import { ReadinessPanel } from '@/components/features/progress/ReadinessPanel';
import { EvaluationsCard } from '@/components/features/progress/EvaluationsCard';
import { PriorityList } from '@/components/features/progress/PriorityList';
import { useProgress } from '@/hooks/useProgress';
import { useProfile } from '@/hooks/useProfile';
import { saveProfile } from '@/data/repositories/profile';
import { progressView } from '@/core/progress/view';
import {
  chapterProgress,
  formatDuration,
  MIN_REVIEWED_CARDS,
  type AnswerStats,
  type ChapterProgress,
  type SubjectProgress,
} from '@/core/progress';
import { readinessLevel } from '@/core/progress/exam';
import type { SubjectReadiness } from '@/core/progress/view';
import { dayKey, parseDayKey } from '@/lib/date';
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

const PERIOD_SEGMENTS = [
  { value: 'week' as const, label: 'Semaine' },
  { value: 'month' as const, label: 'Mois' },
  { value: 'all' as const, label: 'Tout' },
];
type Period = (typeof PERIOD_SEGMENTS)[number]['value'];

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

  const hero = (
    <FadeUp>
      <h1 className="text-[1.9rem] leading-tight">Progression</h1>
      <p className="mt-2 max-w-[46rem] text-[0.95rem] leading-relaxed text-[var(--ink-soft)]">
        Suis ta progression, identifie tes points faibles et concentre tes révisions là où elles sont les plus
        utiles.
      </p>
    </FadeUp>
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
  const todayIndex = time.week.findIndex((bucket) => bucket.day === dayKey(new Date(source.loadedAt)));
  const periodMs = period === 'week' ? time.weekMs : period === 'month' ? time.monthMs : view.totalStudyMs;
  const activeSubject = source.tables.subjects.find((s) => s.id === subjectId) ?? null;

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
        </FadeUp>
      )}

      {/* ── RÉSUMÉ GLOBAL ── */}
      <Stagger className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" as="ul">
        <StaggerItem as="li">
          <StatTile
            label="Maîtrise"
            icon={<Icon name="progress" size={14} />}
            value={mastery.pct === null ? '—' : `${mastery.pct} %`}
            detail={
              mastery.pct === null
                ? `${mastery.reviewedCards}/${MIN_REVIEWED_CARDS} cartes révisées`
                : `${mastery.reviewedCards} carte${mastery.reviewedCards > 1 ? 's' : ''} sur ${mastery.totalCards} travaillée${mastery.reviewedCards > 1 ? 's' : ''}`
            }
          />
        </StaggerItem>
        <StaggerItem as="li">
          <StatTile
            label="Temps"
            icon={<Icon name="review" size={14} />}
            value={time.weekMs > 0 ? formatDuration(time.weekMs) : '—'}
            detail={
              time.weekDeltaPct === null
                ? 'cette semaine'
                : `${time.weekDeltaPct >= 0 ? '+' : ''}${time.weekDeltaPct} % vs semaine dernière`
            }
            tone={time.weekDeltaPct === null ? 'neutral' : time.weekDeltaPct >= 0 ? 'up' : 'down'}
          />
        </StaggerItem>
        <StaggerItem as="li">
          {/* SUFFISANCE EXAMEN — distincte de la maîtrise (§25). Sans matière
              mesurable, elle affiche « — » et dit ce qui manque, jamais 0 %. */}
          <StatTile
            label="Suffisance examen"
            icon={<Icon name="quiz" size={14} />}
            value={view.globalReadiness === null ? '—' : `${view.globalReadiness.pct} %`}
            detail={
              view.globalReadiness === null
                ? 'données insuffisantes'
                : view.globalReadiness.subjects === 1
                  ? readinessLabel(view.globalReadiness.pct)
                  : `moyenne de ${view.globalReadiness.subjects} matières`
            }
          />
        </StaggerItem>
        <StaggerItem as="li">
          <StatTile
            label="À revoir"
            icon={<Icon name="quiz" size={14} />}
            value={view.chaptersToReview > 0 ? view.chaptersToReview : view.dueTotal}
            detail={
              view.chaptersToReview > 0
                ? `chapitre${view.chaptersToReview > 1 ? 's' : ''} sous 75 % de réussite`
                : `carte${view.dueTotal > 1 ? 's' : ''} due${view.dueTotal > 1 ? 's' : ''} aujourd’hui`
            }
            tone={view.chaptersToReview > 0 ? 'warning' : 'neutral'}
          />
        </StaggerItem>
      </Stagger>

      {/* ── RECOMMANDATION PRINCIPALE (§19) ── */}
      <section className="mt-8">
        <SectionTitle hint="Une seule action, choisie à partir de ce qui est mesuré — pas un conseil générique.">
          Recommandation
        </SectionTitle>
        {view.recommendation === null ? (
          <EmptyHint title="Aucune priorité ne peut encore être établie.">
            La recommandation croise ta maîtrise, ton taux d’erreur, l’ancienneté de tes révisions et — si une date
            est inscrite au calendrier — la proximité d’une évaluation. Il faut donc au moins une séance
            enregistrée.
          </EmptyHint>
        ) : (
          <Card data-progress-reco className="border-[var(--accent)]/40">
            <p className="flex items-center gap-2 text-[0.8rem] font-medium uppercase tracking-wide text-[var(--accent)]">
              <Icon name="sparkles" size={14} /> Priorité du jour
            </p>
            <p className="mt-2 text-[1.15rem] font-semibold leading-snug">{view.recommendation.title}</p>
            <p className="mt-1.5 max-w-[46rem] text-[0.9rem] leading-relaxed text-[var(--ink-soft)]">
              {view.recommendation.body}
            </p>
            {view.recommendation.cardIds.length > 0 && (
              <Link to={`/revisions?cards=${view.recommendation.cardIds.join(',')}`} className="mt-4 inline-block">
                <Button>Commencer</Button>
              </Link>
            )}
          </Card>
        )}
      </section>

      {/* ── À TRAVAILLER EN PRIORITÉ (§12/§13) ── */}
      <section className="mt-8">
        <SectionTitle
          hint={
            view.evaluations.length > 0
              ? 'Classement piloté par ta faiblesse mesurée, accéléré par les échéances de ton calendrier.'
              : 'Classement piloté par ta faiblesse mesurée. Aucune date d’examen n’est nécessaire.'
          }
        >
          À travailler en priorité
        </SectionTitle>
        {view.priorities.length === 0 ? (
          <EmptyHint title="Rien à classer pour l’instant.">
            Les priorités se calculent sur tes flashcards et tes réponses. Ajoute des cartes à tes cours, puis
            lance une séance : le classement apparaîtra dès la première.
          </EmptyHint>
        ) : (
          <PriorityList items={view.priorities} />
        )}
      </section>

      {/* ── PROCHAINES ÉVALUATIONS (§8) ── */}
      <section className="mt-8">
        <SectionTitle hint="Lues dans ton calendrier. Aucune date n’est déduite ni supposée.">
          Prochaines évaluations
        </SectionTitle>
        <EvaluationsCard evaluations={view.evaluations} subjects={source.tables.subjects} />
      </section>

      {/* ── SUFFISANCE EXAMEN (§5/§6/§9/§10/§14) ──
          Avec une date au calendrier, la carte devient une préparation
          d'examen ; sans date, elle reste pleinement utile en montrant la
          matière la plus fragile. Rien n'est inventé dans les deux cas. */}
      {readinessFocus && (
        <section className="mt-8">
          <SectionTitle
            hint={
              readinessFocus.evaluation
                ? 'Croise ta maîtrise, ta couverture, ta fiabilité et la fraîcheur de tes révisions avec la date réelle de l’évaluation.'
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
        </section>
      )}

      {/* ── MAÎTRISE GLOBALE + ÉVOLUTION ── */}
      <section className="mt-8">
        <SectionTitle hint="Basé sur tes performances réelles dans les flashcards et les révisions.">
          Ma progression{activeSubject ? ` — ${activeSubject.name}` : ''}
        </SectionTitle>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:items-center sm:gap-5">
            <MasteryRing pct={mastery.pct} size={132} />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="text-[1rem] font-semibold">Maîtrise globale</p>
              {mastery.pct === null ? (
                <>
                  <p className="mt-1.5 text-[0.87rem] leading-relaxed text-[var(--ink-soft)]">
                    Pas assez de données pour calculer ta maîtrise.
                  </p>
                  <p className="mt-1.5 text-[0.83rem] leading-relaxed text-[var(--ink-faint)]">
                    Il manque {mastery.missing} carte{mastery.missing > 1 ? 's' : ''} révisée
                    {mastery.missing > 1 ? 's' : ''}. Lance une séance de révision : la maîtrise se calcule à partir
                    de l’intervalle atteint et de la facilité ressentie sur chaque carte.
                  </p>
                  <AnswerCounters answers={view.answers} cards={mastery.totalCards} />
                  <Link to="/revisions" className="mt-3 inline-block">
                    <Button size="sm">Commencer une séance</Button>
                  </Link>
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-[0.87rem] leading-relaxed text-[var(--ink-soft)]">
                    Moyenne sur tes {mastery.totalCards} carte{mastery.totalCards > 1 ? 's' : ''}.
                  </p>
                  <p className="mt-1.5 text-[0.8rem] leading-relaxed text-[var(--ink-faint)]">
                    Une carte jamais révisée compte 0 %, une carte espacée sur deux mois 100 %.
                  </p>
                  <AnswerCounters answers={view.answers} cards={mastery.totalCards} />
                </>
              )}
            </div>
          </Card>

          <Card>
            <p className="text-[1rem] font-semibold">Évolution</p>
            {trend.length >= 2 ? (
              <div className="mt-2">
                <TrendChart points={trend} />
                <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
                  Reconstruit en rejouant tes révisions dans l’algorithme de planification — pas un historique
                  approximé.
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <EmptyHint title="Ton évolution apparaîtra ici après plusieurs sessions.">
                  Il faut au moins deux semaines de révisions enregistrées pour tracer une courbe. Chaque réponse
                  donnée alimente cet historique.
                </EmptyHint>
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ── PROGRESSION PAR MATIÈRE ── */}
      <section className="mt-8">
        <SectionTitle hint="Les matières viennent de tes cours ; une matière sans carte n’apparaît pas.">
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
      </section>

      {/* ── POINTS FAIBLES ET POINTS FORTS (§17/§18) ── */}
      <section className="mt-8">
        <SectionTitle hint="Mesurés sur ton taux de réussite réel, jamais devinés.">Tes points faibles</SectionTitle>
        {weak.length === 0 ? (
          <EmptyHint title="Tes points faibles apparaîtront ici après quelques sessions d’étude.">
            Un chapitre devient un point faible quand tu y as donné au moins 3 réponses et que moins de 75 % sont
            correctes.
          </EmptyHint>
        ) : (
          <ul className="flex flex-col gap-2" data-progress-weak>
            {weak.map((point, index) => (
              <li key={point.id}>
                <Card className="flex flex-wrap items-center gap-3">
                  <span className="w-5 shrink-0 text-[0.95rem] font-semibold tabular-nums text-[var(--ink-faint)]">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.95rem] font-medium" title={point.title}>
                      {point.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.82rem] text-[var(--ink-soft)]">
                      <span className="text-[var(--danger)]">
                        {Math.round(point.successRate * 100)} % de réussite
                      </span>
                      <span className="text-[var(--ink-faint)]">·</span>
                      <span className="text-[var(--ink-faint)]">
                        {point.reviews} réponse{point.reviews > 1 ? 's' : ''}
                      </span>
                      {point.subjectName && (
                        <>
                          <span className="text-[var(--ink-faint)]">·</span>
                          <span className="text-[var(--ink-faint)]">{point.subjectName}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <Link to={`/revisions?cards=${point.cardIds.join(',')}`} className="shrink-0">
                    <Button size="sm" variant="secondary">
                      Réviser
                    </Button>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── POINTS FORTS (§18) — uniquement des chapitres réellement solides.
             La liste est vide quand rien n'atteint le seuil : on ne comble pas
             une colonne avec le « moins mauvais ». ── */}
      <section className="mt-8">
        <SectionTitle hint="Chapitres dont la maîtrise mesurée dépasse 80 %.">Tes points forts</SectionTitle>
        {view.strengths.length === 0 ? (
          <EmptyHint title="Aucun chapitre n’atteint encore ce niveau.">
            Un chapitre entre ici quand la maîtrise moyenne de ses cartes dépasse 80 % — c’est-à-dire quand la
            répétition espacée les a réellement espacées dans le temps.
          </EmptyHint>
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-[var(--line)]" data-progress-strengths>
              {view.strengths.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: 'var(--success)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.92rem] font-medium">{item.chapterName}</span>
                    <span className="mt-0.5 block text-[0.8rem] text-[var(--ink-faint)]">
                      {item.subjectName}
                      {item.reviews > 0 && ` · ${item.reviews} réponse${item.reviews > 1 ? 's' : ''}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.9rem] font-semibold tabular-nums text-[var(--success)]">
                    {item.masteryPct} %
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* ── ACTIVITÉ RÉCENTE ── */}
      <section className="mt-8">
        <SectionTitle hint="Reconstruite depuis le journal de révisions : une ligne par jour et par matière.">
          Activité récente
        </SectionTitle>
        {activity.length === 0 ? (
          <EmptyHint title="Aucune séance enregistrée pour l’instant.">
            Dès ta première révision, chaque séance apparaît ici avec le nombre de réponses, le taux de réussite et
            le temps passé.
          </EmptyHint>
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-[var(--line)]" data-progress-activity>
              {activity.map((session) => (
                <li key={session.id}>
                  <Link
                    to={`/cours/${session.subjectId}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span className="w-[5.5rem] shrink-0 text-[0.8rem] text-[var(--ink-faint)]">
                      {relativeDayLabel(session.day, source.loadedAt)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.92rem] font-medium">{session.subjectName}</span>
                      <span className="mt-0.5 block text-[0.82rem] text-[var(--ink-soft)]">
                        {session.reviews} réponse{session.reviews > 1 ? 's' : ''} ·{' '}
                        {Math.round((session.correct / session.reviews) * 100)} % · {formatDuration(session.ms)}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={14} className="shrink-0 text-[var(--ink-faint)]" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* ── TEMPS D'ÉTUDE ── */}
      <section className="mt-8">
        <SectionTitle
          hint="Seul le temps passé à répondre aux cartes est chronométré ; la lecture d’un PDF ne l’est pas encore."
          action={
            <SegmentedControl size="sm" segments={PERIOD_SEGMENTS} value={period} onChange={setPeriod} />
          }
        >
          Temps d’étude
        </SectionTitle>
        <Card>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span data-progress-period-total className="text-[1.9rem] font-semibold leading-none tabular-nums">
              {periodMs > 0 ? formatDuration(periodMs) : '—'}
            </span>
            <span className="text-[0.85rem] text-[var(--ink-faint)]">
              {period === 'week' ? 'cette semaine' : period === 'month' ? 'ce mois' : 'depuis le début'}
              {period === 'week' && time.weekDeltaPct !== null && (
                <span className={time.weekDeltaPct >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                  {' '}
                  · {time.weekDeltaPct >= 0 ? '+' : ''}
                  {time.weekDeltaPct} % vs semaine dernière
                </span>
              )}
            </span>
          </div>
          <div className="mt-5">
            <StudyTimeChart week={time.week} todayIndex={todayIndex} />
          </div>
          {time.bestDay && (
            <p className="mt-3 text-[0.83rem] text-[var(--ink-faint)]">
              Ton meilleur jour cette semaine : {longDayLabel(time.bestDay.day)} —{' '}
              {formatDuration(time.bestDay.ms)}.
            </p>
          )}
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.83rem] text-[var(--ink-soft)]">
            <span>Aujourd’hui : {formatDuration(time.todayMs)}</span>
            <span>Ce mois : {formatDuration(time.monthMs)}</span>
          </p>
        </Card>
      </section>

      {/* ── OBJECTIFS ── */}
      <section className="mt-8">
        <SectionTitle
          hint="Tes objectifs sont enregistrés dans ton profil et se réinitialisent chaque lundi."
          action={
            <Button size="sm" variant="secondary" onClick={() => setGoalsOpen(true)}>
              Modifier
            </Button>
          }
        >
          Objectifs
        </SectionTitle>
        <Card>
          <ul className="flex flex-col gap-4" data-progress-goals>
            {goals.map((goal) => (
              <li key={goal.label}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-[0.9rem] font-medium">{goal.label}</span>
                  <span className="text-[0.85rem] tabular-nums text-[var(--ink-soft)]">
                    {goal.kind === 'minutes'
                      ? `${formatDuration(goal.currentMs ?? goal.current * 60_000)} / ${formatDuration(goal.target * 60_000)}`
                      : `${goal.current} / ${goal.target}`}
                    <span className="ml-2 text-[var(--ink-faint)]">{goal.pct} %</span>
                  </span>
                </div>
                <GoalBar pct={goal.pct} />
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* ── RÉGULARITÉ ── */}
      <section className="mt-8">
        <SectionTitle hint="Un jour compte dès qu’au moins une réponse y a été enregistrée.">Régularité</SectionTitle>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[1.6rem] font-semibold leading-none tabular-nums" data-progress-streak>
                {regularity.current} jour{regularity.current > 1 ? 's' : ''}
              </p>
              <p className="mt-1.5 text-[0.85rem] text-[var(--ink-soft)]">
                {regularity.current === 0
                  ? 'Aucune série en cours — une seule révision suffit à la relancer.'
                  : regularity.current >= regularity.longest
                    ? 'C’est ta meilleure série. Continue comme ça.'
                    : `Ta meilleure série reste de ${regularity.longest} jours.`}
              </p>
            </div>
            <ul className="flex gap-1.5" aria-label="Jours de la semaine avec activité">
              {regularity.week.map((day, index) => (
                <li key={day.day} className="flex flex-col items-center gap-1">
                  <span className="text-[0.7rem] text-[var(--ink-faint)]">{['L', 'M', 'M', 'J', 'V', 'S', 'D'][index]}</span>
                  <span
                    title={day.day}
                    className={
                      'flex h-8 w-8 items-center justify-center rounded-full text-[0.75rem] ' +
                      (day.active
                        ? 'bg-[var(--success)] text-white'
                        : day.isToday
                          ? 'border border-[var(--accent)] text-[var(--accent)]'
                          : day.isFuture
                            ? 'border border-dashed border-[var(--line)] text-[var(--ink-faint)]'
                            : 'bg-[var(--surface-2)] text-[var(--ink-faint)]')
                    }
                  >
                    {day.active ? '✓' : day.isFuture ? '' : '·'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-[0.83rem] text-[var(--ink-faint)]">
            {regularity.totalActiveDays} jour{regularity.totalActiveDays > 1 ? 's' : ''} d’étude enregistré
            {regularity.totalActiveDays > 1 ? 's' : ''} au total.
          </p>
        </Card>
      </section>

      {/* ── PROCHAINES RÉVISIONS ── */}
      <section className="mt-8 mb-4">
        <SectionTitle hint="Échéances réelles calculées par la répétition espacée.">Prochaines révisions</SectionTitle>
        {!view.hasAnyCard ? (
          <EmptyHint title="Aucune carte planifiée.">
            La répétition espacée programme chaque carte dès sa première révision : les prochaines échéances
            s’afficheront ici.
          </EmptyHint>
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-[var(--line)]" data-progress-upcoming>
              {upcoming
                .filter((day) => day.cards > 0)
                .map((day) => (
                  <li key={day.day} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-[6.5rem] shrink-0 text-[0.85rem] font-medium">{day.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.85rem] text-[var(--ink-soft)]">
                      {day.subjects.map((s) => `${s.name} (${s.cards})`).join(' · ')}
                    </span>
                    <span className="shrink-0 text-[0.82rem] tabular-nums text-[var(--ink-faint)]">
                      {day.cards} carte{day.cards > 1 ? 's' : ''}
                    </span>
                  </li>
                ))}
              {upcoming.every((day) => day.cards === 0) && (
                <li className="px-4 py-4 text-[0.86rem] text-[var(--ink-soft)]">
                  Rien de programmé sur les sept prochains jours. Tes cartes sont à jour.
                </li>
              )}
            </ul>
          </Card>
        )}
      </section>

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
 * Compteurs bruts sous l'anneau : uniquement ce que l'application enregistre
 * réellement. Le taux de réussite n'apparaît qu'au-delà du seuil de
 * fiabilité, et les quiz n'y figurent pas puisqu'aucune réponse de quiz
 * n'existe.
 */
function AnswerCounters({ answers, cards }: { answers: AnswerStats; cards: number }) {
  return (
    <p data-progress-counters className="mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.8rem] text-[var(--ink-soft)]">
      <span>
        {cards} flashcard{cards > 1 ? 's' : ''}
      </span>
      <span className="text-[var(--ink-faint)]">·</span>
      <span>
        {answers.total} réponse{answers.total > 1 ? 's' : ''}
      </span>
      {answers.successRate !== null && (
        <>
          <span className="text-[var(--ink-faint)]">·</span>
          <span>{Math.round(answers.successRate * 100)} % de réussite</span>
        </>
      )}
    </p>
  );
}

/** Libellé du niveau de préparation — même barème que `ReadinessPanel`. */
const readinessLabel = (pct: number) => readinessLevel(pct).label.toLowerCase();

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
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[1rem] font-medium">{entry.subject.name}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-[0.9rem] font-semibold tabular-nums">
              <BandDot pct={entry.masteryPct} />
              {entry.masteryPct === null ? '—' : `${entry.masteryPct} %`}
            </span>
          </span>
          <span className="mt-2 block">
            <MasteryBar pct={entry.masteryPct} />
          </span>
          {/* PROGRESSION et SUFFISANCE côte à côte, nommées : ce sont deux
              mesures différentes et les confondre viderait la seconde de son
              sens (§25). */}
          <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8rem]">
            <span className="flex items-center gap-1.5 text-[var(--ink-soft)]">
              Suffisance examen
              <span
                className="font-semibold tabular-nums"
                style={{
                  color:
                    readiness?.readiness.level?.colorVar ?? 'var(--ink-faint)',
                }}
              >
                {readiness?.readiness.pct === null || readiness === null
                  ? 'données insuffisantes'
                  : `${readiness.readiness.pct} %`}
              </span>
            </span>
            {readiness?.evaluation && (
              <span className="text-[var(--warning)]">
                {readiness.evaluation.label}{' '}
                {readiness.evaluation.daysUntil === 0
                  ? 'aujourd’hui'
                  : `dans ${readiness.evaluation.daysUntil} j`}
              </span>
            )}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.8rem] text-[var(--ink-faint)]">
            <span>{formatDuration(entry.studyMs)} de révision</span>
            <span>
              {entry.reviews} réponse{entry.reviews > 1 ? 's' : ''}
            </span>
            {entry.successRate !== null && <span>{Math.round(entry.successRate * 100)} % de réussite</span>}
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

// ───────────────────────────── Formatage local ─────────────────────────────

const WEEKDAY_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

function longDayLabel(day: string): string {
  const label = WEEKDAY_LONG.format(parseDayKey(day));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function relativeDayLabel(day: string, loadedAt: number): string {
  const today = dayKey(new Date(loadedAt));
  if (day === today) return 'Aujourd’hui';
  const yesterday = dayKey(new Date(loadedAt - 86_400_000));
  if (day === yesterday) return 'Hier';
  return DAY_MONTH.format(parseDayKey(day));
}
