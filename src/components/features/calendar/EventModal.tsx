import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Textarea } from '@/components/ui';
import { EVENT_KINDS, addMinutes, isLecture } from '@/core/calendar';
import { WEEKDAY_LABELS, WEEKDAY_ORDER, WEEKDAY_SHORT, weekdayOf } from '@/core/calendar/availability';
import type {
  CalendarEvent,
  CalendarEventKind,
  Chapter,
  DayKey,
  ID,
  Importance,
  Recurrence,
  Subject,
  WeekdayId,
} from '@/types';

/**
 * Création et modification d'un événement — le même formulaire pour les deux,
 * parce que ce sont les mêmes champs et la même table.
 *
 * Le chapitre n'apparaît que si la matière choisie en possède réellement : un
 * sélecteur vide serait un champ qui ment sur ce qu'il propose.
 */

const IMPORTANCE_OPTIONS: { value: Importance; label: string }[] = [
  { value: 1, label: 'Normale' },
  { value: 2, label: 'Importante' },
  { value: 3, label: 'Prioritaire' },
];

export interface EventFormValues {
  title: string;
  kind: CalendarEventKind;
  day: DayKey;
  subjectId: ID | null;
  chapterId: ID | null;
  startTime: string | null;
  endTime: string | null;
  importance: Importance;
  notes: string;
  /** Cours universitaires seulement — vides ailleurs. */
  room: string;
  teacher: string;
  /** Null quand le cours ne se répète pas. */
  recurrence: Recurrence | null;
}

