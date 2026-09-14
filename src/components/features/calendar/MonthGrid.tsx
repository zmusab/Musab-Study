import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { springSnappy } from '@/components/motion/transitions';
import type { CalendarDay, DayAgenda } from '@/core/calendar';
import { parseDayKey } from '@/lib/date';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/**
 * VUE MOIS — une grille lisible, pas un tableau de bord.
 *
 * Chaque case ne montre que ce qui compte de loin : les évaluations en toutes
 * lettres (ce sont elles qui commandent le mois), les séances en pastilles, et
 * les révisions dues en un seul repère chiffré. Une carte due n'est jamais une
 * ligne : à trente cartes par jour, le mois deviendrait illisible.
 */
export function MonthGrid({
  weeks,
  agendaFor,
  selected,
  onSelect,
}: {
  weeks: CalendarDay[][];
  agendaFor: (day: string) => DayAgenda;
  selected: string;
  onSelect: (day: string) => void;
}) {
  /*
    LE CALENDRIER ÉTAIT LE SEUL ÉCRAN ENTIÈREMENT STATIQUE — zéro fichier
    animé sur neuf. Changer de mois, choisir un jour : tout se remplaçait d'un
    coup, sans qu'aucun mouvement ne dise ce qui venait de se passer.

    Le mouvement ajouté ici ne décore pas, il INFORME : la case choisie se
    soulève d'un ressort court, parce que c'est le geste qu'on vient de faire.
    Rien d'autre ne bouge — une grille de trente-cinq cases qui s'agitent
    serait illisible, et c'est une grille qu'on lit, pas un spectacle.
  */
  const reduced = useReducedMotion();
  return (
    <div data-calendar-month>
      <div className="grid grid-cols-7 gap-1 pb-2">
        {WEEKDAYS.map((label) => (
          <div key={label} className="text-center text-[0.72rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            {label}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {weeks.map((week) => (
          <div key={week[0]!.day} className="grid grid-cols-7 gap-1">
            {week.map((cell) => {
              const agenda = agendaFor(cell.day);
              const isSelected = cell.day === selected;
              return (
                <motion.button
                  key={cell.day}
                  type="button"
                  onClick={() => onSelect(cell.day)}
                  // Le ressort ne joue qu'au CHANGEMENT de sélection : `animate`
                  // sur une valeur constante ne rejoue rien au rendu suivant.
                  animate={reduced ? undefined : { scale: isSelected ? 1.03 : 1 }}
                  transition={springSnappy}
                  whileTap={reduced ? undefined : { scale: 0.97 }}
                  aria-pressed={isSelected}
                  aria-label={`${cell.day}${agenda.isEmpty ? '' : ' — journée chargée'}`}
                  data-calendar-cell={cell.day}
                  className={cn(
                    'flex min-h-[4.5rem] min-w-0 flex-col gap-1 overflow-hidden rounded-[var(--radius-control)] border p-1.5 text-left transition-colors sm:min-h-[6rem]',
                    // Une case du mois courant porte un fond très léger : sans
                    // lui, la grille se lit comme une liste de nombres flottants.
                    isSelected
                      ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
                      : cell.inMonth
                        ? 'border-[var(--line)] bg-[var(--surface-2)]/35 hover:bg-[var(--surface-2)]'
                        : 'border-transparent',
                    !cell.inMonth && 'opacity-45',
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.75rem] tabular-nums',
                        cell.isToday ? 'bg-[var(--accent)] font-semibold text-[var(--on-accent)]' : 'text-[var(--ink-soft)]',
                      )}
                    >
                      {parseDayKey(cell.day).getDate()}
                    </span>
                    {agenda.due && agenda.due.cards > 0 && (
                      <span
                        title={`${agenda.due.cards} carte${agenda.due.cards > 1 ? 's' : ''} à réviser`}
                        className="rounded-full bg-[var(--surface-2)] px-1.5 text-[0.68rem] tabular-nums text-[var(--ink-soft)]"
                      >
                        {agenda.due.cards}
                      </span>
                    )}
                  </span>

                  {/* Les évaluations passent devant : c'est la seule chose qu'on
                      doit pouvoir repérer sans lire la case. */}
                  {agenda.evaluations.slice(0, 2).map((entry) => (
                    <span
                      key={entry.event.id}
                      title={entry.event.title}
                      // Deux lignes plutôt qu'une troncature : dans une case de
                      // mois, « Co… » n'apprend rien, « Contrôle d'ana… » si.
                      className="block overflow-hidden rounded-[4px] px-1 py-0.5 text-[0.62rem] font-medium leading-[1.15] text-white [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                      style={{ backgroundColor: entry.meta.colorVar }}
                    >
                      {entry.event.title}
                    </span>
                  ))}

                  {/* Un cours ou un temps pour soi n'a pas besoin de son titre
                      dans une case de mois, mais sa présence doit se voir : un
                      trait par bloc, distinct des pastilles des séances. */}
                  {agenda.fixed.length > 0 && (
                    <span className="flex flex-wrap items-center gap-0.5" data-calendar-lecture-dots>
                      {agenda.fixed.slice(0, 4).map((entry) => (
                        <span
                          key={entry.event.id}
                          aria-hidden
                          title={entry.event.title}
                          className="h-1 w-3 rounded-full"
                          style={{ backgroundColor: entry.meta.colorVar }}
                        />
                      ))}
                      {agenda.fixed.length > 4 && (
                        <span className="text-[0.62rem] text-[var(--ink-faint)]">
                          +{agenda.fixed.length - 4}
                        </span>
                      )}
                    </span>
                  )}

                  {agenda.sessions.length > 0 && (
                    <span className="mt-auto flex flex-wrap items-center gap-1">
                      {agenda.sessions.slice(0, 4).map((entry) => (
                        <span
                          key={entry.event.id}
                          aria-hidden
                          title={entry.event.title}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              entry.state === 'done'
                                ? 'var(--mastery-3)'
                                : entry.state === 'missed'
                                  ? 'var(--ink-faint)'
                                  : 'var(--accent)',
                          }}
                        />
                      ))}
                      {agenda.sessions.length > 4 && (
                        <span className="text-[0.62rem] text-[var(--ink-faint)]">
                          +{agenda.sessions.length - 4}
                        </span>
                      )}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
