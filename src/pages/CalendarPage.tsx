import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp } from '@/components/motion/Motion';
import { Button, Card, Icon, SegmentedControl, useConfirm, useToast } from '@/components/ui';
import { MonthGrid } from '@/components/features/calendar/MonthGrid';
import { WeekView } from '@/components/features/calendar/WeekView';
import { DayAgendaPanel } from '@/components/features/calendar/DayAgendaPanel';
import { EventModal, type EventFormValues } from '@/components/features/calendar/EventModal';
import { ExamPrepModal } from '@/components/features/calendar/ExamPrepModal';
import { TimetableView } from '@/components/features/calendar/TimetableView';
import { SeriesScopeModal } from '@/components/features/calendar/SeriesScopeModal';
import { PlanReviewModal } from '@/components/features/calendar/PlanReviewModal';
import { AvailabilityModal } from '@/components/features/calendar/AvailabilityModal';
import { useCalendar } from '@/hooks/useCalendar';
import { useProfile } from '@/hooks/useProfile';
import { saveProfile } from '@/data/repositories/profile';
import {
  WEEKDAY_ORDER,
  normalizeAvailability,
  serializeAvailability,
  type WeeklyAvailability,
} from '@/core/calendar/availability';
import { expandRecurring, isSeriesMaster } from '@/core/calendar/recurrence';
import { planWeek } from '@/core/calendar/plans';
import { dayLoad, LOAD_COLORS, LOAD_LABELS } from '@/core/calendar/load';
import {
  buildAgenda,
  dueByDay,
  examBrief,
  eventKindMeta,
  formatDayLong,
  isFixedBlock,
  isLecture,
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
  deleteRecurringEvent,
  deleteEvent,
  deletePlanFor,
  resetSession,
  startSession,
  updateRecurringEvent,
  updateEvent,
  type SeriesScope,
} from '@/data/repositories/calendar';
import { addDays, dayKey, daysBetweenDayKeys, parseDayKey } from '@/lib/date';
import { formatDuration } from '@/core/progress';
import type { CalendarEvent, DayKey, ID, WeekdayId } from '@/types';

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
  // L'emploi du temps n'est pas une quatrième façon de regarder des dates :
  // c'est la semaine TYPE, celle qui se répète.
  { value: 'timetable' as const, label: 'Emploi du temps' },
];
type CalendarView = (typeof VIEW_SEGMENTS)[number]['value'];

