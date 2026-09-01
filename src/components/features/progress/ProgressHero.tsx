import { Link } from 'react-router-dom';
import { masteryBand, type AnswerStats } from '@/core/progress';
import { readinessLevel, URGENCY_HORIZON_DAYS, type Evaluation, type PriorityItem } from '@/core/progress/exam';
import { parseDayKey } from '@/lib/date';

/**
 * PREMIER ÉCRAN — la seule zone que l'on doit pouvoir lire en trois secondes.
 *
 * Elle répond aux quatre questions du quotidien, et à rien d'autre :
 * où j'en suis (progression), suis-je prêt (suffisance examen), que faire
 * maintenant (les trois priorités), qu'est-ce qui arrive (prochaine
 * évaluation). Tout le reste de la page est du détail, placé plus bas.
 *
 * Deux mesures empilées plutôt qu'un anneau et du texte à côté : à la largeur
 * réelle d'une demi-carte sur iPad, la variante côte à côte cassait chaque
 * libellé sur deux lignes. Une barre pleine largeur reste lisible partout et
 * garde les deux chiffres directement comparables.
 *
 * Chaque valeur absente s'affiche comme absente : un tiret et une phrase qui
 * dit ce qui manque, jamais un zéro qui se lirait comme un résultat.
 */
const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

