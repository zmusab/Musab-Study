import { useMemo, useState } from 'react';
import { Button, Card, Select, Swatch } from '@/components/ui';
import type { QuizDifficulty, QuizFormat, QuizScope } from '@/core/quiz';
import type { Evaluation } from '@/core/progress/exam';
import type { Chapter, ID, Subject } from '@/types';

/**
 * CHOISIR CE QUE JE VEUX TESTER — l'écran d'entrée du Quiz.
 *
 * Chaque option affiche un compte RÉEL (cartes, points faibles mesurés,
 * évaluations enregistrées) pour qu'on sache, avant de lancer quoi que ce
 * soit, si le choix a une chance de produire un quiz. Une option sans
 * donnée n'est pas cachée — elle est visible mais annoncée vide, comme
 * partout ailleurs dans l'application.
 */

type ScopeId = 'subject' | 'chapter' | 'subjects' | 'weak' | 'due' | 'exam';

const SCOPE_META: { id: ScopeId; label: string; hint: string }[] = [
  { id: 'subject', label: 'Une matière', hint: 'Toutes les cartes d’une matière.' },
  { id: 'chapter', label: 'Un chapitre', hint: 'Un seul chapitre, en détail.' },
  { id: 'subjects', label: 'Plusieurs matières', hint: 'Mélange plusieurs matières dans le même quiz.' },
  { id: 'weak', label: 'Mes points faibles', hint: 'Les chapitres où ton taux de réussite mesuré est le plus bas.' },
  { id: 'due', label: 'Mes cartes à revoir', hint: 'Ce que la répétition espacée programme aujourd’hui.' },
  { id: 'exam', label: 'Avant un examen', hint: 'La matière d’une évaluation à venir, chapitres faibles en tête.' },
];

const COUNT_OPTIONS = [5, 10, 15, 20];
const DIFFICULTY_OPTIONS: { value: QuizDifficulty; label: string }[] = [
  { value: 'mixed', label: 'Tous niveaux' },
  { value: 'easy', label: 'Facile' },
  { value: 'medium', label: 'Moyen' },
  { value: 'hard', label: 'Difficile' },
];
const FORMAT_OPTIONS: { value: QuizFormat; label: string }[] = [
  { value: 'qcm', label: 'QCM' },
  { value: 'vf', label: 'Vrai ou faux' },
  { value: 'mixed', label: 'QCM + Vrai/Faux' },
];

