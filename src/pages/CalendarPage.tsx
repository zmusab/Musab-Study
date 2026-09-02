import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageTransition } from '@/components/layout/PageTransition';
import { FadeUp } from '@/components/motion/Motion';
import { Button, Card, Icon, SegmentedControl, useConfirm, useToast } from '@/components/ui';
import { MonthGrid } from '@/components/features/calendar/MonthGrid';
import { WeekView } from '@/components/features/calendar/WeekView';
import { DayAgendaPanel } from '@/components/features/calendar/DayAgendaPanel';
import { EventModal, type EventFormValues } from '@/components/features/calendar/EventModal';
import { ExamPrepModal } from '@/components/features/calendar/ExamPrepModal';
import { useCalendar } from '@/hooks/useCalendar';
import {
  buildAgenda,
  dueByDay,
  examBrief,
  eventKindMeta,
  formatMonthYear,
  monthMatrix,
  upcomingEvents,
  weekOf,
  type AgendaEvent,
  type PlannedSession,
} from '@/core/calendar';
import {
  completeSession,
  createEvent,
  createEvents,
  deleteEvent,
  deletePlanFor,
  resetSession,
  startSession,
  updateEvent,
} from '@/data/repositories/calendar';
import { addDays, dayKey, daysBetweenDayKeys, parseDayKey } from '@/lib/date';
import { formatDuration } from '@/core/progress';
import type { CalendarEvent, DayKey } from '@/types';

/**
 * CALENDRIER — voir sa journée, comprendre ce qui est urgent, commencer.
 *
 * Le calendrier ne possède aucune donnée : il lit `calendarEvents` (ce qui a
 * été saisi) et `flashcards` (les échéances calculées par la répétition
 * espacée). Une journée sans rien s'affiche vide ; aucun événement n'est
 * fabriqué pour meubler la grille.
 *
 * Les cartes dues ne deviennent jamais des événements : elles sont agrégées en
 * une seule ligne par jour, sans quoi le mois serait illisible.
 */

const VIEW_SEGMENTS = [
  { value: 'month' as const, label: 'Mois' },
  { value: 'week' as const, label: 'Semaine' },
  { value: 'day' as const, label: 'Jour' },
];
type CalendarView = (typeof VIEW_SEGMENTS)[number]['value'];

