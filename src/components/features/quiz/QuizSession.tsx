import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button, Card, Chip } from '@/components/ui';
import { springSoft } from '@/components/motion/transitions';
import type { QuizAnswerRecord, QuizQuestionInstance } from '@/core/quiz';

const DIFFICULTY_LABEL: Record<1 | 2 | 3, string> = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile' };

/**
 * DÉROULÉ D'UNE QUESTION — question → réponse → correction → suivante.
 *
 * Une fois une option choisie, elle se fige : les boutons ne répondent plus
 * au clic, la bonne réponse se colore en vert et — si l'option choisie était
 * fausse — celle-ci se colore en rouge. C'est la seule mise en évidence dont
 * on a besoin : pas d'icône supplémentaire, la couleur suffit et elle est
 * cohérente avec le code couleur du reste de l'application.
 */
export function QuizSession({
  questions,
  index,
  onAnswer,
}: {
  questions: QuizQuestionInstance[];
  index: number;
  onAnswer: (record: QuizAnswerRecord) => void;
}) {
  const reduced = useReducedMotion();
  const [selected, setSelected] = useState<number | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());

  const question = questions[index]!;
  const total = questions.length;
  const revealed = selected !== null;

  const choose = (optionIndex: number) => {
    if (revealed) return;
    setSelected(optionIndex);
  };

  const next = () => {
    if (selected === null) return;
    onAnswer({
      question,
      selectedIndex: selected,
      correct: selected === question.correctIndex,
      elapsedMs: Date.now() - startedAt,
    });
    setSelected(null);
    setHintShown(false);
    setStartedAt(Date.now());
  };

  return (
    <div data-quiz-session>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[0.8rem] text-[var(--ink-faint)]" data-quiz-progress>
            Question {index + 1}/{total}
          </p>
          <div className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${((index + (revealed ? 1 : 0)) / total) * 100}%`, transition: 'width 400ms ease' }}
            />
          </div>
        </div>
        <Chip>{question.subjectName}</Chip>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={question.id}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
          transition={springSoft}
        >
          <Card className="min-h-56" data-quiz-question-format={question.format}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              {question.chapterName && (
                <p className="text-[0.78rem] text-[var(--ink-faint)]">{question.chapterName}</p>
              )}
              <p className="text-[0.78rem] text-[var(--ink-faint)]">{DIFFICULTY_LABEL[question.difficulty]}</p>
            </div>
            <p className="mt-1.5 text-[1.08rem] font-medium leading-relaxed">{question.question}</p>

            <div className="mt-4 flex flex-col gap-2" data-quiz-options>
              {question.options.map((option, optionIndex) => {
                const isCorrect = optionIndex === question.correctIndex;
                const isSelected = optionIndex === selected;
                const tone = !revealed
                  ? 'border-[var(--line)] hover:bg-[var(--surface-2)]'
                  : isCorrect
                    ? 'border-[var(--success)] bg-[var(--success-tint)]'
                    : isSelected
                      ? 'border-[var(--danger)] bg-[var(--danger-tint)]'
                      : 'border-[var(--line)] opacity-60';
                return (
                  <button
                    key={optionIndex}
                    type="button"
                    onClick={() => choose(optionIndex)}
                    disabled={revealed}
                    data-quiz-option
                    data-quiz-option-correct={revealed && isCorrect ? '' : undefined}
                    data-quiz-option-selected={isSelected ? '' : undefined}
                    data-touch-target
                    className={`min-h-11 rounded-[var(--radius-control)] border px-4 py-2.5 text-left text-[0.92rem] transition-colors ${tone}`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>

            {!revealed && question.hint && (
              <div className="mt-3">
                {hintShown ? (
                  <p className="text-[0.8rem] leading-relaxed text-[var(--ink-faint)]" data-quiz-hint>
                    {question.hint}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setHintShown(true)}
                    data-quiz-hint-toggle
                    className="text-[0.8rem] font-medium text-[var(--accent)] hover:underline"
                  >
                    Afficher un indice
                  </button>
                )}
              </div>
            )}

            <AnimatePresence>
              {revealed && (
                <motion.div
                  initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={springSoft}
                  className="overflow-hidden"
                >
                  <div className="mt-4 border-t border-[var(--line)] pt-3" data-quiz-explanation>
                    <p
                      className="text-[0.88rem] font-medium"
                      style={{ color: selected === question.correctIndex ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {selected === question.correctIndex ? 'Bonne réponse' : 'Mauvaise réponse'}
                    </p>
                    <p className="mt-1 text-[0.82rem] leading-relaxed text-[var(--ink-faint)]">
                      {question.masteryContext}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>
      </AnimatePresence>

      {revealed && (
        <Button className="mt-4" block onClick={next} data-quiz-next>
          {index + 1 === total ? 'Voir mes résultats' : 'Question suivante'}
        </Button>
      )}
    </div>
  );
}
