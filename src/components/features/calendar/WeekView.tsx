import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui';
import { formatDayShort, type DayAgenda } from '@/core/calendar';

/**
 * VUE SEMAINE — sept colonnes, chacune listant sa journée en clair.
 *
 * Contrairement au mois, la semaine a la place d'écrire les titres : on les
 * écrit. Une carte due reste malgré tout une ligne agrégée, jamais une par
 * carte.
 *
 * En portrait, les sept colonnes deviennent sept blocs empilés : compresser
 * sept colonnes sur 834 px rendrait chaque titre illisible.
 */
export function WeekView({
  days,
  agendaFor,
  selected,
  today,
  onSelect,
}: {
  days: string[];
  agendaFor: (day: string) => DayAgenda;
  selected: string;
  today: string;
  onSelect: (day: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-7" data-calendar-week>
      {days.map((day) => {
        const agenda = agendaFor(day);
        const isSelected = day === selected;
        return (
          <button
            key={day}
            type="button"
            onClick={() => onSelect(day)}
            aria-pressed={isSelected}
            data-calendar-cell={day}
            className={cn(
              // `min-w-0` : sans lui, une colonne de grille prend la largeur
              // de son plus long contenu et déborde sur la voisine.
              'flex min-h-[8rem] min-w-0 flex-col gap-1.5 overflow-hidden rounded-[var(--radius-control)] border p-2 text-left transition-colors',
              isSelected
                ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
                : 'border-[var(--line)] hover:bg-[var(--surface-2)]',
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  'text-[0.78rem] font-medium',
                  day === today ? 'text-[var(--accent)]' : 'text-[var(--ink-soft)]',
                )}
              >
                {formatDayShort(day)}
              </span>
              {agenda.due && agenda.due.cards > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-1.5 text-[0.68rem] tabular-nums text-[var(--ink-soft)]">
                  <Icon name="review" size={10} />
                  {agenda.due.cards}
                </span>
              )}
            </span>

            {agenda.evaluations.map((entry) => (
              <span
                key={entry.event.id}
                title={entry.event.title}
                className="block overflow-hidden rounded-[4px] px-1.5 py-1 text-[0.7rem] font-medium leading-tight text-white [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                style={{ backgroundColor: entry.meta.colorVar }}
              >
                {entry.event.title}
              </span>
            ))}

            {/* COURS — bandeau teinté et heure en tête : l'emploi du temps doit
                se lire d'un coup d'œil, sans se confondre avec les séances. */}
            {agenda.lectures.map((entry) => (
              <span
                key={entry.event.id}
                data-calendar-lecture-chip
                title={[entry.event.title, entry.event.room].filter(Boolean).join(' · ')}
                className="block overflow-hidden rounded-[4px] border-l-2 px-1.5 py-1 text-[0.7rem] leading-tight [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                style={{
                  borderLeftColor: entry.meta.colorVar,
                  backgroundColor: 'color-mix(in srgb, var(--nav-turquoise) 12%, transparent)',
                }}
              >
                {entry.event.startTime && (
                  <span className="font-medium tabular-nums" style={{ color: entry.meta.colorVar }}>
                    {entry.event.startTime}{' '}
                  </span>
                )}
                {entry.event.title}
              </span>
            ))}

            {agenda.sessions.map((entry) => (
              <span
                key={entry.event.id}
                className="flex items-start gap-1.5 text-[0.72rem] leading-tight text-[var(--ink-soft)]"
              >
                <span
                  aria-hidden
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      entry.state === 'done'
                        ? 'var(--mastery-3)'
                        : entry.state === 'missed'
                          ? 'var(--ink-faint)'
                          : 'var(--accent)',
                  }}
                />
                <span
                  title={entry.event.title}
                  className={cn(
                    'min-w-0 flex-1 overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]',
                    entry.state === 'done' && 'line-through opacity-60',
                  )}
                >
                  {entry.event.startTime ? `${entry.event.startTime} ` : ''}
                  {entry.event.title}
                </span>
              </span>
            ))}

            {agenda.others.map((entry) => (
              <span key={entry.event.id} className="truncate text-[0.72rem] text-[var(--ink-faint)]">
                {entry.event.title}
              </span>
            ))}

            {agenda.isEmpty && <span className="text-[0.72rem] text-[var(--ink-faint)]">—</span>}
          </button>
        );
      })}
    </div>
  );
}