export function CalendarPage() {
  const source = useCalendar();
  const profile = useProfile();
  const navigate = useNavigate();
  const { notify } = useToast();
  const confirm = useConfirm();

  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<DayKey>(() => dayKey(new Date()));
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [examEvent, setExamEvent] = useState<CalendarEvent | null>(null);
  /** Portée à choisir avant d'agir sur un cours récurrent. */
  const [scopeAsk, setScopeAsk] = useState<{ event: CalendarEvent; action: 'edit' | 'delete' } | null>(null);
  const [editScope, setEditScope] = useState<SeriesScope>('occurrence');
  const [weekPlanOpen, setWeekPlanOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Lien direct depuis l'Assistant IA (« Préparer une session de révision »)
  // — ouvre EXACTEMENT le même plan que le bouton « Planifier ma semaine ».
  useEffect(() => {
    if (searchParams.get('plan') === 'week') {
      setWeekPlanOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const availability = useMemo<WeeklyAvailability>(
    () => normalizeAvailability(profile.availability),
    [profile.availability],
  );
  const sessionMinutes = profile.sessionMinutes ?? 45;

  const now = useMemo(() => (source ? new Date(source.loadedAt) : new Date()), [source]);

  /**
   * Les séries de cours sont dépliées UNE fois, ici, sur une fenêtre qui
   * couvre à la fois ce qui est affiché et l'horizon du planificateur. Tout
   * le reste de la page — grille, agenda, charge, plans — ne voit plus que
   * des événements datés et n'a rien à savoir de la récurrence.
   */
  const events = useMemo(() => {
    if (!source) return [];
    const from = dayKey(addDays(now, -120));
    const to = dayKey(addDays(now, 400));
    return expandRecurring(source.events, from, to);
  }, [source, now]);

  /** Les blocs récurrents, rangés par jour de la semaine — l'emploi du temps. */
  const lecturesByWeekday = useMemo(() => {
    const table = Object.fromEntries(WEEKDAY_ORDER.map((id) => [id, [] as CalendarEvent[]])) as Record<
      WeekdayId,
      CalendarEvent[]
    >;
    for (const event of source?.events ?? []) {
      if (!isFixedBlock(event) || !isSeriesMaster(event)) continue;
      for (const weekday of event.recurrence!.weekdays) table[weekday].push(event);
    }
    return table;
  }, [source]);

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
        ? buildAgenda(day, events, due, source.subjects, source.chapters, now)
        : buildAgenda(day, [], new Map(), [], [], now),
    [source, events, due, now],
  );

  const selectedAgenda = useMemo(() => agendaFor(selected), [agendaFor, selected]);

  const upcoming = useMemo(
    () => (source ? upcomingEvents(events, now, 60).slice(0, 3) : []),
    [source, events, now],
  );

  const weekPlan = useMemo(() => {
    if (!source || !weekPlanOpen) return null;
    return planWeek({
      events,
      subjects: source.subjects,
      chapters: source.chapters,
      cards: source.cards,
      logs: source.logs,
      availability,
      weeklyGoalMinutes: profile.weeklyStudyMinutesGoal,
      minutesPerSession: sessionMinutes,
      now,
    });
  }, [source, events, weekPlanOpen, availability, profile.weeklyStudyMinutesGoal, sessionMinutes, now]);

  const selectedLoad = useMemo(
    () => (source ? dayLoad(selected, events, availability) : null),
    [source, events, selected, availability],
  );

  const brief = useMemo(() => {
    if (!source || !examEvent) return null;
    return examBrief(examEvent, source.subjects, source.chapters, source.cards, source.logs, events, now);
  }, [source, events, examEvent, now]);

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
  /** La ligne SÉRIE dont dépend l'événement en cours d'édition, s'il y en a une. */
  const seriesOf = (event: CalendarEvent | null): CalendarEvent | null => {
    if (!event?.seriesId || !source) return null;
    return source.events.find((row) => row.id === event.seriesId) ?? null;
  };

  /**
   * Modifier ou supprimer une occurrence de cours récurrent demande d'abord
   * la portée : on ne devine pas si « 10 h au lieu de 8 h » vaut pour lundi
   * prochain ou pour tout le semestre.
   */
  const openEdit = (entry: AgendaEvent) => {
    if (entry.event.seriesId) {
      setScopeAsk({ event: entry.event, action: 'edit' });
      return;
    }
    setEditScope('occurrence');
    setEditing(entry.event);
    setFormOpen(true);
  };

  const submitEvent = async (values: EventFormValues) => {
    // Salle et enseignant n'ont de sens que pour un cours : changer de genre
    // en cours de saisie ne doit pas laisser traîner un nom de professeur sur
    // un repas. La récurrence, elle, vaut pour tous les genres.
    const courseFields = {
      room: isLecture(values) ? values.room.trim() || null : null,
      teacher: isLecture(values) ? values.teacher.trim() || null : null,
      recurrence: values.recurrence,
    };

    // « Temps pour soi » n'a ni matière ni chapitre : le formulaire ne les
    // propose pas, la ligne enregistrée ne doit pas en garder non plus.
    const isPersonal = values.kind === 'personal';
    const common = {
      title: values.title.trim(),
      kind: values.kind,
      day: values.day,
      subjectId: isPersonal ? null : values.subjectId,
      chapterId: isPersonal ? null : values.chapterId,
      startTime: values.startTime,
      endTime: values.endTime,
      importance: values.importance,
      notes: values.notes.trim(),
      ...courseFields,
    };

    if (editing) {
      // Une occurrence de série OU la définition elle-même : dans les deux cas
      // c'est le dépôt de séries qui sait quoi écrire selon la portée.
      if (editing.seriesId || editing.recurrence) {
        await updateRecurringEvent(editing, common, editScope);
        notify(
          editScope === 'series'
            ? 'Série mise à jour.'
            : editScope === 'following'
              ? 'Série mise à jour à partir de cette date.'
              : 'Événement mis à jour pour cette date.',
          'success',
        );
      } else {
        await updateEvent(editing.id, common);
        notify('Événement mis à jour.', 'success');
      }
    } else {
      await createEvent(common);
      notify(
        common.recurrence ? 'Événement récurrent ajouté à ton calendrier.' : 'Événement ajouté.',
        'success',
      );
    }
    setSelected(values.day);
    setFormOpen(false);
    setEditing(null);
  };

  const removeEvent = async (entry: AgendaEvent) => {
    if (entry.event.seriesId) {
      setScopeAsk({ event: entry.event, action: 'delete' });
      return;
    }
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
   * Ouvrir une série depuis l'emploi du temps. La portée est « toute la
   * série » sans avoir à la demander : c'est le motif hebdomadaire qu'on
   * regarde, pas une occurrence précise.
   */
  const openSeries = (series: CalendarEvent) => {
    setEditScope('series');
    setEditing(series);
    setFormOpen(true);
  };

  /** Suite d'une action sur un cours récurrent, une fois la portée choisie. */
  const applyScope = async (scope: SeriesScope) => {
    if (!scopeAsk) return;
    const { event, action } = scopeAsk;
    setScopeAsk(null);
    if (action === 'edit') {
      setEditScope(scope);
      setEditing(event);
      setFormOpen(true);
      return;
    }
    await deleteRecurringEvent(event, scope);
    notify(
      scope === 'series'
        ? 'Série supprimée.'
        : scope === 'following'
          ? 'Série supprimée à partir de cette date.'
          : 'Retiré de cette date uniquement.',
      'success',
    );
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

  /**
   * Écrit un plan validé. C'est le SEUL endroit qui touche à la base pour un
   * plan : tant que cette fonction n'est pas appelée, la proposition n'existe
   * qu'à l'écran.
   */
  const persistPlan = async (sessions: PlannedSession[], planForEventId: ID | null) => {
    await createEvents(
      sessions.map((session) => ({
        title: session.title,
        kind: 'review' as const,
        day: session.day,
        subjectId: session.subjectId,
        chapterId: session.chapterId,
        startTime: session.startTime,
        endTime: session.endTime,
        importance: 2 as const,
        notes: session.reason,
        planForEventId: planForEventId ?? session.planForEventId ?? null,
      })),
    );
    notify(
      `${sessions.length} séance${sessions.length > 1 ? 's' : ''} ajoutée${sessions.length > 1 ? 's' : ''} à ton calendrier.`,
      'success',
    );
  };

  const acceptPlan = async (sessions: PlannedSession[], replace: boolean) => {
    if (!examEvent) return;
    if (replace) await deletePlanFor(examEvent.id);
    await persistPlan(sessions, examEvent.id);
    setExamEvent(null);
  };

  return (
    <PageTransition>
      {/* Même en-tête que toutes les autres sections — surtitre scientifique
          et filet de séparation compris. Le Calendrier dessinait le sien à la
          main, avec sa propre taille de titre. */}
      <PageHeader
        title="Calendrier"
        subtitle="Tes évaluations, tes séances et les cartes que la répétition espacée programme — au même endroit."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAvailabilityOpen(true)} data-calendar-availability>
              Mes disponibilités
            </Button>
            <Button variant="secondary" onClick={() => setWeekPlanOpen(true)} data-calendar-plan-week>
              Planifier ma semaine
            </Button>
            <Button onClick={openCreate} data-calendar-new>
              Nouvel événement
            </Button>
          </div>
        }
      />

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

      {/* ── Emploi du temps : la semaine TYPE, pleine largeur ── */}
      {view === 'timetable' && (
        <Card className="mt-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[1.05rem]">Semaine type</h2>
            <p className="text-[0.8rem] text-[var(--ink-faint)]">
              Tes cours et temps pour toi récurrents, et ce qui reste libre dans tes plages déclarées.
            </p>
          </div>
          <TimetableView
            blocksByWeekday={lecturesByWeekday}
            availability={availability}
            onEditSeries={openSeries}
          />
        </Card>
      )}

      {/* ── Grille + agenda ── */}
      <div
        className={
          'mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] ' +
          (view === 'timetable' ? 'hidden' : '')
        }
      >
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
          {selectedLoad && (
            <p
              data-calendar-load
              data-load-level={selectedLoad.level}
              className="mb-3 flex flex-wrap items-center gap-2 text-[0.78rem]"
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: LOAD_COLORS[selectedLoad.level] }}
              />
              <span style={{ color: LOAD_COLORS[selectedLoad.level] }}>{LOAD_LABELS[selectedLoad.level]}</span>
              <span className="text-[var(--ink-faint)]" data-load-detail>
                {selectedLoad.capacity === 0
                  ? 'Aucune plage déclarée ce jour-là'
                  : `${selectedLoad.minutes} min engagées sur ${selectedLoad.capacity} disponibles`}
                {/* Le travail fait reste visible : c'est ce qui explique
                    pourquoi le planificateur évite cette journée. */}
                {selectedLoad.workedMinutes > 0 && ` · ${selectedLoad.workedMinutes} min déjà travaillées`}
              </span>
            </p>
          )}
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
        series={seriesOf(editing)}
        subjects={source.subjects}
        chapters={source.chapters}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={submitEvent}
      />

      <PlanReviewModal
        open={weekPlanOpen}
        title="Planifier ma semaine"
        description="Croise tes évaluations, tes chapitres faibles, tes cartes dues et ton objectif hebdomadaire."
        sessions={weekPlan?.sessions ?? []}
        unplaced={weekPlan?.unplaced ?? []}
        blocked={weekPlan?.blocked ?? null}
        footerNote={
          weekPlan
            ? `Objectif : ${weekPlan.goalMinutes} min/semaine, ${weekPlan.committedMinutes} min déjà planifiées.`
            : undefined
        }
        onClose={() => setWeekPlanOpen(false)}
        onConfirm={async (sessions) => {
          await persistPlan(sessions, null);
          setWeekPlanOpen(false);
        }}
      />

      <AvailabilityModal
        open={availabilityOpen}
        availability={availability}
        sessionMinutes={sessionMinutes}
        onClose={() => setAvailabilityOpen(false)}
        onSave={async (next, minutes) => {
          await saveProfile({ availability: serializeAvailability(next), sessionMinutes: minutes });
          setAvailabilityOpen(false);
          notify('Disponibilités enregistrées.', 'success');
        }}
      />

      <SeriesScopeModal
        open={scopeAsk !== null}
        title={
          scopeAsk?.action === 'delete'
            ? 'Supprimer cet événement récurrent'
            : 'Modifier cet événement récurrent'
        }
        description={
          scopeAsk
            ? `${scopeAsk.event.title} — ${formatDayLong(scopeAsk.event.day)}. Que faut-il ${
                scopeAsk.action === 'delete' ? 'supprimer' : 'modifier'
              } ?`
            : ''
        }
        destructive={scopeAsk?.action === 'delete'}
        onClose={() => setScopeAsk(null)}
        onChoose={applyScope}
      />

      <ExamPrepModal
        open={examEvent !== null}
        brief={brief}
        chapters={source.chapters}
        cards={source.cards}
        logs={source.logs}
        events={events}
        availability={availability}
        sessionMinutes={sessionMinutes}
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
