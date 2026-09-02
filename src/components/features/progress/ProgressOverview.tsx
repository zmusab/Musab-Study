import type { ReactNode } from 'react';
import { formatDuration, masteryBand, type AnswerStats, type Streak, type StudyTime } from '@/core/progress';
import { readinessLevel } from '@/core/progress/exam';

/**
 * VUE D'ENSEMBLE — « où j'en suis », en trois secondes et rien d'autre.
 *
 * Cinq mesures côte à côte, toutes déjà calculées ailleurs dans la page :
 * progression, suffisance examen, temps étudié, volume de révision et
 * régularité. Aucune n'est inventée pour remplir la ligne — celles qui ne
 * sont pas encore mesurables affichent un tiret et disent ce qui manque.
 *
 * Ce bandeau ne contient AUCUNE action : ce qu'il faut faire vient juste en
 * dessous, dans « À faire maintenant ». Mélanger l'état et l'action dans le
 * même bloc était précisément ce qui rendait le haut de page confus.
 */
export function ProgressOverview({
  masteryPct,
  masteryMissing,
  totalCards,
  answers,
  readinessPct,
  readinessSubjects,
  time,
  streak,
}: {
  masteryPct: number | null;
  /** Cartes qu'il reste à réviser avant que la maîtrise soit publiable. */
  masteryMissing: number;
  totalCards: number;
  answers: AnswerStats;
  readinessPct: number | null;
  /** Nombre de matières entrant dans la moyenne de suffisance. */
  readinessSubjects: number;
  time: StudyTime;
  streak: Streak;
}) {
  const band = masteryPct === null ? null : masteryBand(masteryPct);
  const level = readinessPct === null ? null : readinessLevel(readinessPct);
  const activeThisWeek = streak.week.filter((day) => day.active).length;

  return (
    <section
      data-progress-hero
      aria-label="Vue d’ensemble de ta progression"
      // Deux colonnes en portrait, cinq dès qu'il y a la place : les tuiles
      // restent lisibles sans jamais laisser une bande vide en travers.
      className="grid grid-cols-2 gap-2 lg:grid-cols-5"
    >
      <Tile
        label="Progression globale"
        value={masteryPct === null ? '—' : `${masteryPct} %`}
        valueAttr="data-progress-mastery"
        caption={band?.label ?? null}
        color={band?.colorVar ?? null}
        bar={masteryPct}
        note={
          masteryPct === null
            ? `Encore ${masteryMissing} carte${masteryMissing > 1 ? 's' : ''} à réviser pour la calculer.`
            : null
        }
      />

      <Tile
        label="Suffisance examen"
        value={readinessPct === null ? '—' : `${readinessPct} %`}
        valueAttr="data-progress-hero-readiness"
        caption={level?.label ?? null}
        color={level?.colorVar ?? null}
        bar={readinessPct}
        info="Estimation basée sur tes performances, tes révisions et ta couverture du programme. Ce n’est pas une probabilité de réussite."
        note={
          readinessPct === null
            ? 'Pas encore assez de révisions pour l’estimer.'
            : readinessSubjects > 1
              ? `Moyenne de ${readinessSubjects} matières.`
              : null
        }
      />

      <Tile
        label="Temps étudié"
        value={time.weekMs === 0 ? '—' : formatDuration(time.weekMs)}
        valueAttr="data-progress-overview-time"
        caption="cette semaine"
        color={time.weekMs > 0 ? 'var(--ink)' : null}
        note={
          time.weekDeltaPct === null
            ? time.weekMs === 0
              ? 'Aucune révision enregistrée cette semaine.'
              : 'Première semaine mesurée.'
            : `${time.weekDeltaPct >= 0 ? '+' : ''}${time.weekDeltaPct} % vs semaine passée`
        }
      />

      <Tile
        label="Révisions"
        value={answers.total === 0 ? '—' : String(answers.total)}
        valueAttr="data-progress-overview-answers"
        caption={answers.total === 1 ? 'réponse' : 'réponses'}
        color={answers.total > 0 ? 'var(--ink)' : null}
        note={
          <span data-progress-counters className="flex flex-wrap gap-x-1.5">
            <span>
              {totalCards} flashcard{totalCards > 1 ? 's' : ''}
            </span>
            <span aria-hidden>·</span>
            <span>
              {answers.total} réponse{answers.total > 1 ? 's' : ''}
            </span>
            {answers.successRate !== null && (
              <>
                <span aria-hidden>·</span>
                <span>{Math.round(answers.successRate * 100)} % de réussite</span>
              </>
            )}
          </span>
        }
      />

      <Tile
        label="Régularité"
        value={streak.current === 0 ? '—' : String(streak.current)}
        valueAttr="data-progress-overview-streak"
        caption={streak.current > 1 ? 'jours d’affilée' : 'jour d’affilée'}
        color={streak.current > 0 ? 'var(--mastery-3)' : null}
        note={
          <span className="flex items-center gap-1">
            {streak.week.map((day) => (
              <span
                key={day.day}
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: day.active
                    ? 'var(--mastery-3)'
                    : day.isFuture
                      ? 'var(--line)'
                      : 'var(--line-strong)',
                }}
              />
            ))}
            <span className="ml-1">
              {activeThisWeek}/7 jour{activeThisWeek > 1 ? 's' : ''} cette semaine
            </span>
          </span>
        }
      />
    </section>
  );
}

/** Une tuile : libellé, valeur, barre facultative, une ligne de contexte. */
function Tile({
  label,
  value,
  valueAttr,
  caption,
  color,
  bar,
  info,
  note,
}: {
  label: string;
  value: string;
  valueAttr: string;
  caption: string | null;
  color: string | null;
  /** Pourcentage à dessiner sous la valeur, quand la mesure en est un. */
  bar?: number | null;
  info?: string;
  note?: ReactNode;
}) {
  return (
    <div className="surface-card flex min-w-0 flex-col p-3.5">
      {/* Le libellé s'enroule plutôt que de se tronquer : « PROGRESSION… »
          n'apprend rien, « PROGRESSION / GLOBALE » sur deux lignes, si. */}
      <p className="flex items-start gap-1.5 text-[0.7rem] font-medium uppercase leading-tight tracking-wide text-[var(--ink-faint)]">
        <span className="min-w-0">{label}</span>
        {info && (
          <span
            aria-hidden
            title={info}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)] text-[0.6rem] leading-none"
          >
            i
          </span>
        )}
      </p>

      <p className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span
          {...{ [valueAttr]: '' }}
          className="text-[1.55rem] font-semibold leading-none tabular-nums"
          style={{ color: color ?? 'var(--ink-faint)' }}
        >
          {value}
        </span>
        {caption && (
          <span className="min-w-0 text-[0.76rem] font-medium leading-tight" style={{ color: color ?? 'var(--ink-faint)' }}>
            {caption}
          </span>
        )}
      </p>

      {bar !== undefined && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${bar ?? 0}%`,
              backgroundColor: color ?? 'var(--line-strong)',
              transition: 'width 800ms cubic-bezier(0.22, 0.61, 0.36, 1)',
            }}
          />
        </div>
      )}

      {note && (
        <p className="mt-auto pt-2 text-[0.72rem] leading-snug text-[var(--ink-faint)]">{note}</p>
      )}
    </div>
  );
}
