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

/**
 * Deux familles BLOQUANTES, distinctes à l'affichage mais traitées pareil par
 * le planificateur :
 *  - `'fixed'` : un cours universitaire, imposé par la faculté ;
 *  - `'personal'` : « Temps pour soi » — sport, repas, repos, rendez-vous.
 *
 * Toutes deux occupent le calendrier et bloquent les créneaux, et aucune n'est
 * du travail personnel : rien de ce qui mesure l'étude ne les compte.
 */
export type EventFamily = 'evaluation' | 'session' | 'fixed' | 'personal' | 'goal' | 'other';

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
  // Turquoise, comme la section « Cours » de la navigation : un cours
  // universitaire ne doit jamais se confondre d'un coup d'œil avec une séance
  // d'étude (violet), une évaluation (rouge) ou un devoir (jaune).
  { kind: 'lecture', label: 'Cours', family: 'fixed', colorVar: 'var(--nav-turquoise)', rank: 2 },
  // Orange : ni le turquoise des cours, ni le violet des séances, ni le rouge
  // des évaluations. Du temps qui m'appartient se repère au premier coup d'œil.
  { kind: 'personal', label: 'Temps pour soi', family: 'personal', colorVar: 'var(--nav-orange)', rank: 2 },
  { kind: 'task', label: 'Devoir', family: 'goal', colorVar: 'var(--mastery-2)', rank: 2 },
  // `'course'` est le nom HISTORIQUE de la séance d'étude — voir le
  // commentaire de `CalendarEventKind` dans `types/`.
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

/**
 * Un cours universitaire — un bloc fixe. Il bloque le calendrier et s'affiche
 * dans l'emploi du temps ; il n'est jamais compté comme du temps d'étude, ne
 * se « commence » ni ne se « termine », et n'écrit rien dans `reviewLogs`.
 */
export function isLecture(event: Pick<CalendarEvent, 'kind'>): boolean {
  return eventKindMeta(event.kind).family === 'fixed';
}

/**
 * Un BLOC IMPOSÉ : cours ou temps pour soi. C'est la notion que manipule le
 * planificateur — il n'a pas à savoir si l'heure est prise par un amphi ou par
 * une séance de sport, seulement qu'elle est prise.
 */
export function isFixedBlock(event: Pick<CalendarEvent, 'kind'>): boolean {
  const family = eventKindMeta(event.kind).family;
  return family === 'fixed' || family === 'personal';
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
  /**
   * Blocs imposés — cours et temps pour soi. Ils occupent la journée sans
   * jamais être du travail personnel.
   */
  fixed: AgendaEvent[];
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
  const fixed = decorated.filter((entry) => isFixedBlock(entry.event));
  const sessions = decorated.filter((entry) => entry.meta.family === 'session');
  const others = decorated.filter(
    (entry) => entry.meta.family === 'goal' || entry.meta.family === 'other',
  );
  const dueBucket = due.get(day) ?? null;

  return {
    day,
    evaluations,
    fixed,
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

/**
 * Le plan de révision vit désormais dans `plans.ts` (le QUOI) et `planner.ts`
 * (le QUAND) : la répartition tient compte de la charge réelle des journées et
 * des plages horaires déclarées disponibles, ce qui n'aurait pas sa place dans
 * un module de mise en forme du calendrier. Réexporté ici pour ne casser aucun
 * import existant.
 */
export { planStudySessions, planWeek, type PlannedSession, type StudyPlan, type WeekPlan, type PlanOptions } from './plans';

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

const RANGE_DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const RANGE_DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric' });

/**
 * INTITULÉ D'UNE SEMAINE — « 7 – 13 septembre 2026 ».
 *
 * L'en-tête du calendrier affichait le mois et l'année quelle que soit la vue.
 * En vue Semaine, « Septembre 2026 » ne dit pas DE QUELLE semaine il s'agit :
 * on avance de sept jours et le titre ne bouge pas. On ne sait donc plus où
 * l'on est, ce qui est précisément le reproche fait à cette page.
 *
 * Le mois n'est répété sur la première date que si la semaine change de mois
 * (« 28 septembre – 4 octobre 2026 »), et l'année seulement si elle change
 * aussi. Rien n'est deviné : les deux bornes viennent des jours réellement
 * affichés.
 */
export function formatWeekRange(days: readonly DayKey[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return '';
  const from = parseDayKey(first);
  const to = parseDayKey(last);
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  const sameYear = from.getFullYear() === to.getFullYear();

  const left = sameMonth ? RANGE_DAY.format(from) : RANGE_DAY_MONTH.format(from);
  const leftWithYear = sameYear ? left : `${left} ${from.getFullYear()}`;
  return capitalize(`${leftWithYear} – ${RANGE_DAY_MONTH.format(to)} ${to.getFullYear()}`);
}

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
