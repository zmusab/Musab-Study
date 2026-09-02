import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select } from '@/components/ui';
import { SLOT_ORDER, availableMinutes, normalizeAvailability, type Availability } from '@/core/calendar/availability';

/**
 * MES PLAGES DISPONIBLES.
 *
 * Le planificateur ne suppose jamais une journée entière libre : il travaille
 * dans ces plages, et seulement dans celles qui sont cochées. Tout désactiver
 * est un choix valide — le planificateur cesse alors de proposer quoi que ce
 * soit, et le dit.
 */
const SESSION_LENGTHS = [30, 45, 60, 90];

export function AvailabilityModal({
  open,
  availability,
  sessionMinutes,
  onClose,
  onSave,
}: {
  open: boolean;
  availability: Availability;
  sessionMinutes: number;
  onClose: () => void;
  onSave: (availability: Availability, sessionMinutes: number) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Availability>(availability);
  const [minutes, setMinutes] = useState(sessionMinutes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(normalizeAvailability(availability));
      setMinutes(sessionMinutes);
    }
  }, [open, availability, sessionMinutes]);

  const total = availableMinutes(draft);

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
      title="Mes plages disponibles"
      description="Le planificateur ne place des séances que dans ces plages."
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
        {SLOT_ORDER.map((id) => {
          const slot = draft[id];
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
                  aria-label={`Disponible : ${slot.label}`}
                  onChange={(input) =>
                    setDraft((current) => ({
                      ...current,
                      [id]: { ...current[id], enabled: input.target.checked },
                    }))
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-[0.92rem] font-medium">{slot.label}</span>
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Input
                  label="De"
                  type="time"
                  value={slot.start}
                  disabled={!slot.enabled}
                  onChange={(input) =>
                    setDraft((current) => ({ ...current, [id]: { ...current[id], start: input.target.value } }))
                  }
                />
                <Input
                  label="À"
                  type="time"
                  value={slot.end}
                  disabled={!slot.enabled}
                  onChange={(input) =>
                    setDraft((current) => ({ ...current, [id]: { ...current[id], end: input.target.value } }))
                  }
                />
              </div>
            </div>
          );
        })}

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
          {total === 0
            ? 'Aucune plage active : le planificateur ne proposera rien tant qu’aucune n’est cochée.'
            : `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} disponibles par jour au maximum. Le plan n’en occupe qu’une partie.`}
        </p>
      </div>
    </Modal>
  );
}