export function QuizSetup({
  subjects,
  chapters,
  cardCountBySubject,
  weakCardCount,
  dueCardCount,
  examEvaluations,
  onStart,
}: {
  subjects: Subject[];
  chapters: Chapter[];
  cardCountBySubject: Map<ID, number>;
  weakCardCount: number;
  dueCardCount: number;
  /** Une entrée par matière ayant au moins une évaluation à venir. */
  examEvaluations: { subjectId: ID; subjectName: string; evaluation: Evaluation }[];
  onStart: (scope: QuizScope, count: number, difficulty: QuizDifficulty, format: QuizFormat) => void;
}) {
  const [scopeId, setScopeId] = useState<ScopeId>('subject');
  const [subjectId, setSubjectId] = useState<ID | null>(subjects[0]?.id ?? null);
  const [chapterId, setChapterId] = useState<ID | null>(null);
  const [subjectIds, setSubjectIds] = useState<ID[]>([]);
  const [examSubjectId, setExamSubjectId] = useState<ID | null>(examEvaluations[0]?.subjectId ?? null);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('mixed');
  const [format, setFormat] = useState<QuizFormat>('qcm');

  const subjectChapters = useMemo(
    () => chapters.filter((chapter) => chapter.subjectId === subjectId),
    [chapters, subjectId],
  );

  const scope = useMemo<QuizScope | null>(() => {
    switch (scopeId) {
      case 'subject':
        return subjectId ? { kind: 'subject', subjectId } : null;
      case 'chapter':
        return subjectId ? { kind: 'chapter', subjectId, chapterId } : null;
      case 'subjects':
        return subjectIds.length > 0 ? { kind: 'subjects', subjectIds } : null;
      case 'weak':
        return { kind: 'weak' };
      case 'due':
        return { kind: 'due' };
      case 'exam':
        return examSubjectId ? { kind: 'exam', subjectId: examSubjectId } : null;
      default:
        return null;
    }
  }, [scopeId, subjectId, chapterId, subjectIds, examSubjectId]);

  const toggleSubject = (id: ID) =>
    setSubjectIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  return (
    <div className="flex flex-col gap-6" data-quiz-setup>
      <section>
        <h2 className="mb-3 text-[1.05rem]">Que veux-tu tester ?</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SCOPE_META.map((meta) => {
            const available =
              meta.id === 'weak'
                ? weakCardCount
                : meta.id === 'due'
                  ? dueCardCount
                  : meta.id === 'exam'
                    ? examEvaluations.length
                    : null;
            const active = scopeId === meta.id;
            return (
              <button
                key={meta.id}
                type="button"
                onClick={() => setScopeId(meta.id)}
                aria-pressed={active}
                data-quiz-scope={meta.id}
                data-touch-target
                className={
                  'rounded-[var(--radius-card)] border p-3.5 text-left transition-colors ' +
                  (active
                    ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
                    : 'border-[var(--line)] hover:bg-[var(--surface-2)]')
                }
              >
                <p className="text-[0.95rem] font-medium">{meta.label}</p>
                <p className="mt-0.5 text-[0.78rem] leading-snug text-[var(--ink-faint)]">{meta.hint}</p>
                {available !== null && (
                  <p
                    className="mt-1.5 text-[0.78rem] font-medium"
                    style={{ color: available > 0 ? 'var(--accent)' : 'var(--ink-faint)' }}
                  >
                    {available > 0
                      ? meta.id === 'exam'
                        ? `${available} évaluation${available > 1 ? 's' : ''} à venir`
                        : `${available} carte${available > 1 ? 's' : ''} disponible${available > 1 ? 's' : ''}`
                      : 'Rien pour l’instant'}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Précisions propres à chaque type ── */}
      {(scopeId === 'subject' || scopeId === 'chapter') && (
        <section className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Matière"
            value={subjectId ?? ''}
            onChange={(event) => {
              setSubjectId(event.target.value || null);
              setChapterId(null);
            }}
          >
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name} — {cardCountBySubject.get(subject.id) ?? 0} carte
                {(cardCountBySubject.get(subject.id) ?? 0) > 1 ? 's' : ''}
              </option>
            ))}
          </Select>
          {scopeId === 'chapter' && (
            <Select
              label="Chapitre"
              value={chapterId ?? ''}
              onChange={(event) => setChapterId(event.target.value || null)}
            >
              <option value="">Toute la matière</option>
              {subjectChapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.name}
                </option>
              ))}
            </Select>
          )}
        </section>
      )}

      {scopeId === 'subjects' && (
        <section>
          <p className="mb-2 text-[0.82rem] font-medium text-[var(--ink-soft)]">Matières incluses</p>
          <div className="flex flex-wrap gap-2" data-quiz-subjects-picker>
            {subjects.map((subject) => {
              const active = subjectIds.includes(subject.id);
              return (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => toggleSubject(subject.id)}
                  aria-pressed={active}
                  data-touch-target
                  className={
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.84rem] transition-colors ' +
                    (active
                      ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
                      : 'border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--surface-2)]')
                  }
                >
                  <Swatch color={subject.color} size={9} />
                  {subject.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {scopeId === 'exam' && (
        <section>
          {examEvaluations.length === 0 ? (
            <p className="text-[0.85rem] text-[var(--ink-faint)]">
              Aucune évaluation enregistrée au calendrier — ajoutes-en une pour utiliser ce mode.
            </p>
          ) : (
            <Select
              label="Évaluation"
              value={examSubjectId ?? ''}
              onChange={(event) => setExamSubjectId(event.target.value || null)}
            >
              {examEvaluations.map((entry) => (
                <option key={entry.subjectId} value={entry.subjectId}>
                  {entry.subjectName} — {entry.evaluation.label} dans {entry.evaluation.daysUntil} j
                </option>
              ))}
            </Select>
          )}
        </section>
      )}

      {/* ── Nombre de questions, difficulté et format ── */}
      <section className="grid gap-4 sm:grid-cols-3">
        <Select label="Nombre de questions" value={String(count)} onChange={(event) => setCount(Number(event.target.value))}>
          {COUNT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} questions
            </option>
          ))}
        </Select>
        <Select
          label="Difficulté"
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value as QuizDifficulty)}
        >
          {DIFFICULTY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          label="Format"
          value={format}
          onChange={(event) => setFormat(event.target.value as QuizFormat)}
          data-quiz-format
        >
          {FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </section>

      <Card className="flex flex-wrap items-center justify-between gap-3 border-[var(--accent)]/30">
        <p className="text-[0.85rem] leading-relaxed text-[var(--ink-soft)]">
          {format === 'vf'
            ? 'Chaque affirmation associe une question réelle de tes flashcards à une réponse réelle — la sienne, ou celle d’une autre carte.'
            : 'Les questions viennent de tes flashcards réelles : la bonne réponse et les trois autres sont des réponses existantes, jamais inventées.'}
        </p>
        <Button
          size="lg"
          disabled={scope === null}
          onClick={() => scope && onStart(scope, count, difficulty, format)}
          data-quiz-start
        >
          Commencer
        </Button>
      </Card>
    </div>
  );
}
