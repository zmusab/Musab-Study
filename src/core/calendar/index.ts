import type {
  CalendarEvent,
  CalendarEventKind,
  Chapter,
  DayKey,
  Flashcard,
  ID,
  Subject,
} from '@/types';
import { addDays, dayKey, dayKeyFromISO, daysBetweenDayKeys, parseDayKey } from '@/lib/date';
import { chapterProgress, type ChapterProgress } from '@/core/progress';
import { EVALUATION_KIND_LABELS, isEvaluationKind } from '@/core/progress/exam';

/**
 * CALENDRIER — logique pure, sans React ni Dexie.
 *
 * Le calendrier ne possède aucune donnée en propre : il lit `calendarEvents`
 * (les événements réellement saisis) et `flashcards` (les échéances calculées
 * par la répétition espacée). Rien n'y est fabriqué — une journée sans
 * événement et sans carte due est une journée vide, et elle s'affiche vide.
 *
 * Les cartes dues ne deviennent JAMAIS des événements : elles sont agrégées
 * en une seule ligne « révision » par jour. Une carte = une pastille aurait
 * rendu le mois illisible dès la deuxième semaine.
 */

// ────────────────────────────── Genres d'événement ──────────────────────────────

export type EventFamily = 'evaluation' | 'session' | 'goal' | 'other';

export interface EventKindMeta {
  kind: CalendarEventKind;
  label: string;
  family: EventFamily;
  /** Jeton de thème — les évaluations tirent vers le rouge, le reste reste sobre. */
  colorVar: string;
  /** Poids d'affichage : ce qui passe devant quand la place manque. */
  rank: number;
}

export const EVENT_KINDS: readonly EventKindMeta[] = [
  { kind: 'final', label: 'Examen final', family: 'evaluation', colorVar: 'var(--mastery-0)', rank: 5 },
  { kind: 'exam', label: 'Examen', family: 'evaluation', colorVar: 'var(--mastery-0)', rank: 4 },
  { kind: 'midterm', label: 'Contrôle', family: 'evaluation', colorVar: 'var(--mastery-1)', rank: 3 },
  { kind: 'task', label: 'Devoir', family: 'goal', colorVar: 'var(--mastery-2)', rank: 2 },
  { kind: 'course', label: 'Séance d’étude', family: 'session', colorVar: 'var(--accent)', rank: 1 },
  { kind: 'review', label: 'Révision planifiée', family: 'session', colorVar: 'var(--accent)', rank: 1 },
];

const KIND_BY_ID = new Map(EVENT_KINDS.map((meta) => [meta.kind, meta]));

export function eventKindMeta(kind: CalendarEventKind): EventKindMeta {
  return (
    KIND_BY_ID.get(kind) ?? {
      kind,
      label: EVALUATION_KIND_LABELS[kind] ?? 'Événement',
      family: 'other',
      colorVar: 'var(--ink-faint)',
      rank: 0,
    }
  );
}

/** Une séance d'étude est un événement dont le genre appartient à la famille « session ». */
export function isStudySession(event: Pick<CalendarEvent, 'kind'>): boolean {
  return eventKindMeta(event.kind).family === 'session';
}

// ────────────────────────────── État d'une séance ──────────────────────────────

export type SessionState = 'planned' | 'started' | 'done' | 'missed';

/**
 * `missed` n'est jamais stocké : c'est une séance encore planifiée dont le
 * jour est passé. Le déduire évite une tâche de fond qui viendrait périmer
 * des lignes en base, et reste exact même si l'application n'a pas été
 * ouverte pendant une semaine.
 */
export function sessionState(event: CalendarEvent, now: Date = new Date()): SessionState {
  const status = event.status ?? (event.done ? 'done' : 'planned');
  if (status === 'done' || event.done) return 'done';
  if (status === 'started') return 'started';
  return event.day < dayKey(now) ? 'missed' : 'planned';
}

export const SESSION_STATE_LABELS: Record<SessionState, string> = {
  planned: 'Prévue',
  started: 'En cours',
  done: 'Terminée',
  missed: 'Manquée',
};

// ────────────────────────────── Grille du mois ──────────────────────────────

export interface CalendarDay {
  day: DayKey;
  inMonth: boolean;
  isToday: boolean;
}

/** Lundi de la semaine contenant `date` — la semaine française commence lundi. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(start, -((start.getDay() + 6) % 7));
}

export function weekOf(date: Date): DayKey[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => dayKey(addDays(monday, i)));
}

/**
 * Grille mensuelle complète : semaines entières du lundi au dimanche, débords
 * du mois précédent et suivant inclus, pour que la grille soit toujours
 * rectangulaire. Le nombre de semaines suit le mois (4, 5 ou 6) — on n'en
 * force jamais six, ce qui laisserait une ligne vide.
 */
