import { Link } from 'react-router-dom';
import { Button, Card, Icon, SegmentedControl } from '@/components/ui';
import { EmptyHint, GoalBar } from './ProgressBits';
import { StudyTimeChart } from './StudyTimeChart';
import { TrendChart } from './TrendChart';
import { formatDuration } from '@/core/progress';
import type {
  ActivitySession,
  GoalProgress,
  Streak,
  StudyTime,
  TrendPoint,
  UpcomingDay,
} from '@/core/progress';
import { dayKey, parseDayKey } from '@/lib/date';

/**
 * BANDE SECONDAIRE — activité, temps, évolution, objectifs, régularité,
 * prochaines révisions.
 *
 * Ces informations sont utiles mais ne pilotent pas la journée : elles sont
 * donc traitées comme secondaires, et cela se voit — titres plus petits, deux
 * colonnes, cartes plus denses. La hiérarchie n'est pas une question de goût :
 * si tout a la même taille, plus rien ne ressort.
 *
 * `content-visibility: auto` laisse le navigateur sauter la mise en page de
 * ce qui est encore hors écran, sans rien retirer du DOM ni de
 * l'accessibilité.
 */

const PERIOD_SEGMENTS = [
  { value: 'week' as const, label: 'Semaine' },
  { value: 'month' as const, label: 'Mois' },
  { value: 'all' as const, label: 'Tout' },
];
export type Period = (typeof PERIOD_SEGMENTS)[number]['value'];

