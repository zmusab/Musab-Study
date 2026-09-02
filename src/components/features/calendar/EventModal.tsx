import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Textarea } from '@/components/ui';
import { EVENT_KINDS, addMinutes } from '@/core/calendar';
import type { CalendarEvent, CalendarEventKind, Chapter, DayKey, ID, Importance, Subject } from '@/types';

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
}

export function EventModal({
  open,
  day,
  event,
  subjects,
  chapters,
  onClose,
  onSubmit,
}: {
  open: boolean;
  day: DayKey;
  /** Null pour une création. */
  event: CalendarEvent | null;
  subjects: Subject[];
  chapters: Chapter[];
  onClose: () => void;
  onSubmit: (values: EventFormValues) => void | Promise<void>;
}) {
  const [values, setValues] = useState<EventFormValues>(() => initialValues(day, event, subjects));
  const [saving, setSaving] = useState(false);

  // Rouvrir la fenêtre doit toujours repartir de l'événement visé, pas de la
  // saisie précédente.
  useEffect(() => {
    if (open) setValues(initialValues(day, event, subjects));
  }, [open, day, event, subjects]);

  const subjectChapters = chapters.filter((chapter) => chapter.subjectId === values.subjectId);

  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (values.title.trim().length === 0 || saving) return;
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
      <div className="flex flex-col gap-4">
        <Input
          label="Titre"
          placeholder="Révision — nerfs crâniens"
          value={values.title}
          onChange={(input) => set('title', input.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
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

        <div className="grid gap-4 sm:grid-cols-2">
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

        <div className="grid gap-4 sm:grid-cols-2">
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

function initialValues(day: DayKey, event: CalendarEvent | null, subjects: Subject[]): EventFormValues {
  if (event) {
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
  };
}
