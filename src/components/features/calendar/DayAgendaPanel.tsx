import { Link } from 'react-router-dom';
import { Button, Icon } from '@/components/ui';
import {
  SESSION_STATE_LABELS,
  durationLabel,
  formatDayLong,
  type AgendaEvent,
  type DayAgenda,
} from '@/core/calendar';

/**
 * AGENDA D'UNE JOURNÉE — ce qu'il y a à faire, et de quoi le commencer.
 *
 * Priorité de lecture : l'évaluation d'abord (elle commande la journée), puis
 * les séances avec leur bouton d'action, puis la ligne de révision agrégée.
 * Chaque bouton mène à quelque chose de réel : une séance ouvre la file de
 * révision des cartes concernées, jamais un écran vide.
 */
export function DayAgendaPanel({
  agenda,
  onStart,
  onComplete,
  onReset,
  onEdit,
  onDelete,
  onCreate,
  onOpenExam,
}: {
  agenda: DayAgenda;
  onStart: (entry: AgendaEvent) => void;
  onComplete: (entry: AgendaEvent) => void;
  onReset: (entry: AgendaEvent) => void;
  onEdit: (entry: AgendaEvent) => void;
  onDelete: (entry: AgendaEvent) => void;
  onCreate: () => void;
  onOpenExam: (entry: AgendaEvent) => void;
}) {
  return (
    <div className="flex h-full flex-col" data-calendar-agenda>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[1.05rem] leading-tight">{formatDayLong(agenda.day)}</h2>
          <p className="mt-0.5 text-[0.8rem] text-[var(--ink-faint)]">
            {agenda.isEmpty
              ? 'Rien de prévu.'
              : `${agenda.evaluations.length + agenda.fixed.length + agenda.sessions.length + agenda.others.length} événement${
                  agenda.evaluations.length + agenda.fixed.length + agenda.sessions.length + agenda.others.length > 1
                    ? 's'
                    : ''
                }${agenda.due && agenda.due.cards > 0 ? ` · ${agenda.due.cards} carte${agenda.due.cards > 1 ? 's' : ''} due${agenda.due.cards > 1 ? 's' : ''}` : ''}`}
          </p>
        </div>
        {/* Nom accessible explicite : « Ajouter » tout court se confondait avec
            le bouton de validation de la fenêtre d'édition. */}
        <Button
          size="sm"
          variant="secondary"
          onClick={onCreate}
          aria-label={`Ajouter un événement le ${formatDayLong(agenda.day)}`}
        >
          Ajouter
        </Button>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {agenda.evaluations.map((entry) => (
          <article
            key={entry.event.id}
            data-calendar-evaluation
            className="rounded-[var(--radius-card)] border p-3"
            style={{ borderColor: entry.meta.colorVar }}
          >
            <p className="flex items-center gap-2 text-[0.72rem] font-medium uppercase tracking-wide" style={{ color: entry.meta.colorVar }}>
              {entry.meta.label}
              {entry.event.startTime && (
                <span className="text-[var(--ink-faint)]">{entry.event.startTime}</span>
              )}
            </p>
            <p className="mt-1 text-[0.95rem] font-semibold leading-snug">{entry.event.title}</p>
            {entry.subjectName && (
              <p className="mt-0.5 text-[0.8rem] text-[var(--ink-soft)]">{entry.subjectName}</p>
            )}
            {entry.event.notes && (
              <p className="mt-1.5 text-[0.8rem] leading-relaxed text-[var(--ink-faint)]">{entry.event.notes}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onOpenExam(entry)}>
                Préparer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>
                Modifier
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(entry)}>
                Supprimer
              </Button>
            </div>
          </article>
        ))}

        {/* BLOCS IMPOSÉS — cours et temps pour soi. Ni « Commencer » ni
            « Terminer » : ce n'est pas du travail personnel, et rien ici ne le
            chronomètre. */}
        {agenda.fixed.map((entry) => (
          <article
            key={entry.event.id}
            data-calendar-lecture
            data-event-kind={entry.event.kind}
            data-lecture-series={entry.event.seriesId ?? ''}
            className="rounded-[var(--radius-card)] border-l-[3px] border-y border-r border-y-[var(--line)] border-r-[var(--line)] p-3"
            style={{ borderLeftColor: entry.meta.colorVar }}
          >
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.72rem] uppercase tracking-wide">
              <span className="font-medium" style={{ color: entry.meta.colorVar }}>
                {entry.meta.label}
              </span>
              {entry.event.startTime && (
                <span className="normal-case text-[var(--ink-faint)]">
                  {entry.event.startTime}
                  {entry.event.endTime ? `–${entry.event.endTime}` : ''}
                </span>
              )}
              {entry.event.seriesId && (
                <span className="normal-case text-[var(--ink-faint)]" title="Événement récurrent">
                  · chaque semaine
                </span>
              )}
            </p>
            <p className="mt-1 text-[0.92rem] font-medium leading-snug">{entry.event.title}</p>
            {(entry.subjectName || entry.event.room || entry.event.teacher) && (
              <p className="mt-0.5 text-[0.8rem] text-[var(--ink-soft)]">
                {[entry.subjectName, entry.event.room, entry.event.teacher].filter(Boolean).join(' · ')}
              </p>
            )}
            {entry.event.notes && (
              <p className="mt-1.5 text-[0.8rem] leading-relaxed text-[var(--ink-faint)]">{entry.event.notes}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>
                Modifier
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(entry)}>
                Supprimer
              </Button>
            </div>
          </article>
        ))}

        {agenda.sessions.map((entry) => (
          <SessionRow
            key={entry.event.id}
            entry={entry}
            onStart={onStart}
            onComplete={onComplete}
            onReset={onReset}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}

        {agenda.others.map((entry) => (
          <article key={entry.event.id} className="rounded-[var(--radius-card)] border border-[var(--line)] p-3">
            <p className="text-[0.72rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              {entry.meta.label}
            </p>
            <p className="mt-1 text-[0.92rem] font-medium leading-snug">{entry.event.title}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>
                Modifier
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(entry)}>
                Supprimer
              </Button>
            </div>
          </article>
        ))}

        {/* RÉVISIONS DUES — une seule ligne agrégée, jamais une par carte. */}
        {agenda.due && agenda.due.cards > 0 && (
          <article
            data-calendar-due
            className="rounded-[var(--radius-card)] border border-dashed border-[var(--line)] bg-[var(--surface-2)]/40 p-3"
          >
            <p className="flex items-center gap-2 text-[0.72rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              <Icon name="review" size={13} /> Révisions dues
            </p>
            <p className="mt-1 text-[0.92rem] font-medium">
              {agenda.due.cards} carte{agenda.due.cards > 1 ? 's' : ''}
              {agenda.due.overdue > 0 && (
                <span className="ml-2 text-[0.8rem] font-normal text-[var(--mastery-1)]">
                  dont {agenda.due.overdue} en retard
                </span>
              )}
            </p>
            <p className="mt-0.5 truncate text-[0.8rem] text-[var(--ink-soft)]">
              {agenda.due.subjects.map((subject) => `${subject.name} (${subject.cards})`).join(' · ')}
            </p>
            <Link to={`/revisions?cards=${agenda.due.cardIds.join(',')}`} className="mt-3 inline-block">
              <Button size="sm">Réviser</Button>
            </Link>
          </article>
        )}

        {agenda.isEmpty && (
          <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--line)] p-4">
            <p className="text-[0.88rem] font-medium text-[var(--ink-soft)]">Journée libre</p>
            <p className="mt-1 text-[0.82rem] leading-relaxed text-[var(--ink-faint)]">
              Aucun événement enregistré et aucune carte à réviser ce jour-là. Ajoute une séance ou une évaluation
              pour la remplir.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionRow({
  entry,
  onStart,
  onComplete,
  onReset,
  onEdit,
  onDelete,
}: {
  entry: AgendaEvent;
  onStart: (entry: AgendaEvent) => void;
  onComplete: (entry: AgendaEvent) => void;
  onReset: (entry: AgendaEvent) => void;
  onEdit: (entry: AgendaEvent) => void;
  onDelete: (entry: AgendaEvent) => void;
}) {
  const duration = durationLabel(entry.event.startTime, entry.event.endTime);
  const stateColor =
    entry.state === 'done'
      ? 'var(--mastery-3)'
      : entry.state === 'started'
        ? 'var(--accent)'
        : entry.state === 'missed'
          ? 'var(--ink-faint)'
          : 'var(--ink-soft)';

  return (
    <article
      data-calendar-session
      data-session-state={entry.state}
      className="rounded-[var(--radius-card)] border border-[var(--line)] p-3"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.72rem] uppercase tracking-wide">
        <span className="font-medium text-[var(--ink-faint)]">{entry.meta.label}</span>
        <span className="font-medium" style={{ color: stateColor }}>
          {SESSION_STATE_LABELS[entry.state]}
        </span>
        {entry.event.startTime && (
          <span className="normal-case text-[var(--ink-faint)]">
            {entry.event.startTime}
            {duration ? ` · ${duration}` : ''}
          </span>
        )}
      </p>
      <p className="mt-1 text-[0.92rem] font-medium leading-snug">{entry.event.title}</p>
      {(entry.subjectName || entry.chapterName) && (
        <p className="mt-0.5 text-[0.8rem] text-[var(--ink-soft)]">
          {[entry.subjectName, entry.chapterName].filter(Boolean).join(' · ')}
        </p>
      )}
      {entry.event.notes && (
        <p className="mt-1.5 text-[0.8rem] leading-relaxed text-[var(--ink-faint)]">{entry.event.notes}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {entry.state === 'done' ? (
          <Button size="sm" variant="ghost" onClick={() => onReset(entry)}>
            Rouvrir
          </Button>
        ) : entry.state === 'started' ? (
          <Button size="sm" onClick={() => onComplete(entry)} data-calendar-complete>
            Terminer
          </Button>
        ) : (
          <Button size="sm" onClick={() => onStart(entry)} data-calendar-start>
            Commencer
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>
          Modifier
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(entry)}>
          Supprimer
        </Button>
      </div>
    </article>
  );
}