export function ProgressHero({
  masteryPct,
  masteryMissing,
  totalCards,
  answers,
  readinessPct,
  readinessSubjects,
  priorities,
  nextEvaluation,
}: {
  masteryPct: number | null;
  /** Cartes qu'il reste à réviser avant que la maîtrise soit publiable. */
  masteryMissing: number;
  totalCards: number;
  answers: AnswerStats;
  readinessPct: number | null;
  /** Nombre de matières entrant dans la moyenne de suffisance. */
  readinessSubjects: number;
  priorities: PriorityItem[];
  nextEvaluation: Evaluation | null;
}) {
  const band = masteryPct === null ? null : masteryBand(masteryPct);
  const level = readinessPct === null ? null : readinessLevel(readinessPct);

  return (
    <section data-progress-hero className="surface-card overflow-hidden p-0" aria-label="Résumé de ta progression">
      <div className="grid gap-0 lg:grid-cols-2">
        {/* ── Où j'en suis / suis-je prêt ── */}
        <div className="flex flex-col gap-4 p-5 sm:p-6 lg:border-r lg:border-[var(--line)]">
          <Metric
            label="Progression globale"
            value={masteryPct}
            valueAttr="data-progress-mastery"
            caption={band?.label ?? null}
            color={band?.colorVar ?? null}
            missing={`Encore ${masteryMissing} carte${masteryMissing > 1 ? 's' : ''} à réviser pour la calculer.`}
            alwaysFooter
            footer={
              <span data-progress-counters className="flex flex-wrap gap-x-2 gap-y-0.5">
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

          <div className="border-t border-[var(--line)] pt-4">
            <Metric
              label="Suffisance examen"
              value={readinessPct}
              valueAttr="data-progress-hero-readiness"
              caption={level?.label ?? null}
              color={level?.colorVar ?? null}
              missing="Pas encore assez de révisions pour l’estimer."
              info="Estimation basée sur tes performances, tes révisions et ta couverture du programme. Ce n’est pas une probabilité de réussite."
              footer={
                <span>
                  Niveau de préparation estimé
                  {readinessSubjects > 1 ? ` · moyenne de ${readinessSubjects} matières` : ''}
                </span>
              }
            />
          </div>
        </div>

        {/* ── Que faire maintenant / qu'est-ce qui arrive ──
             L'échéance est poussée en bas : la carte reste équilibrée qu'il y
             ait une priorité ou trois. */}
        <div className="flex flex-col border-t border-[var(--line)] p-5 sm:p-6 lg:border-t-0">
          <p className="text-[0.78rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            À travailler maintenant
          </p>
          {priorities.length === 0 ? (
            <p className="mt-2 text-[0.85rem] leading-relaxed text-[var(--ink-soft)]">
              Rien à classer pour l’instant. Ajoute des flashcards à tes cours, puis lance une séance : les
              priorités apparaîtront dès la première.
            </p>
          ) : (
            <ol className="mt-2.5 flex flex-col gap-0.5" data-progress-hero-priorities>
              {priorities.slice(0, 3).map((item, index) => (
                <li key={item.id}>
                  <Link
                    to={item.cardIds.length > 0 ? `/revisions?cards=${item.cardIds.join(',')}` : '/revisions'}
                    className="flex min-h-[2.5rem] items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span className="w-3 shrink-0 text-[0.8rem] tabular-nums text-[var(--ink-faint)]">
                      {index + 1}
                    </span>
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: priorityColor(item.masteryPct) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9rem] font-medium">
                        {item.chapterId === null ? item.subjectName : item.chapterName}
                      </span>
                      {item.chapterId !== null && (
                        <span className="block truncate text-[0.76rem] text-[var(--ink-faint)]">
                          {item.subjectName}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[0.82rem] tabular-nums text-[var(--ink-soft)]">
                      {item.masteryPct === null ? 'jamais révisé' : `${item.masteryPct} %`}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-4 border-t border-[var(--line)] pt-3 lg:mt-auto">
            <p className="text-[0.78rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              Prochaine évaluation
            </p>
            {nextEvaluation === null ? (
              <p className="mt-1.5 text-[0.85rem] leading-snug text-[var(--ink-soft)]">
                Aucune date enregistrée. Tes priorités restent calculées sur ton niveau réel.
              </p>
            ) : (
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <span className="text-[0.95rem] font-semibold">
                  {nextEvaluation.subjectName ?? nextEvaluation.event.title}
                </span>
                <span className="text-[0.84rem] text-[var(--ink-soft)]">
                  {nextEvaluation.label} · {DATE_FORMAT.format(parseDayKey(nextEvaluation.day))}
                </span>
                <span
                  className="text-[0.84rem] font-medium"
                  style={{ color: countdownColor(nextEvaluation.daysUntil) }}
                >
                  {nextEvaluation.daysUntil === 0
                    ? 'aujourd’hui'
                    : nextEvaluation.daysUntil === 1
                      ? 'demain'
                      : `dans ${nextEvaluation.daysUntil} jours`}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Une mesure : libellé, valeur, barre, et une ligne de contexte en gris. */
function Metric({
  label,
  value,
  valueAttr,
  caption,
  color,
  missing,
  info,
  footer,
  alwaysFooter = false,
}: {
  label: string;
  value: number | null;
  valueAttr: string;
  caption: string | null;
  color: string | null;
  missing: string;
  info?: string;
  footer: React.ReactNode;
  /**
   * Garde la ligne de contexte même sans pourcentage. Les compteurs bruts
   * (cartes, réponses) sont des FAITS : ils restent vrais et utiles alors
   * même que la moyenne qui en découle n'est pas encore publiable.
   */
  alwaysFooter?: boolean;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[0.78rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
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
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
        <span
          {...{ [valueAttr]: '' }}
          className="text-[2rem] font-semibold leading-none tabular-nums"
          style={{ color: color ?? 'var(--ink-faint)' }}
        >
          {value === null ? '—' : `${value} %`}
        </span>
        <span className="text-[0.9rem] font-medium" style={{ color: color ?? 'var(--ink-faint)' }}>
          {caption ?? 'données insuffisantes'}
        </span>
      </p>
      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${value ?? 0}%`,
            backgroundColor: color ?? 'var(--line-strong)',
            transition: 'width 800ms cubic-bezier(0.22, 0.61, 0.36, 1)',
          }}
        />
      </div>
      {value === null && (
        <p className="mt-2 text-[0.78rem] leading-snug text-[var(--ink-faint)]">{missing}</p>
      )}
      {(value !== null || alwaysFooter) && (
        <p
          data-progress-metric-footer
          className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[0.78rem] text-[var(--ink-faint)]"
        >
          {footer}
        </p>
      )}
    </div>
  );
}

function priorityColor(masteryPct: number | null): string {
  if (masteryPct === null || masteryPct < 40) return 'var(--mastery-0)';
  if (masteryPct < 60) return 'var(--mastery-1)';
  if (masteryPct < 80) return 'var(--mastery-2)';
  return 'var(--mastery-3)';
}

function countdownColor(days: number): string {
  if (days <= 3) return 'var(--mastery-0)';
  if (days <= URGENCY_HORIZON_DAYS / 3) return 'var(--mastery-1)';
  return 'var(--ink-soft)';
}
