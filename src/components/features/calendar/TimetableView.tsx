import {
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  availableMinutes,
  type WeeklyAvailability,
} from '@/core/calendar/availability';
import { timetableRows } from '@/core/calendar/timetable';
import type { CalendarEvent, WeekdayId } from '@/types';

/**
 * EMPLOI DU TEMPS HEBDOMADAIRE — le motif qui se répète, pas une semaine datée.
 *
 * La vue Semaine montre SEPT DATES ; celle-ci montre la semaine TYPE : les
 * blocs récurrents — cours et temps pour soi — à leur place, et, entre eux, ce
 * qui reste réellement libre dans les plages déclarées disponibles. C'est exactement la question qu'on se
 * pose en ouvrant son emploi du temps : « quand est-ce que je peux travailler
 * lundi ? ».
 *
 * Le calcul lui-même est pur et vit dans `core/calendar/timetable.ts`.
 */
export function TimetableView({
  lecturesByWeekday,
  availability,
}: {
  /** Blocs imposés récurrents (cours et temps pour soi), par jour de semaine. */
  lecturesByWeekday: Record<WeekdayId, CalendarEvent[]>;
  availability: WeeklyAvailability;
}) {
  return (
    // Sept colonnes en paysage, quatre en portrait, une sur téléphone : sept
    // colonnes sur 834 px rendraient chaque intitulé de cours illisible.
    // `items-start` : sans lui, chaque colonne prend la hauteur de la plus
    // remplie, et six jours calmes affichent un grand vide sous leur contenu.
    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-4 lg:grid-cols-7" data-calendar-timetable>
      {WEEKDAY_ORDER.map((weekday) => {
        const rows = timetableRows(lecturesByWeekday[weekday] ?? [], availability, weekday);
        const capacity = availableMinutes(availability[weekday]);
        return (
          <section
            key={weekday}
            data-timetable-day={weekday}
            className="flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-control)] border border-[var(--line)] p-2"
          >
            <h3 className="text-[0.78rem] font-medium text-[var(--ink-soft)]">{WEEKDAY_LABELS[weekday]}</h3>

            {rows.map((row, index) => (
              // L'heure au-dessus, l'intitulé en dessous : une colonne de
              // jour fait 150 px, et « 08:00 Histologie — CM » sur une ligne
              // finirait coupé au milieu d'un mot.
              <p
                key={`${row.start}-${index}`}
                data-timetable-row={row.kind}
                className="flex min-w-0 flex-col rounded-[4px] px-1.5 py-1 text-[0.72rem] leading-tight"
                style={
                  row.color
                    ? { backgroundColor: `color-mix(in srgb, ${row.color} 12%, transparent)` }
                    : undefined
                }
              >
                <span
                  // `whitespace-nowrap` : « 14:00–18:00 » coupé en deux lignes
                  // dans une colonne de 110 px devient illisible.
                  className="whitespace-nowrap text-[0.64rem] font-medium tabular-nums"
                  style={{ color: row.color ?? 'var(--ink-faint)' }}
                >
                  {row.start}
                  <span className="text-[var(--ink-faint)] font-normal">{`–${row.end}`}</span>
                </span>
                <span
                  className={
                    'min-w-0 overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] ' +
                    (row.kind === 'free' ? 'text-[var(--ink-faint)] italic' : '')
                  }
                  title={row.detail ? `${row.label} — ${row.detail}` : row.label}
                >
                  {row.label}
                </span>
              </p>
            ))}

            {rows.length === 0 && (
              <p className="px-1.5 text-[0.72rem] leading-snug text-[var(--ink-faint)]">
                {capacity === 0 ? 'Aucune plage déclarée.' : 'Rien d’imposé — tout le temps déclaré est libre.'}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