export function monthMatrix(date: Date, today: Date = new Date()): CalendarDay[][] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const end = addDays(startOfWeek(last), 6);
  const todayKey = dayKey(today);
  const month = date.getMonth();

  const weeks: CalendarDay[][] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const current = addDays(cursor, i);
        return {
          day: dayKey(current),
          inMonth: current.getMonth() === month,
          isToday: dayKey(current) === todayKey,
        };
      }),
    );
  }
  return weeks;
}

// ────────────────────────────── Révisions dues ──────────────────────────────

export interface DueBucket {
  day: DayKey;
  cards: number;
  /** Cartes déjà en retard, repliées sur aujourd'hui. */
  overdue: number;
  subjects: { subjectId: ID; name: string; cards: number }[];
  cardIds: ID[];
}

/**
 * Cartes dues par jour, AGRÉGÉES.
 *
 * Le retard est ramené sur aujourd'hui : c'est aujourd'hui qu'il faut le
 * rattraper, et l'afficher au jour d'origine donnerait un calendrier
 * rétrospectivement rouge sans aucune action possible.
 *
 * Au-delà de l'horizon demandé, rien n'est projeté : la répétition espacée ne
 * connaît la prochaine échéance qu'après la révision suivante.
 */
export function dueByDay(
  cards: readonly Flashcard[],
  days: readonly DayKey[],
  subjects: readonly Subject[],
  now: Date = new Date(),
): Map<DayKey, DueBucket> {
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const today = dayKey(now);
  const wanted = new Set(days);
  const buckets = new Map<DayKey, DueBucket>();

  const bucketFor = (day: DayKey): DueBucket => {
    const existing = buckets.get(day);
    if (existing) return existing;
    const created: DueBucket = { day, cards: 0, overdue: 0, subjects: [], cardIds: [] };
    buckets.set(day, created);
    return created;
  };

  for (const card of cards) {
    const due = dayKeyFromISO(card.due);
    const isOverdue = due < today;
    const day = isOverdue ? today : due;
    if (!wanted.has(day)) continue;

    const bucket = bucketFor(day);
    bucket.cards += 1;
    if (isOverdue) bucket.overdue += 1;
    bucket.cardIds.push(card.id);
    const name = subjectName.get(card.subjectId) ?? 'Matière supprimée';
    const entry = bucket.subjects.find((subject) => subject.subjectId === card.subjectId);
    if (entry) entry.cards += 1;
    else bucket.subjects.push({ subjectId: card.subjectId, name, cards: 1 });
  }

  for (const bucket of buckets.values()) bucket.subjects.sort((a, b) => b.cards - a.cards);
  return buckets;
}

// ────────────────────────────── Agenda d'une journée ──────────────────────────────

export interface AgendaEvent {
  event: CalendarEvent;
  meta: EventKindMeta;
  state: SessionState;
  subjectName: string | null;
  chapterName: string | null;
}

export interface DayAgenda {
  day: DayKey;
  /** Évaluations d'abord : ce sont elles qui commandent la journée. */
  evaluations: AgendaEvent[];
  sessions: AgendaEvent[];
  others: AgendaEvent[];
  due: DueBucket | null;
  isEmpty: boolean;
}

export function buildAgenda(
  day: DayKey,
  events: readonly CalendarEvent[],
  due: Map<DayKey, DueBucket>,
  subjects: readonly Subject[],
  chapters: readonly Chapter[],
  now: Date = new Date(),
): DayAgenda {
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const chapterName = new Map(chapters.map((chapter) => [chapter.id, chapter.name]));

  const decorated = events
    .filter((event) => event.day === day)
    .map<AgendaEvent>((event) => ({
      event,
      meta: eventKindMeta(event.kind),
      state: sessionState(event, now),
      subjectName: event.subjectId ? (subjectName.get(event.subjectId) ?? null) : null,
      chapterName: event.chapterId ? (chapterName.get(event.chapterId) ?? null) : null,
    }))
    .sort(byTimeThenRank);

  const evaluations = decorated.filter((entry) => entry.meta.family === 'evaluation');
  const sessions = decorated.filter((entry) => entry.meta.family === 'session');
  const others = decorated.filter(
    (entry) => entry.meta.family !== 'evaluation' && entry.meta.family !== 'session',
  );
  const dueBucket = due.get(day) ?? null;

  return {
    day,
    evaluations,
    sessions,
    others,
    due: dueBucket,
    isEmpty: decorated.length === 0 && (dueBucket === null || dueBucket.cards === 0),
  };
}

