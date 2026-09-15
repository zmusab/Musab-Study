import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select } from '@/components/ui';
import { LOAD_COLORS, LOAD_LABELS } from '@/core/calendar/load';
import { formatDayLong } from '@/core/calendar';
import type { PlannedSession } from '@/core/calendar/plans';
import type { UnplacedSession } from '@/core/calendar/planner';

/**
 * PROPOSITION DE PLAN — à accepter, à modifier ou à refuser.
 *
 * Rien n'est écrit dans `calendarEvents` tant que « Ajouter » n'a pas été
 * pressé. Chaque ligne peut être déplacée (jour et heure), raccourcie ou
 * retirée : le plan est une suggestion, pas une décision prise à ma place.
 *
 * Chaque séance affiche la mesure qui la justifie et la charge du jour
 * retenu — un classement dont on ne comprend pas la logique ne se suit pas.
 */
const DURATIONS = [30, 45, 60, 90];

export function PlanReviewModal({
  open,
  title,
  description,
  sessions,
  unplaced,
  blocked,
  footerNote,
  onClose,
  onConfirm,
  confirmLabel = 'Ajouter ces séances',
}: {
  open: boolean;
  title: string;
  description: string;
  sessions: PlannedSession[];
  unplaced: UnplacedSession[];
  blocked: string | null;
  footerNote?: string;
  onClose: () => void;
  onConfirm: (sessions: PlannedSession[]) => void | Promise<void>;
  confirmLabel?: string;
}) {
  const [draft, setDraft] = useState<PlannedSession[]>(sessions);
  const [saving, setSaving] = useState(false);

  // Recharger la proposition quand elle change (durée, matière, réouverture) :
  // sinon on validerait un plan qui n'est plus celui affiché.
  useEffect(() => setDraft(sessions), [sessions]);

  const update = (index: number, patch: Partial<PlannedSession>) =>
    setDraft((current) => current.map((session, i) => (i === index ? { ...session, ...patch } : session)));

  const remove = (index: number) => setDraft((current) => current.filter((_, i) => i !== index));

  const confirm = async () => {
    if (draft.length === 0 || saving) return;
    setSaving(true);
    try {
      await onConfirm(draft);
    } finally {
      setSaving(false);
    }
  };

  const totalMinutes = draft.reduce((sum, session) => sum + session.minutes, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      description={description}
      footer={
        // Quand il n'y a rien à proposer, on n'affiche pas un bouton d'ajout
        // grisé : il n'y a rien à refuser non plus, seulement à refermer.
        blocked !== null ? (
          <Button variant="secondary" onClick={onClose} data-plan-refuse>
            Fermer
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} data-plan-refuse>
              Refuser
            </Button>
            <Button onClick={confirm} disabled={draft.length === 0 || saving} data-plan-accept>
              {confirmLabel}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {blocked !== null ? (
          <p className="note-block p-3 text-[0.85rem] leading-relaxed text-[var(--ink-soft)]">
            {blocked}
          </p>
        ) : (
          <>
            <p className="text-[0.82rem] leading-relaxed text-[var(--ink-faint)]">
              {draft.length} séance{draft.length > 1 ? 's' : ''} · {formatMinutes(totalMinutes)} au total.
              {footerNote ? ` ${footerNote}` : ''} Répartition heuristique : elle vise l’espacement et les
              chapitres faibles, elle ne prédit aucun résultat.
            </p>

            <ul className="flex flex-col gap-2" data-plan-sessions>
              {draft.map((session, index) => (
                <li
                  key={`${session.day}-${session.chapterId ?? 'general'}-${index}`}
                  className="rounded-[var(--radius-card)] border border-[var(--line)] p-3"
                  data-plan-session
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[0.9rem] font-medium">{session.title}</p>
                      <p className="mt-0.5 text-[0.78rem] text-[var(--ink-faint)]">{session.reason}</p>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium"
                      style={{ color: LOAD_COLORS[session.dayLevel] }}
                      title={LOAD_LABELS[session.dayLevel]}
                    >
                      {LOAD_LABELS[session.dayLevel]}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.7rem] font-medium tracking-wide text-[var(--ink-faint)]">Jour</span>
                      <Input
                        type="date"
                        aria-label={`Jour de la séance ${index + 1}`}
                        value={session.day}
                        onChange={(input) => update(index, { day: input.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.7rem] font-medium tracking-wide text-[var(--ink-faint)]">Début</span>
                      <Input
                        type="time"
                        aria-label={`Heure de la séance ${index + 1}`}
                        value={session.startTime ?? ''}
                        onChange={(input) =>
                          update(index, {
                            startTime: input.target.value === '' ? null : input.target.value,
                            endTime:
                              input.target.value === ''
                                ? null
                                : shiftTime(input.target.value, session.minutes),
                          })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.7rem] font-medium tracking-wide text-[var(--ink-faint)]">Durée</span>
                      <Select
                        aria-label={`Durée de la séance ${index + 1}`}
                        value={String(session.minutes)}
                        onChange={(input) => {
                          const minutes = Number(input.target.value);
                          update(index, {
                            minutes,
                            endTime: session.startTime ? shiftTime(session.startTime, minutes) : null,
                          });
                        }}
                      >
                        {DURATIONS.map((option) => (
                          <option key={option} value={option}>
                            {option} min
                          </option>
                        ))}
                      </Select>
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(index)}
                      aria-label={`Retirer la séance ${index + 1}`}
                    >
                      Retirer
                    </Button>
                  </div>

                  <p className="mt-2 text-[0.74rem] text-[var(--ink-faint)]">{formatDayLong(session.day)}</p>
                </li>
              ))}
            </ul>

            {draft.length === 0 && (
              <p className="text-[0.85rem] text-[var(--ink-soft)]">
                Toutes les séances ont été retirées — il n’y a plus rien à ajouter.
              </p>
            )}
          </>
        )}

        {unplaced.length > 0 && (
          <section data-plan-unplaced>
            <h3 className="text-[0.85rem] font-semibold">Non placées</h3>
            <p className="mt-0.5 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
              Le planificateur préfère le dire plutôt que de les glisser sur un créneau occupé ou une journée déjà
              pleine.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {unplaced.slice(0, 4).map((entry, index) => (
                <li key={`${entry.request.title}-${index}`} className="text-[0.8rem] text-[var(--ink-soft)]">
                  <span className="font-medium">{entry.request.title}</span> — {entry.reason}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}

function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, (h ?? 0) * 60 + (m ?? 0) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}
