import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select } from '@/components/ui';
import {
  SLOT_ORDER,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  WEEKDAY_SHORT,
  availableMinutes,
  normalizeAvailability,
  weeklyAvailableMinutes,
  type DayAvailability,
  type WeekdayId,
  type WeeklyAvailability,
} from '@/core/calendar/availability';

/**
 * MES PLAGES DISPONIBLES — jour par jour.
 *
 * Le planificateur ne suppose jamais une journée entière libre, ni que tous
 * les jours se ressemblent : chaque jour de la semaine a ses propres plages.
 * Tout désactiver un jour est un choix valide — le planificateur cesse alors
 * de proposer quoi que ce soit CE jour-là, et le dit.
 *
 * Sur iPad, sept jours × trois plages ne tiennent pas côte à côte. On affiche
 * donc UN jour à la fois, choisi dans une barre qui résume déjà la semaine :
 * on voit d'un coup d'œil quels jours sont pleins, vides, ou à régler.
 */
const SESSION_LENGTHS = [30, 45, 60, 90];

const hours = (minutes: number) =>
  minutes === 0 ? '—' : minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60}`;

export function AvailabilityModal({
  open,
  availability,
  sessionMinutes,
  onClose,
  onSave,
}: {
  open: boolean;
  availability: WeeklyAvailability;
  sessionMinutes: number;
  onClose: () => void;
  onSave: (availability: WeeklyAvailability, sessionMinutes: number) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<WeeklyAvailability>(availability);
  const [minutes, setMinutes] = useState(sessionMinutes);
  const [weekday, setWeekday] = useState<WeekdayId>('monday');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(normalizeAvailability(availability));
      setMinutes(sessionMinutes);
    }
  }, [open, availability, sessionMinutes]);

  const day = draft[weekday];
  const dayTotal = availableMinutes(day);
  const weekTotal = weeklyAvailableMinutes(draft);

  const patchSlot = (slot: (typeof SLOT_ORDER)[number], patch: Partial<DayAvailability[typeof slot]>) =>
    setDraft((current) => ({
      ...current,
      [weekday]: { ...current[weekday], [slot]: { ...current[weekday][slot], ...patch } },
    }));

  /** Recopier une journée réglée sur les six autres : le raccourci qui évite
      de saisir vingt et un champs quand la semaine est régulière. */
  const applyToAll = () =>
    setDraft((current) => {
      const source = current[weekday];
      return Object.fromEntries(
        WEEKDAY_ORDER.map((id) => [
          id,
          {
            morning: { ...source.morning },
            afternoon: { ...source.afternoon },
            evening: { ...source.evening },
          },
        ]),
      ) as WeeklyAvailability;
    });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(draft, minutes);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      // Sept jours et trois plages : au format par défaut, les champs d'heure
      // sont rognés et la fenêtre défile. Elle a besoin de largeur.
      size="lg"
      title="Mes plages disponibles"
      description="Chaque jour a ses propres plages. Le planificateur ne place des séances que dedans."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} disabled={saving} data-availability-save>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-availability-form>
        {/* ── La semaine en un coup d'œil, et le sélecteur de jour ── */}
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_ORDER.map((id) => {
            const total = availableMinutes(draft[id]);
            const active = id === weekday;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setWeekday(id)}
                aria-pressed={active}
                aria-label={`Régler ${WEEKDAY_LABELS[id].toLowerCase()}`}
                data-availability-day={id}
                data-touch-target
                className={
                  'flex min-h-[3.1rem] flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] border px-1 py-1.5 transition-colors ' +
                  (active
                    ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
                    : 'border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--surface-2)]')
                }
              >
                <span className="text-[0.72rem] font-medium">{WEEKDAY_SHORT[id]}</span>
                <span
                  className="text-[0.66rem] tabular-nums"
                  style={{ color: total === 0 ? 'var(--ink-faint)' : undefined }}
                >
                  {hours(total)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[0.95rem] font-semibold">{WEEKDAY_LABELS[weekday]}</h3>
          <Button size="sm" variant="ghost" onClick={applyToAll} data-availability-apply-all>
            Appliquer à tous les jours
          </Button>
        </div>

        {/* Les trois plages côte à côte dès qu'il y a la place : sur iPad, une
            colonne obligerait à faire défiler une fenêtre de réglages. */}
        <div className="grid gap-3 sm:grid-cols-3">
          {SLOT_ORDER.map((id) => {
            const slot = day[id];
            return (
              <div
                key={id}
                data-availability-slot={id}
                className="rounded-[var(--radius-card)] border border-[var(--line)] p-3"
              >
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={slot.enabled}
                    aria-label={`Disponible le ${WEEKDAY_LABELS[weekday].toLowerCase()} : ${slot.label}`}
                    onChange={(input) => patchSlot(id, { enabled: input.target.checked })}
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 truncate text-[0.92rem] font-medium">{slot.label}</span>
                </label>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-1 sm:gap-2.5">
                  <Input
                    label="De"
                    type="time"
                    value={slot.start}
                    disabled={!slot.enabled}
                    onChange={(input) => patchSlot(id, { start: input.target.value })}
                  />
                  <Input
                    label="À"
                    type="time"
                    value={slot.end}
                    disabled={!slot.enabled}
                    onChange={(input) => patchSlot(id, { end: input.target.value })}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <Select
          label="Durée d’une séance planifiée"
          value={String(minutes)}
          onChange={(input) => setMinutes(Number(input.target.value))}
        >
          {SESSION_LENGTHS.map((option) => (
            <option key={option} value={option}>
              {option} min
            </option>
          ))}
        </Select>

        <p className="text-[0.8rem] leading-relaxed text-[var(--ink-faint)]" data-availability-total>
          {dayTotal === 0
            ? `Aucune plage active le ${WEEKDAY_LABELS[weekday].toLowerCase()} : le planificateur ne proposera rien ce jour-là. Tu peux toujours y ajouter une séance à la main.`
            : `${hours(dayTotal)} disponibles le ${WEEKDAY_LABELS[weekday].toLowerCase()}.`}
          {weekTotal > 0 && ` ${hours(weekTotal)} sur la semaine — le plan n’en occupe qu’une partie.`}
        </p>
      </div>
    </Modal>
  );
}
