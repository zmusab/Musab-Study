import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Modal, Select } from '@/components/ui';
import { formatDayLong, planStudySessions, type ExamBrief, type PlannedSession } from '@/core/calendar';
import { examReadiness, readinessLevel } from '@/core/progress/exam';
import type { Chapter, Flashcard, ReviewLog } from '@/types';

/**
 * PRÉPARATION D'UNE ÉVALUATION — l'état réel, puis un plan proposé.
 *
 * L'état vient des mêmes calculs que la page Progression (suffisance examen,
 * chapitres faibles, cartes dues) : deux écrans ne doivent pas donner deux
 * chiffres.
 *
 * Le plan est une PROPOSITION : rien n'est écrit tant qu'on ne l'accepte pas,
 * et chaque séance affiche la mesure qui la justifie. C'est une heuristique de
 * répartition, pas une prévision de résultat — le texte le dit.
 */

const LENGTH_OPTIONS = [30, 45, 60, 90];

export function ExamPrepModal({
  open,
  brief,
  chapters,
  cards,
  logs,
  now,
  onClose,
  onAcceptPlan,
  onReplacePlan,
}: {
  open: boolean;
  brief: ExamBrief | null;
  chapters: Chapter[];
  cards: Flashcard[];
  logs: ReviewLog[];
  now: Date;
  onClose: () => void;
  onAcceptPlan: (sessions: PlannedSession[]) => void | Promise<void>;
  onReplacePlan: (sessions: PlannedSession[]) => void | Promise<void>;
}) {
  const [minutes, setMinutes] = useState(45);
  const [saving, setSaving] = useState(false);

  const subjectId = brief?.event.subjectId ?? null;
  const subjectName = brief?.subjectName ?? '';

  const readiness = useMemo(
    () => (subjectId ? examReadiness(subjectId, chapters, cards, logs, now) : null),
    [subjectId, chapters, cards, logs, now],
  );

  const plan = useMemo(() => {
    if (!brief || !subjectId) return null;
    return planStudySessions(brief.event.day, subjectId, subjectName, chapters, cards, logs, now, {
      minutesPerSession: minutes,
    });
  }, [brief, subjectId, subjectName, chapters, cards, logs, now, minutes]);

  if (!brief) return null;

  const level = readiness?.pct === null || readiness === null ? null : readinessLevel(readiness.pct);
  const hasPlan = brief.plannedSessions > 0;

  const accept = async () => {
    if (!plan || plan.sessions.length === 0 || saving) return;
    setSaving(true);
    try {
      if (hasPlan) await onReplacePlan(plan.sessions);
      else await onAcceptPlan(plan.sessions);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={brief.event.title}
      description={`${brief.label}${brief.subjectName ? ` · ${brief.subjectName}` : ''} · ${formatDayLong(brief.event.day)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button onClick={accept} disabled={!plan || plan.sessions.length === 0 || saving} data-calendar-accept-plan>
            {hasPlan ? 'Remplacer le plan' : 'Ajouter ces séances'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* ── État réel ── */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Dans" value={countdown(brief.daysUntil)} />
          <Stat
            label="Suffisance"
            value={readiness?.pct === null || readiness === null ? '—' : `${readiness.pct} %`}
            color={level?.colorVar}
            hint={level?.label ?? readiness?.missingReason ?? undefined}
          />
          <Stat label="Cartes dues" value={String(brief.dueCards)} />
          <Stat
            label="Chapitres faibles"
            value={String(brief.weakChapters.length)}
            color={brief.weakChapters.length > 0 ? 'var(--mastery-1)' : undefined}
          />
        </section>

        {brief.weakChapters.length > 0 && (
          <section>
            <h3 className="text-[0.9rem] font-semibold">À renforcer en priorité</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {brief.weakChapters.map((chapter) => (
                <li
                  key={chapter.chapterId ?? 'orphan'}
                  className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        chapter.masteryPct === null || chapter.masteryPct < 50
                          ? 'var(--mastery-0)'
                          : 'var(--mastery-1)',
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.86rem]">{chapter.name}</span>
                  <span className="shrink-0 text-[0.82rem] tabular-nums text-[var(--ink-faint)]">
                    {chapter.masteryPct === null ? 'jamais révisé' : `${chapter.masteryPct} %`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Plan proposé ── */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-[0.9rem] font-semibold">Plan de révision proposé</h3>
              <p className="mt-0.5 max-w-[34rem] text-[0.8rem] leading-relaxed text-[var(--ink-faint)]">
                Réparti sur les jours restants, en donnant plus de séances aux chapitres les plus faibles. C’est une
                répartition raisonnable, pas une prévision de résultat.
              </p>
            </div>
            <Select
              label="Durée"
              className="w-auto"
              value={String(minutes)}
              onChange={(input) => setMinutes(Number(input.target.value))}
            >
              {LENGTH_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} min
                </option>
              ))}
            </Select>
          </div>

          {plan === null || plan.blocked !== null ? (
            <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-[var(--line)] p-3 text-[0.84rem] leading-relaxed text-[var(--ink-soft)]">
              {plan?.blocked ?? 'Cette évaluation n’est rattachée à aucune matière : il n’y a rien à répartir.'}
            </p>
          ) : (
            <>
              {hasPlan && (
                <p className="mt-3 text-[0.82rem] text-[var(--mastery-1)]">
                  Un plan existe déjà pour cette évaluation ({brief.plannedSessions} séance
                  {brief.plannedSessions > 1 ? 's' : ''}, {brief.completedSessions} terminée
                  {brief.completedSessions > 1 ? 's' : ''}). L’accepter remplacera les séances non commencées.
                </p>
              )}
              <ul className="mt-3 flex flex-col gap-1" data-calendar-plan>
                {plan.sessions.map((session) => (
                  <li
                    key={`${session.day}-${session.chapterId ?? 'general'}`}
                    className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--line)] px-3 py-2"
                  >
                    <span className="w-[9.5rem] shrink-0 text-[0.8rem] text-[var(--ink-soft)]">
                      {formatDayLong(session.day)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.86rem] font-medium">{session.title}</span>
                      <span className="block truncate text-[0.76rem] text-[var(--ink-faint)]">{session.reason}</span>
                    </span>
                    <span className="shrink-0 text-[0.8rem] tabular-nums text-[var(--ink-faint)]">
                      {session.minutes} min
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {subjectId && (
          <Link to={`/progression`} className="self-start text-[0.84rem] text-[var(--accent)] hover:underline">
            Voir le détail de ma préparation →
          </Link>
        )}
      </div>
    </Modal>
  );
}

function Stat({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--line)] p-2.5">
      <p className="text-[0.7rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">{label}</p>
      <p className="mt-1 text-[1.15rem] font-semibold leading-none tabular-nums" style={{ color }}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[0.7rem] leading-tight text-[var(--ink-faint)]">{hint}</p>}
    </div>
  );
}

function countdown(days: number): string {
  if (days < 0) return 'passé';
  if (days === 0) return "aujourd'hui";
  if (days === 1) return '1 jour';
  return `${days} jours`;
}