export function EventModal({
  open,
  day,
  event,
  series = null,
  subjects,
  chapters,
  onClose,
  onSubmit,
}: {
  open: boolean;
  day: DayKey;
  /** Null pour une création. */
  event: CalendarEvent | null;
  /** Ligne SÉRIE de l'événement modifié, quand c'en est une occurrence. */
  series?: CalendarEvent | null;
  subjects: Subject[];
  chapters: Chapter[];
  onClose: () => void;
  onSubmit: (values: EventFormValues) => void | Promise<void>;
}) {
  const [values, setValues] = useState<EventFormValues>(() => initialValues(day, event, subjects, series));
  const [saving, setSaving] = useState(false);

  // Rouvrir la fenêtre doit toujours repartir de l'événement visé, pas de la
  // saisie précédente.
  useEffect(() => {
    if (open) setValues(initialValues(day, event, subjects, series));
  }, [open, day, event, subjects, series]);

  const subjectChapters = chapters.filter((chapter) => chapter.subjectId === values.subjectId);
  const lecture = isLecture(values);
  const personal = values.kind === 'personal';

  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  /** Un jour se coche et se décoche ; la liste reste dans l'ordre de la semaine. */
  const toggleWeekday = (id: WeekdayId) =>
    setValues((current) => {
      const recurrence = current.recurrence;
      if (!recurrence) return current;
      const weekdays = recurrence.weekdays.includes(id)
        ? recurrence.weekdays.filter((entry) => entry !== id)
        : WEEKDAY_ORDER.filter((entry) => entry === id || recurrence.weekdays.includes(entry));
      return { ...current, recurrence: { ...recurrence, weekdays } };
    });

  const submit = async () => {
    if (values.title.trim().length === 0 || saving) return;
    // Une série sans jour ne produirait aucune occurrence : la refuser vaut
    // mieux qu'enregistrer un cours qui n'apparaîtra jamais.
    if (values.recurrence !== null && values.recurrence.weekdays.length === 0) return;
    setSaving(true);
    try {
      await onSubmit(values);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event ? 'Modifier l’événement' : 'Nouvel événement'}
      description="Enregistré dans ton calendrier ; les évaluations influencent immédiatement tes priorités."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={values.title.trim().length === 0 || saving}>
            {event ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <Input
          label="Titre"
          placeholder="Révision — nerfs crâniens"
          value={values.title}
          onChange={(input) => set('title', input.target.value)}
        />

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Select
            label="Type"
            value={values.kind}
            onChange={(input) => set('kind', input.target.value as CalendarEventKind)}
          >
            {EVENT_KINDS.map((meta) => (
              <option key={meta.kind} value={meta.kind}>
                {meta.label}
              </option>
            ))}
          </Select>
          <Input label="Date" type="date" value={values.day} onChange={(input) => set('day', input.target.value)} />
        </div>

        {/* Un repas ou une séance de sport n'appartient à aucune matière :
            proposer un sélecteur reviendrait à en imposer une par défaut. */}
        {!personal && (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Select
            label="Matière"
            value={values.subjectId ?? ''}
            onChange={(input) => {
              const next = input.target.value === '' ? null : input.target.value;
              // Changer de matière invalide le chapitre : le garder pointerait
              // vers un chapitre d'une autre matière.
              setValues((current) => ({ ...current, subjectId: next, chapterId: null }));
            }}
          >
            <option value="">Aucune matière</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>

          {subjectChapters.length > 0 ? (
            <Select
              label="Chapitre"
              value={values.chapterId ?? ''}
              onChange={(input) => set('chapterId', input.target.value === '' ? null : input.target.value)}
            >
              <option value="">Toute la matière</option>
              {subjectChapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.name}
                </option>
              ))}
            </Select>
          ) : (
            <Select label="Importance" value={String(values.importance)} onChange={(input) => set('importance', Number(input.target.value) as Importance)}>
              {IMPORTANCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </div>
        )}

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Input
            label="Heure de début"
            hint="Facultative — sans heure, l’événement occupe la journée."
            type="time"
            value={values.startTime ?? ''}
            onChange={(input) => {
              const start = input.target.value === '' ? null : input.target.value;
              setValues((current) => ({
                ...current,
                startTime: start,
                // Une fin antérieure au début n'a pas de sens : on la recale
                // sur une durée d'une heure plutôt que d'accepter l'incohérence.
                endTime:
                  start === null
                    ? null
                    : current.endTime && current.endTime > start
                      ? current.endTime
                      : addMinutes(start, 60),
              }));
            }}
          />
          <Input
            label="Heure de fin"
            type="time"
            value={values.endTime ?? ''}
            disabled={values.startTime === null}
            onChange={(input) => set('endTime', input.target.value === '' ? null : input.target.value)}
          />
        </div>

        {subjectChapters.length > 0 && (
          <Select
            label="Importance"
            value={String(values.importance)}
            onChange={(input) => set('importance', Number(input.target.value) as Importance)}
          >
            {IMPORTANCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}

        {/* ── Cours universitaire : salle et enseignant ── */}
        {lecture && (
          <div className="grid gap-4 sm:grid-cols-2" data-event-lecture-fields>
            <Input
              label="Salle"
              placeholder="Facultatif — ex. Amphi B"
              value={values.room}
              onChange={(input) => set('room', input.target.value)}
            />
            <Input
              label="Enseignant"
              placeholder="Facultatif"
              value={values.teacher}
              onChange={(input) => set('teacher', input.target.value)}
            />
          </div>
        )}

        {/* ── Récurrence — pour TOUT genre d'événement ──
            Un cours se répète, mais un entraînement, un repas ou une séance de
            révision hebdomadaire aussi. La réserver aux cours obligeait à
            recréer la même ligne chaque semaine. */}
        <div className="flex min-w-0 flex-col gap-3">
          <Select
            label="Récurrence"
            value={values.recurrence === null ? 'none' : 'weekly'}
            data-event-recurrence-mode
            onChange={(input) =>
              setValues((current) => ({
                ...current,
                recurrence:
                  input.target.value === 'none'
                    ? null
                    : {
                        // Par défaut, le jour de la date choisie : c'est le seul
                        // dont on soit sûr qu'il convienne.
                        weekdays: [weekdayOf(current.day)],
                        startDay: current.day,
                        endDay: null,
                      },
              }))
            }
          >
            <option value="none">Aucune</option>
            <option value="weekly">Chaque semaine</option>
          </Select>

          {values.recurrence !== null && (
            <div
              className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--line)] p-3"
              data-event-recurrence
            >
              <div className="min-w-0">
                <p className="mb-1.5 text-[0.78rem] font-semibold tracking-wide text-[var(--ink-soft)]">
                  Jours de la semaine
                </p>
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAY_ORDER.map((id) => {
                    const active = values.recurrence!.weekdays.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleWeekday(id)}
                        aria-pressed={active}
                        aria-label={WEEKDAY_LABELS[id]}
                        data-recurrence-day={id}
                        data-touch-target
                        className={
                          'min-h-11 min-w-0 rounded-[var(--radius-control)] border px-0.5 text-[0.72rem] font-medium transition-colors ' +
                          (active
                            ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
                            : 'border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--surface-2)]')
                        }
                      >
                        {WEEKDAY_SHORT[id]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <Input
                  label="À partir du"
                  type="date"
                  className="min-w-0"
                  value={values.recurrence.startDay}
                  onChange={(input) =>
                    setValues((current) => ({
                      ...current,
                      recurrence: { ...current.recurrence!, startDay: input.target.value },
                    }))
                  }
                />
                <Input
                  label="Jusqu’au"
                  hint="Facultatif — sans date de fin, la série continue."
                  type="date"
                  className="min-w-0"
                  value={values.recurrence.endDay ?? ''}
                  onChange={(input) =>
                    setValues((current) => ({
                      ...current,
                      recurrence: {
                        ...current.recurrence!,
                        endDay: input.target.value === '' ? null : input.target.value,
                      },
                    }))
                  }
                />
              </div>
              {values.recurrence.weekdays.length === 0 && (
                <p className="text-[0.78rem] text-[var(--mastery-1)]">
                  Choisis au moins un jour : sans jour, la série n’a aucune occurrence.
                </p>
              )}
            </div>
          )}
        </div>

        <Textarea
          label="Notes"
          rows={3}
          placeholder="Facultatif"
          value={values.notes}
          onChange={(input) => set('notes', input.target.value)}
        />
      </div>
    </Modal>
  );
}

function initialValues(
  day: DayKey,
  event: CalendarEvent | null,
  subjects: Subject[],
  series: CalendarEvent | null = null,
): EventFormValues {
  if (event) {
    // Pour une occurrence de série, la récurrence à afficher est celle de la
    // SÉRIE, pas celle de l'occurrence (qui n'en porte aucune).
    const recurrence = event.recurrence ?? series?.recurrence ?? null;
    return {
      title: event.title,
      kind: event.kind,
      day: event.day,
      subjectId: event.subjectId,
      chapterId: event.chapterId ?? null,
      startTime: event.startTime,
      endTime: event.endTime,
      importance: event.importance ?? 2,
      notes: event.notes,
      room: event.room ?? '',
      teacher: event.teacher ?? '',
      recurrence: recurrence ? { ...recurrence, weekdays: [...recurrence.weekdays] } : null,
    };
  }
  return {
    title: '',
    kind: 'course',
    day,
    subjectId: subjects[0]?.id ?? null,
    chapterId: null,
    startTime: null,
    endTime: null,
    importance: 2,
    notes: '',
    room: '',
    teacher: '',
    recurrence: null,
  };
}