export function CalendarPage() {
  const source = useCalendar();
  const navigate = useNavigate();
  const { notify } = useToast();
  const confirm = useConfirm();

  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<DayKey>(() => dayKey(new Date()));
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [examEvent, setExamEvent] = useState<CalendarEvent | null>(null);

  const now = useMemo(() => (source ? new Date(source.loadedAt) : new Date()), [source]);

  // Jours réellement affichés : c'est le seul périmètre sur lequel on agrège
  // les cartes dues, pour ne pas parcourir toute la base à chaque rendu.
  const weeks = useMemo(() => (source ? monthMatrix(anchor, now) : []), [source, anchor, now]);
  const weekDays = useMemo(() => weekOf(anchor), [anchor]);
  const visibleDays = useMemo(() => {
    if (view === 'month') return weeks.flat().map((cell) => cell.day);
    if (view === 'week') return weekDays;
    return [selected];
  }, [view, weeks, weekDays, selected]);

  const due = useMemo(() => {
    if (!source) return new Map();
    // La journée sélectionnée est toujours incluse : le panneau de droite en a
    // besoin même quand elle sort de la vue courante.
    const days = [...new Set([...visibleDays, selected])];
    return dueByDay(source.cards, days, source.subjects, now);
  }, [source, visibleDays, selected, now]);

  const agendaFor = useCallback(
    (day: DayKey) =>
      source
        ? buildAgenda(day, source.events, due, source.subjects, source.chapters, now)
        : buildAgenda(day, [], new Map(), [], [], now),
    [source, due, now],
  );

  const selectedAgenda = useMemo(() => agendaFor(selected), [agendaFor, selected]);

  const upcoming = useMemo(
    () => (source ? upcomingEvents(source.events, now, 60).slice(0, 3) : []),
    [source, now],
  );

  const brief = useMemo(() => {
    if (!source || !examEvent) return null;
    return examBrief(examEvent, source.subjects, source.chapters, source.cards, source.logs, source.events, now);
  }, [source, examEvent, now]);

  if (!source) return null;

  const today = dayKey(now);
  const step = (direction: number) => {
    if (view === 'month') setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
    else if (view === 'week') setAnchor(addDays(anchor, direction * 7));
    else {
      const next = addDays(parseDayKey(selected), direction);
      setSelected(dayKey(next));
      setAnchor(next);
    }
  };
  const goToday = () => {
    setAnchor(new Date(now));
    setSelected(today);
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (entry: AgendaEvent) => {
    setEditing(entry.event);
    setFormOpen(true);
  };

  const submitEvent = async (values: EventFormValues) => {
    if (editing) {
      await updateEvent(editing.id, {
        title: values.title.trim(),
        kind: values.kind,
        day: values.day,
        subjectId: values.subjectId,
        chapterId: values.chapterId,
        startTime: values.startTime,
        endTime: values.endTime,
        importance: values.importance,
        notes: values.notes.trim(),
      });
      notify('Événement mis à jour.', 'success');
    } else {
      await createEvent({
        title: values.title,
        kind: values.kind,
        day: values.day,
        subjectId: values.subjectId,
        chapterId: values.chapterId,
        startTime: values.startTime,
        endTime: values.endTime,
        importance: values.importance,
        notes: values.notes,
      });
      notify('Événement ajouté.', 'success');
    }
    setSelected(values.day);
    setFormOpen(false);
    setEditing(null);
  };

  const removeEvent = async (entry: AgendaEvent) => {
    const ok = await confirm({
      title: 'Supprimer cet événement ?',
      description: entry.event.title,
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!ok) return;
    await deleteEvent(entry.event.id);
    notify('Événement supprimé.', 'success');
  };

  /**
   * Démarrer une séance la chronomètre ET ouvre la file de révision des cartes
   * concernées : le bouton fait réellement commencer le travail, il ne se
   * contente pas de changer un état.
   */
  const start = async (entry: AgendaEvent) => {
    await startSession(entry.event.id);
    const cards = cardsForSession(entry.event, source.cards);
    if (cards.length > 0) navigate(`/revisions?cards=${cards.join(',')}`);
    else notify('Séance commencée. Aucune flashcard rattachée à cette sélection.', 'info');
  };

  const complete = async (entry: AgendaEvent) => {
    const result = await completeSession(entry.event.id);
    if (result === null) {
      notify('Séance terminée.', 'success');
      return;
    }
    notify(
      `Séance terminée — ${formatDuration(result.elapsedMs)} enregistré${result.capped ? ' (plafonné)' : ''}.`,
      'success',
    );
  };

  const acceptPlan = async (sessions: PlannedSession[], replace: boolean) => {
    if (!examEvent) return;
    if (replace) await deletePlanFor(examEvent.id);
    await createEvents(
      sessions.map((session) => ({
        title: session.title,
        kind: 'review' as const,
        day: session.day,
        subjectId: examEvent.subjectId,
        chapterId: session.chapterId,
        startTime: null,
        endTime: null,
        importance: 2 as const,
        notes: session.reason,
        planForEventId: examEvent.id,
      })),
    );
    notify(`${sessions.length} séances ajoutées à ton calendrier.`, 'success');
    setExamEvent(null);
  };

  return (
    <PageTransition>
      <FadeUp>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[1.9rem] leading-tight">Calendrier</h1>
            <p className="mt-1.5 max-w-[42rem] text-[0.92rem] leading-relaxed text-[var(--ink-soft)]">
              Tes évaluations, tes séances et les cartes que la répétition espacée programme — au même endroit.
            </p>
          </div>
          <Button onClick={openCreate} data-calendar-new>
            Nouvel événement
          </Button>
        </div>
      </FadeUp>

      {/* ── Prochaines évaluations : ce qui commande l'agenda ── */}
      {upcoming.length > 0 && (
        <FadeUp>
          <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3" data-calendar-upcoming>
            {upcoming.map((event) => {
              const meta = eventKindMeta(event.kind);
              const days = daysBetweenDayKeys(today, event.day);
              const subject = source.subjects.find((entry) => entry.id === event.subjectId);
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(event.day);
                      setAnchor(parseDayKey(event.day));
                      setExamEvent(event);
                    }}
                    className="surface-card flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span
                      aria-hidden
                      className="h-9 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: meta.colorVar }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9rem] font-medium">{event.title}</span>
                      <span className="mt-0.5 block truncate text-[0.78rem] text-[var(--ink-faint)]">
                        {meta.label}
                        {subject ? ` · ${subject.name}` : ''}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-[0.82rem] font-medium tabular-nums"
                      style={{ color: days <= 3 ? 'var(--mastery-0)' : 'var(--ink-soft)' }}
                    >
                      {days === 0 ? 'auj.' : `J−${days}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </FadeUp>
      )}

      {/* ── Barre de navigation ── */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Période précédente"
            data-touch-target
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)]"
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Période suivante"
            data-touch-target
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)]"
          >
            <Icon name="chevronRight" size={16} />
          </button>
          <h2 className="ml-2 text-[1.05rem]" data-calendar-title>
            {view === 'day' ? formatMonthYear(parseDayKey(selected)) : formatMonthYear(anchor)}
          </h2>
          <Button size="sm" variant="ghost" onClick={goToday} data-calendar-today>
            Aujourd’hui
          </Button>
        </div>
        <SegmentedControl size="sm" segments={VIEW_SEGMENTS} value={view} onChange={setView} />
      </div>

      {/* ── Grille + agenda ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          {view === 'month' && (
            <MonthGrid weeks={weeks} agendaFor={agendaFor} selected={selected} onSelect={setSelected} />
          )}
          {view === 'week' && (
            <WeekView
              days={weekDays}
              agendaFor={agendaFor}
              selected={selected}
              today={today}
              onSelect={setSelected}
            />
          )}
          {view === 'day' && (
            <WeekView
              days={[selected]}
              agendaFor={agendaFor}
              selected={selected}
              today={today}
              onSelect={setSelected}
            />
          )}
        </Card>

        <Card className="lg:max-h-[42rem]">
          <DayAgendaPanel
            agenda={selectedAgenda}
            onStart={start}
            onComplete={complete}
            onReset={(entry) => resetSession(entry.event.id)}
            onEdit={openEdit}
            onDelete={removeEvent}
            onCreate={openCreate}
            onOpenExam={(entry) => setExamEvent(entry.event)}
          />
        </Card>
      </div>

      <EventModal
        open={formOpen}
        day={selected}
        event={editing}
        subjects={source.subjects}
        chapters={source.chapters}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={submitEvent}
      />

      <ExamPrepModal
        open={examEvent !== null}
        brief={brief}
        chapters={source.chapters}
        cards={source.cards}
        logs={source.logs}
        now={now}
        onClose={() => setExamEvent(null)}
        onAcceptPlan={(sessions) => acceptPlan(sessions, false)}
        onReplacePlan={(sessions) => acceptPlan(sessions, true)}
      />
    </PageTransition>
  );
}

/**
 * Cartes concernées par une séance : celles de son chapitre, ou toute la
 * matière si la séance n'en cible aucun. Sans matière, il n'y a rien à ouvrir
 * — et on le dit plutôt que d'ouvrir une file vide.
 */
function cardsForSession(event: CalendarEvent, cards: { id: string; subjectId: string; chapterId: string | null }[]) {
  if (!event.subjectId) return [];
  return cards
    .filter(
      (card) =>
        card.subjectId === event.subjectId &&
        (event.chapterId == null || card.chapterId === event.chapterId),
    )
    .map((card) => card.id);
}
