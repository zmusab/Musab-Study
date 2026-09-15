import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui';
import { formatDayShort, isFixedBlock, type AgendaEvent, type DayAgenda } from '@/core/calendar';

/**
 * VUE SEMAINE ET VUE JOUR — une journée par bloc, lue de haut en bas.
 *
 * L'ancienne version alignait sept colonnes de hauteur fixe : sur iPad, six
 * d'entre elles étaient vides et la septième tronquait ses titres. On lit une
 * journée comme un agenda — heure à gauche, événement à droite — et les jours
 * s'empilent, deux par ligne en paysage, un seul en portrait.
 *
 * Ce qui n'a PAS d'heure ne se voit pas attribuer une heure inventée : ces
 * événements sont groupés au-dessus, sous « toute la journée ».
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
  const single = days.length === 1;

  return (
    <div
      className={cn('grid min-w-0 gap-2', single ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2')}
      data-calendar-week
    >
      {days.map((day) => {
        const agenda = agendaFor(day);
        const isSelected = day === selected;
        const timed = [...agenda.evaluations, ...agenda.fixed, ...agenda.sessions, ...agenda.others]
          .filter((entry) => entry.event.startTime !== null)
          .sort((a, b) => a.event.startTime!.localeCompare(b.event.startTime!));
        const allDay = [...agenda.evaluations, ...agenda.fixed, ...agenda.sessions, ...agenda.others].filter(
          (entry) => entry.event.startTime === null,
        );

        return (
          <button
            key={day}
            type="button"
            onClick={() => onSelect(day)}
            aria-pressed={isSelected}
            data-calendar-cell={day}
            className={cn(
              // `min-w-0` : sans lui, une colonne de grille prend la largeur de
              // son plus long contenu et déborde sur la voisine.
              // Pas de hauteur minimale imposée : une journée vide n'a aucune
              // raison d'occuper huit centimètres d'écran. Les cartes se
              // dimensionnent sur leur contenu, ce qui rend la semaine
              // lisible d'un seul regard au lieu d'une colonne de vides.
              'flex min-w-0 flex-col gap-1 overflow-hidden rounded-[var(--radius-control)] border p-2.5 text-left transition-colors',
              single && 'min-h-[12rem]',
              isSelected
                ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
                : 'border-[var(--line)] hover:bg-[var(--surface-2)]',
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  'text-[0.82rem] font-semibold',
                  day === today ? 'text-[var(--accent)]' : 'text-[var(--ink-soft)]',
                )}
              >
                {formatDayShort(day)}
              </span>
              {agenda.due && agenda.due.cards > 0 && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--surface-2)] px-1.5 text-[0.68rem] tabular-nums text-[var(--ink-soft)]">
                  <Icon name="review" size={10} />
                  {agenda.due.cards}
                </span>
              )}
            </span>

            {allDay.length > 0 && (
              <span className="flex min-w-0 flex-col gap-0.5">
                {allDay.map((entry) => (
                  <Row key={entry.event.id} entry={entry} time="jour" />
                ))}
              </span>
            )}

            {timed.map((entry) => (
              <Row key={entry.event.id} entry={entry} time={entry.event.startTime!} />
            ))}

            {agenda.isEmpty && <span className="text-[0.74rem] text-[var(--ink-faint)]">Rien de prévu</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Une ligne d'agenda : l'heure d'abord, puis un trait de couleur qui dit le
 * genre, puis le titre. Le trait porte l'information de couleur — un fond
 * teinté sur sept lignes empilées devient vite du bruit.
 */
function Row({ entry, time }: { entry: AgendaEvent; time: string }) {
  const done = entry.meta.family === 'session' && entry.state === 'done';
  const color =
    entry.meta.family === 'session'
      ? entry.state === 'done'
        ? 'var(--mastery-3)'
        : entry.state === 'missed'
          ? 'var(--ink-faint)'
          : entry.meta.colorVar
      : entry.meta.colorVar;

  return (
    <span
      className="flex min-w-0 items-start gap-1.5 text-[0.74rem] leading-tight"
      data-calendar-lecture-chip={isFixedBlock(entry.event) ? '' : undefined}
      title={[entry.event.title, entry.event.room].filter(Boolean).join(' · ')}
    >
      <span className="w-[2.6rem] shrink-0 tabular-nums text-[var(--ink-faint)]">
        {time === 'jour' ? '—' : time}
      </span>
      <span aria-hidden className="mt-[0.2rem] h-3 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span
        className={cn(
          'min-w-0 flex-1 overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]',
          done && 'line-through opacity-60',
        )}
      >
        {entry.event.title}
      </span>
    </span>
  );
}
