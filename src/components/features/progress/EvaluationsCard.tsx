import { useState, type CSSProperties } from 'react';
import { Button, Card, Icon, Input, Modal, Select, useToast } from '@/components/ui';
import { createEvent, deleteEvent } from '@/data/repositories/calendar';
import { dayKey, parseDayKey } from '@/lib/date';
import type { CalendarEventKind, Subject } from '@/types';
import { EVALUATION_KIND_LABELS, type Evaluation } from '@/core/progress/exam';

/**
 * PROCHAINES ÉVALUATIONS — lues dans la table `calendarEvents`, celle-là même
 * que la future page Calendrier utilisera. Aucune date n'est déduite ni
 * complétée : ce qui s'affiche ici a été saisi.
 *
 * La saisie est fournie ici parce que la page Calendrier n'existe pas encore.
 * Renvoyer l'utilisateur vers un écran inexistant reviendrait à rendre la
 * fonctionnalité inutilisable ; écrire dans une table à part créerait un
 * doublon. On écrit donc dans la vraie table, avec le vrai modèle.
 */

/** Ordre de saisie, du plus courant au plus rare ; libellés issus du cœur. */
const KIND_OPTIONS: CalendarEventKind[] = ['midterm', 'exam', 'final', 'task'];

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

export function EvaluationsCard({
  evaluations,
  subjects,
  onChanged,
  limit = 3,
}: {
  evaluations: Evaluation[];
  subjects: Subject[];
  onChanged?: () => void;
  /** Évaluations montrées d'emblée ; le reste passe derrière « Voir toutes ». */
  limit?: number;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { notify } = useToast();
  const shown = expanded ? evaluations : evaluations.slice(0, limit);
  const hidden = evaluations.length - shown.length;

  return (
    <>
      {evaluations.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--line)] bg-[var(--surface-2)]/40 p-5">
          <p className="text-[0.95rem] font-medium text-[var(--ink-soft)]">Aucune évaluation connue</p>
          <p className="mt-1.5 max-w-[38rem] text-[0.85rem] leading-relaxed text-[var(--ink-faint)]">
            Ajoute tes prochains contrôles ou examens pour que Musab Study adapte tes priorités à l’approche des
            dates. Sans échéance enregistrée, la page continue de fonctionner : c’est la suffisance examen qui
            pilote alors le classement.
          </p>
          <Button size="sm" className="mt-4" onClick={() => setOpen(true)}>
            Ajouter une évaluation
          </Button>
        </div>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-[var(--line)]" data-progress-evaluations>
            {shown.map((evaluation, index) => (
              <li
                key={evaluation.event.id}
                className={
                  'flex items-center gap-3 px-4 py-3' + (index >= limit ? ' reveal' : '')
                }
                style={index >= limit ? ({ '--reveal-index': index - limit } as CSSProperties) : undefined}
              >
                <span
                  aria-hidden
                  className="h-8 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: urgencyColor(evaluation.daysUntil) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.95rem] font-medium">{evaluation.event.title}</span>
                  <span className="mt-0.5 block text-[0.82rem] text-[var(--ink-soft)]">
                    {evaluation.label}
                    {evaluation.subjectName ? ` · ${evaluation.subjectName}` : ''} ·{' '}
                    {DATE_FORMAT.format(parseDayKey(evaluation.day))}
                  </span>
                </span>
                <span
                  className="shrink-0 text-[0.85rem] font-medium tabular-nums"
                  style={{ color: urgencyColor(evaluation.daysUntil) }}
                >
                  {evaluation.daysUntil === 0
                    ? 'Aujourd’hui'
                    : evaluation.daysUntil === 1
                      ? 'Demain'
                      : `Dans ${evaluation.daysUntil} jours`}
                </span>
                <button
                  type="button"
                  aria-label={`Supprimer ${evaluation.event.title}`}
                  data-touch-target
                  onClick={async () => {
                    await deleteEvent(evaluation.event.id);
                    notify('Évaluation supprimée.', 'success');
                    onChanged?.();
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger)]"
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-4 py-3">
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              Ajouter une évaluation
            </Button>
            {(hidden > 0 || expanded) && (
              <button
                type="button"
                data-progress-evaluations-more
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="rounded-full px-3 py-1.5 text-[0.8rem] font-medium text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                {expanded ? 'Voir moins' : `Voir toutes les évaluations (${evaluations.length})`}
              </button>
            )}
          </div>
        </Card>
      )}

      <EvaluationModal
        open={open}
        subjects={subjects}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          notify('Évaluation ajoutée à ton calendrier.', 'success');
          onChanged?.();
        }}
      />
    </>
  );
}

function urgencyColor(days: number): string {
  if (days <= 3) return 'var(--danger)';
  if (days <= 10) return 'var(--warning)';
  return 'var(--ink-faint)';
}

function EvaluationModal({
  open,
  subjects,
  onClose,
  onCreated,
}: {
  open: boolean;
  subjects: Subject[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<CalendarEventKind>('midterm');
  const [day, setDay] = useState(dayKey(new Date()));
  const [subjectId, setSubjectId] = useState<string>(subjects[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (title.trim().length === 0 || saving) return;
    setSaving(true);
    try {
      await createEvent({
        title,
        kind,
        day,
        subjectId: subjectId === '' ? null : subjectId,
      });
      setTitle('');
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter une évaluation"
      description="Elle est enregistrée dans ton calendrier et influence immédiatement tes priorités."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={title.trim().length === 0 || saving}>
            Ajouter
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Intitulé"
          placeholder="Contrôle d’anatomie — tête et cou"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Select label="Nature" value={kind} onChange={(event) => setKind(event.target.value as CalendarEventKind)}>
          {KIND_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {EVALUATION_KIND_LABELS[option]}
            </option>
          ))}
        </Select>
        <Input label="Date" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        <Select
          label="Matière"
          hint="Sans matière, l’évaluation apparaît dans la liste mais ne change aucune priorité."
          value={subjectId}
          onChange={(event) => setSubjectId(event.target.value)}
        >
          <option value="">Aucune matière</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  );
}