const WEEKDAY_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const WEEK_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function PanelTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[0.95rem] font-semibold leading-tight text-[var(--ink)]">{children}</h3>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SecondaryPanels({
  activity,
  time,
  trend,
  goals,
  streak,
  upcoming,
  hasAnyCard,
  loadedAt,
  period,
  onPeriodChange,
  periodMs,
  onEditGoals,
}: {
  activity: ActivitySession[];
  time: StudyTime;
  trend: TrendPoint[];
  goals: GoalProgress[];
  streak: Streak;
  upcoming: UpcomingDay[];
  hasAnyCard: boolean;
  loadedAt: number;
  period: Period;
  onPeriodChange: (period: Period) => void;
  periodMs: number;
  onEditGoals: () => void;
}) {
  const todayIndex = time.week.findIndex((bucket) => bucket.day === dayKey(new Date(loadedAt)));

  return (
    <div
      // `items-start` : chaque carte prend la hauteur de son contenu. Sans
      // cela, la grille les étire toutes sur la plus haute et une carte à une
      // seule ligne se retrouve avec 300 px de vide.
      className="mt-4 grid grid-cols-1 items-start gap-3 lg:grid-cols-2"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '1px 24rem' }}
    >
      {/* ── Activité récente ── */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-4 pt-4">
          <PanelTitle>Activité récente</PanelTitle>
        </div>
        {activity.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyHint title="Aucune séance enregistrée pour l’instant.">
              Dès ta première révision, chaque séance apparaît ici avec son volume, son taux de réussite et son
              temps.
            </EmptyHint>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]" data-progress-activity>
            {activity.slice(0, 5).map((session) => (
              <li key={session.id}>
                <Link
                  to={`/cours/${session.subjectId}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
                >
                  <span className="w-[5rem] shrink-0 text-[0.78rem] text-[var(--ink-faint)]">
                    {relativeDayLabel(session.day, loadedAt)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.88rem] font-medium">{session.subjectName}</span>
                    <span className="mt-0.5 block text-[0.78rem] text-[var(--ink-soft)]">
                      {session.reviews} réponse{session.reviews > 1 ? 's' : ''} ·{' '}
                      {Math.round((session.correct / session.reviews) * 100)} % · {formatDuration(session.ms)}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={14} className="shrink-0 text-[var(--ink-faint)]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Temps d'étude ── */}
      <Card>
        <PanelTitle
          action={
            <SegmentedControl size="sm" segments={PERIOD_SEGMENTS} value={period} onChange={onPeriodChange} />
          }
        >
          Temps d’étude
        </PanelTitle>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span data-progress-period-total className="text-[1.5rem] font-semibold leading-none tabular-nums">
            {periodMs > 0 ? formatDuration(periodMs) : '—'}
          </span>
          <span className="text-[0.82rem] text-[var(--ink-faint)]">
            {period === 'week' ? 'cette semaine' : period === 'month' ? 'ce mois' : 'depuis le début'}
            {period === 'week' && time.weekDeltaPct !== null && (
              <span
                style={{ color: time.weekDeltaPct >= 0 ? 'var(--mastery-3)' : 'var(--mastery-0)' }}
              >
                {' '}
                · {time.weekDeltaPct >= 0 ? '+' : ''}
                {time.weekDeltaPct} % vs semaine dernière
              </span>
            )}
          </span>
        </div>
        <div className="mt-4">
          <StudyTimeChart week={time.week} todayIndex={todayIndex} />
        </div>
        <p className="mt-3 text-[0.78rem] leading-snug text-[var(--ink-faint)]">
          Seul le temps passé à répondre aux cartes est chronométré ; la lecture d’un PDF ne l’est pas encore.
          {time.bestDay && ` Meilleur jour : ${longDayLabel(time.bestDay.day)}, ${formatDuration(time.bestDay.ms)}.`}
        </p>
      </Card>

      {/* ── Évolution ── */}
      <Card>
        <PanelTitle>Évolution</PanelTitle>
        {trend.length >= 2 ? (
          <>
            <TrendChart points={trend} />
            <p className="mt-2 text-[0.75rem] leading-relaxed text-[var(--ink-faint)]">
              Reconstruite en rejouant tes révisions dans l’algorithme de planification — pas un historique
              approximé.
            </p>
          </>
        ) : (
          <EmptyHint title="Continue à étudier pour voir ton évolution ici.">
            Il faut au moins deux semaines de révisions enregistrées pour tracer une courbe.
          </EmptyHint>
        )}
      </Card>

      {/* ── Objectifs ── */}
      <Card>
        <PanelTitle
          action={
            <Button size="sm" variant="secondary" onClick={onEditGoals}>
              Modifier
            </Button>
          }
        >
          Objectifs
        </PanelTitle>
        <ul className="flex flex-col gap-3.5" data-progress-goals>
          {goals.map((goal) => (
            <li key={goal.label}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[0.86rem] font-medium">{goal.label}</span>
                <span className="text-[0.82rem] tabular-nums text-[var(--ink-soft)]">
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
        <p className="mt-3 text-[0.75rem] text-[var(--ink-faint)]">
          Enregistrés dans ton profil, remis à zéro chaque lundi.
        </p>
      </Card>

      {/* ── Régularité ── */}
      <Card>
        <PanelTitle>Régularité</PanelTitle>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[1.4rem] font-semibold leading-none tabular-nums" data-progress-streak>
              {streak.current} jour{streak.current > 1 ? 's' : ''}
            </p>
            <p className="mt-1.5 max-w-[16rem] text-[0.82rem] leading-snug text-[var(--ink-soft)]">
              {streak.current === 0
                ? 'Aucune série en cours — une seule révision suffit à la relancer.'
                : streak.current >= streak.longest
                  ? 'C’est ta meilleure série. Continue comme ça.'
                  : `Ta meilleure série reste de ${streak.longest} jours.`}
            </p>
          </div>
          <ul className="flex gap-1.5" aria-label="Jours de la semaine avec activité">
            {streak.week.map((day, index) => (
              <li key={day.day} className="flex flex-col items-center gap-1">
                <span className="text-[0.7rem] text-[var(--ink-faint)]">{WEEK_INITIALS[index]}</span>
                <span
                  title={day.day}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[0.72rem]"
                  style={
                    day.active
                      ? { backgroundColor: 'var(--mastery-3)', color: '#fff' }
                      : day.isToday
                        ? { border: '1px solid var(--accent)', color: 'var(--accent)' }
                        : day.isFuture
                          ? { border: '1px dashed var(--line)', color: 'var(--ink-faint)' }
                          : { backgroundColor: 'var(--surface-2)', color: 'var(--ink-faint)' }
                  }
                >
                  {day.active ? '✓' : day.isFuture ? '' : '·'}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-[0.78rem] text-[var(--ink-faint)]">
          {streak.totalActiveDays} jour{streak.totalActiveDays > 1 ? 's' : ''} d’étude enregistré
          {streak.totalActiveDays > 1 ? 's' : ''} au total.
        </p>
      </Card>

      {/* ── Prochaines révisions ── */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-4 pt-4">
          <PanelTitle>Prochaines révisions</PanelTitle>
        </div>
        {!hasAnyCard ? (
          <div className="px-4 pb-4">
            <EmptyHint title="Aucune carte planifiée.">
              La répétition espacée programme chaque carte dès sa première révision.
            </EmptyHint>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]" data-progress-upcoming>
            {upcoming
              .filter((day) => day.cards > 0)
              .map((day) => (
                <li key={day.day} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-[6rem] shrink-0 text-[0.83rem] font-medium">{day.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[0.82rem] text-[var(--ink-soft)]">
                    {day.subjects.map((s) => `${s.name} (${s.cards})`).join(' · ')}
                  </span>
                  <span className="shrink-0 text-[0.8rem] tabular-nums text-[var(--ink-faint)]">
                    {day.cards} carte{day.cards > 1 ? 's' : ''}
                  </span>
                </li>
              ))}
            {upcoming.every((day) => day.cards === 0) && (
              <li className="px-4 py-4 text-[0.84rem] text-[var(--ink-soft)]">
                Rien de programmé sur les sept prochains jours. Tes cartes sont à jour.
              </li>
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}

function longDayLabel(day: string): string {
  const label = WEEKDAY_LONG.format(parseDayKey(day));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function relativeDayLabel(day: string, loadedAt: number): string {
  const today = dayKey(new Date(loadedAt));
  if (day === today) return 'Aujourd’hui';
  if (day === dayKey(new Date(loadedAt - 86_400_000))) return 'Hier';
  return DAY_MONTH.format(parseDayKey(day));
}