/** Une heure de début range avant un événement sur la journée entière. */
function byTimeThenRank(a: AgendaEvent, b: AgendaEvent): number {
  if (a.event.startTime && b.event.startTime) return a.event.startTime.localeCompare(b.event.startTime);
  if (a.event.startTime) return -1;
  if (b.event.startTime) return 1;
  return b.meta.rank - a.meta.rank;
}

// ────────────────────────────── Plan de révision ──────────────────────────────

export interface PlannedSession {
  day: DayKey;
  chapterId: ID | null;
  title: string;
  /** Pourquoi cette séance existe — affiché avant d'accepter le plan. */
  reason: string;
  minutes: number;
  cardIds: ID[];
}

export interface StudyPlan {
  sessions: PlannedSession[];
  /** Jours réellement disponibles avant l'évaluation. */
  availableDays: number;
  /** Null quand le plan n'a pas pu être construit, avec la raison. */
  blocked: string | null;
}

export interface PlanOptions {
  minutesPerSession?: number;
  /** Plafond de séances proposées — mieux vaut un plan tenable qu'exhaustif. */
  maxSessions?: number;
}

const DEFAULT_MINUTES = 45;
const DEFAULT_MAX_SESSIONS = 10;

/**
 * Répartit des séances entre aujourd'hui et la veille d'une évaluation.
 *
 * Heuristique assumée, et rien d'autre : elle ne prétend pas prédire un
 * résultat. Trois règles simples, toutes fondées sur des mesures réelles :
 *
 *  1. les chapitres les plus FAIBLES reçoivent le plus de séances (poids =
 *     1 − maîtrise, un chapitre jamais révisé pesant au maximum) ;
 *  2. les séances sont RÉPARTIES sur les jours disponibles plutôt que
 *     massées, parce que c'est l'espacement qui fait tenir la mémoire ;
 *  3. la veille est réservée à une révision générale.
 *
 * Sans chapitre mesurable ou sans jour disponible, la fonction ne propose
 * rien et dit pourquoi — elle ne remplit pas le calendrier pour faire joli.
 */
export function planStudySessions(
  examDay: DayKey,
  subjectId: ID,
  subjectName: string,
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: Parameters<typeof chapterProgress>[3],
  now: Date = new Date(),
  options: PlanOptions = {},
): StudyPlan {
  const minutes = options.minutesPerSession ?? DEFAULT_MINUTES;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const today = dayKey(now);

  const daysUntil = daysBetweenDayKeys(today, examDay);
  if (daysUntil <= 0) {
    return { sessions: [], availableDays: 0, blocked: 'L’évaluation est aujourd’hui ou déjà passée.' };
  }

  // Aujourd'hui inclus, veille incluse : ce sont les jours où l'on peut encore
  // travailler. Le jour de l'examen n'en fait pas partie.
  const available: DayKey[] = [];
  for (let i = 0; i < daysUntil; i += 1) available.push(dayKey(addDays(now, i)));
  if (available.length === 0) {
    return { sessions: [], availableDays: 0, blocked: 'Aucun jour disponible avant l’évaluation.' };
  }

  const rows = chapterProgress(subjectId, chapters, cards, logs).filter((row) => row.cards > 0);
  if (rows.length === 0) {
    return {
      sessions: [],
      availableDays: available.length,
      blocked: 'Cette matière n’a aucune flashcard : il n’y a rien à répartir.',
    };
  }

  const cardsOf = (chapterId: ID | null) =>
    cards.filter((card) => card.subjectId === subjectId && card.chapterId === chapterId).map((card) => card.id);

  // Poids : la faiblesse mesurée, jamais une importance déclarée.
  const weighted = rows
    .map((row) => ({ row, weight: row.masteryPct === null ? 1 : Math.max(0.15, 1 - row.masteryPct / 100) }))
    .sort((a, b) => b.weight - a.weight);

  // Une séance de révision générale la veille, le reste réparti.
  const generalDay = available[available.length - 1]!;
  const workDays = available.length > 1 ? available.slice(0, -1) : available;
  const sessionCount = Math.min(workDays.length, maxSessions - 1, Math.max(2, weighted.length * 2));
  const chosenDays = spreadDays(workDays, sessionCount);

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const quota = weighted.map((entry) => ({
    ...entry,
    slots: Math.max(1, Math.round((entry.weight / totalWeight) * chosenDays.length)),
  }));

  // File d'attente : le chapitre le plus faible revient le plus souvent, mais
  // on alterne pour ne pas enchaîner cinq séances sur le même sujet.
  const queue: (typeof quota)[number][] = [];
  let remaining = quota.map((entry) => ({ entry, left: entry.slots }));
  while (queue.length < chosenDays.length && remaining.some((item) => item.left > 0)) {
    for (const item of remaining) {
      if (item.left <= 0 || queue.length >= chosenDays.length) continue;
      queue.push(item.entry);
      item.left -= 1;
    }
    remaining = remaining.filter((item) => item.left > 0);
  }

  const sessions: PlannedSession[] = chosenDays.map((day, index) => {
    const entry = queue[index % Math.max(1, queue.length)] ?? quota[0]!;
    const { row } = entry;
    return {
      day,
      chapterId: row.chapterId,
      title: `${subjectName} — ${row.name}`,
      reason:
        row.masteryPct === null
          ? 'Jamais révisé'
          : `Maîtrise ${row.masteryPct} %${row.successRate !== null ? ` · ${Math.round(row.successRate * 100)} % de réussite` : ''}`,
      minutes,
      cardIds: cardsOf(row.chapterId),
    };
  });

  if (available.length > 1) {
    sessions.push({
      day: generalDay,
      chapterId: null,
      title: `${subjectName} — révision générale`,
      reason: 'Veille de l’évaluation : relecture de l’ensemble',
      minutes,
      cardIds: cards.filter((card) => card.subjectId === subjectId).map((card) => card.id),
    });
  }

  return { sessions, availableDays: available.length, blocked: null };
}

