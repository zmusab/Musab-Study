import {
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  availableMinutes,
  type WeeklyAvailability,
} from '@/core/calendar/availability';
import { timetableRows } from '@/core/calendar/timetable';
import type { CalendarEvent, WeekdayId } from '@/types';

/**
 * EMPLOI DU TEMPS HEBDOMADAIRE — la semaine TYPE, celle qui se répète.
 *
 * La vue Semaine montre sept DATES ; celle-ci montre le motif : les blocs
 * récurrents — cours et temps pour soi — à leur place, et le temps qui reste
 * réellement libre entre eux dans les plages déclarées disponibles.
 *
 * Deux choses la rendent utilisable plutôt que décorative :
 *  - les créneaux libres tiennent sur UNE ligne par jour au lieu d'une ligne
 *    chacun ; ils étaient trois fois plus nombreux que les cours et noyaient
 *    ce qu'on vient y chercher ;
 *  - chaque bloc s'ouvre d'un toucher pour être modifié — c'est depuis
 *    l'emploi du temps qu'on se rend compte qu'un horaire a changé.
 *
 * Rien n'est inventé : un jour sans bloc récurrent et sans plage déclarée le
 * dit, et une semaine sans aucun cours enregistré affiche un état vide qui
 * explique quoi faire plutôt que sept cartes de vide.
 */
export function TimetableView({
  blocksByWeekday,
  availability,
  onEditSeries,
}: {
  /** Blocs imposés RÉCURRENTS (cours et temps pour soi), par jour de semaine. */
  blocksByWeekday: Record<WeekdayId, CalendarEvent[]>;
  availability: WeeklyAvailability;
  /** Ouvre la série pour la modifier — la portée « toute la série » est implicite. */
  onEditSeries: (series: CalendarEvent) => void;
}) {
  const total = WEEKDAY_ORDER.reduce((sum, id) => sum + (blocksByWeekday[id]?.length ?? 0), 0);

  if (total === 0) {
    return (
      <div
        className="note-block p-6 text-center"
        data-calendar-timetable
      >
        <p className="text-[0.95rem] font-medium text-[var(--ink-soft)]">
          Aucun cours récurrent enregistré
        </p>
        <p className="mx-auto mt-1.5 max-w-[34rem] text-[0.85rem] leading-relaxed text-[var(--ink-faint)]">
          Cette vue montre ta semaine type : les cours et les temps pour toi qui reviennent chaque semaine, et ce
          qu’il reste de libre entre eux. Ajoute un événement, choisis « Chaque semaine » dans « Récurrence », et il
          apparaîtra ici.
        </p>
      </div>
    );
  }

  return (
    // `items-start` : sans lui, chaque colonne prend la hauteur de la plus
    // remplie, et six jours calmes affichent un grand vide sous leur contenu.
    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-4" data-calendar-timetable>
      {WEEKDAY_ORDER.map((weekday) => {
        const blocks = blocksByWeekday[weekday] ?? [];
        const rows = timetableRows(blocks, availability, weekday);
        const busy = rows.filter((row) => row.kind === 'block');
        const free = rows.filter((row) => row.kind === 'free');
        const freeMinutes = free.reduce((sum, row) => sum + span(row.start, row.end), 0);
        const capacity = availableMinutes(availability[weekday]);

        return (
          <section
            key={weekday}
            data-timetable-day={weekday}
            className="flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-control)] border border-[var(--line)] p-2.5"
          >
            <h3 className="flex items-baseline justify-between gap-2 text-[0.82rem] font-semibold text-[var(--ink-soft)]">
              {WEEKDAY_LABELS[weekday]}
              {capacity > 0 && (
                <span className="shrink-0 text-[0.7rem] font-normal tabular-nums text-[var(--ink-faint)]">
                  {duration(freeMinutes)} libre{freeMinutes > 60 ? 's' : ''}
                </span>
              )}
            </h3>

            {busy.map((row, index) => (
              <button
                key={`${row.eventId}-${index}`}
                type="button"
                onClick={() => {
                  const source = blocks.find((block) => block.id === row.eventId);
                  if (source) onEditSeries(source);
                }}
                data-timetable-row="block"
                data-touch-target
                className="flex min-w-0 flex-col rounded-[4px] px-1.5 py-1 text-left text-[0.74rem] leading-tight transition-opacity hover:opacity-80"
                style={{ backgroundColor: `color-mix(in srgb, ${row.color} 14%, transparent)` }}
                title={row.detail ? `${row.label} — ${row.detail}` : row.label}
              >
                <span
                  className="whitespace-nowrap text-[0.66rem] font-semibold tabular-nums"
                  style={{ color: row.color ?? undefined }}
                >
                  {row.start}–{row.end}
                </span>
                <span className="min-w-0 overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
                  {row.label}
                </span>
                {row.detail && (
                  <span className="min-w-0 truncate text-[0.68rem] text-[var(--ink-faint)]">{row.detail}</span>
                )}
              </button>
            ))}

            {/* Les créneaux libres tiennent sur une seule ligne : ce sont des
                intervalles, pas des événements, et les lister un par un
                masquait les cours au milieu du bruit. */}
            {free.length > 0 && (
              <p
                data-timetable-row="free"
                className="px-1.5 text-[0.7rem] leading-snug text-[var(--ink-faint)]"
              >
                Libre&nbsp;: {free.map((row) => `${row.start}–${row.end}`).join(' · ')}
              </p>
            )}

            {capacity === 0 && busy.length === 0 && (
              <p className="px-1.5 text-[0.72rem] leading-snug text-[var(--ink-faint)]">
                Aucune plage déclarée.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const span = (start: string, end: string): number => Math.max(0, toMinutes(end) - toMinutes(start));

const duration = (minutes: number): string => {
  if (minutes === 0) return '0 h';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
};