/** Choisit `count` jours répartis aussi régulièrement que possible. */
export function spreadDays(days: readonly DayKey[], count: number): DayKey[] {
  if (count <= 0 || days.length === 0) return [];
  if (count >= days.length) return [...days];
  const step = days.length / count;
  const chosen: DayKey[] = [];
  for (let i = 0; i < count; i += 1) chosen.push(days[Math.floor(i * step)]!);
  return [...new Set(chosen)];
}

// ────────────────────────────── Fiche d'examen ──────────────────────────────

export interface ExamBrief {
  event: CalendarEvent;
  label: string;
  subjectName: string | null;
  daysUntil: number;
  dueCards: number;
  weakChapters: ChapterProgress[];
  plannedSessions: number;
  completedSessions: number;
}

/**
 * Tout ce qu'il faut savoir d'une évaluation, uniquement à partir de données
 * réelles : sa date, la matière, les cartes dues, les chapitres faibles et
 * l'avancement du plan s'il en existe un.
 */
export function examBrief(
  event: CalendarEvent,
  subjects: readonly Subject[],
  chapters: readonly Chapter[],
  cards: readonly Flashcard[],
  logs: Parameters<typeof chapterProgress>[3],
  events: readonly CalendarEvent[],
  now: Date = new Date(),
): ExamBrief {
  const subject = subjects.find((entry) => entry.id === event.subjectId) ?? null;
  const nowIso = now.toISOString();
  const subjectCards = event.subjectId
    ? cards.filter((card) => card.subjectId === event.subjectId)
    : [];
  const rows = event.subjectId ? chapterProgress(event.subjectId, chapters, cards, logs) : [];
  const plan = events.filter((entry) => entry.planForEventId === event.id);

  return {
    event,
    label: eventKindMeta(event.kind).label,
    subjectName: subject?.name ?? null,
    daysUntil: daysBetweenDayKeys(dayKey(now), event.day),
    dueCards: subjectCards.filter((card) => card.due <= nowIso).length,
    weakChapters: rows.filter((row) => row.masteryPct === null || row.masteryPct < 70).slice(0, 5),
    plannedSessions: plan.length,
    completedSessions: plan.filter((entry) => sessionState(entry, now) === 'done').length,
  };
}

/** Évaluations à venir, les plus proches d'abord — lues, jamais déduites. */
export function upcomingEvents(
  events: readonly CalendarEvent[],
  now: Date = new Date(),
  horizonDays = 120,
): CalendarEvent[] {
  const today = dayKey(now);
  return events
    .filter((event) => isEvaluationKind(event.kind) && !event.done && event.day >= today)
    .filter((event) => daysBetweenDayKeys(today, event.day) <= horizonDays)
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ────────────────────────────── Formatage ──────────────────────────────

const MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const DAY_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const DAY_SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const formatMonthYear = (date: Date) => capitalize(MONTH_YEAR.format(date));
export const formatDayLong = (day: DayKey) => capitalize(DAY_LONG.format(parseDayKey(day)));
export const formatDayShort = (day: DayKey) => capitalize(DAY_SHORT.format(parseDayKey(day)));

/** « 1 h 30 » à partir de deux heures « HH:MM » — null si l'une manque. */
export function durationLabel(startTime: string | null, endTime: string | null): string | null {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if ([sh, sm, eh, em].some((value) => value === undefined || Number.isNaN(value))) return null;
  const minutes = eh! * 60 + em! - (sh! * 60 + sm!);
  if (minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** Ajoute des minutes à une heure « HH:MM ». */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}
