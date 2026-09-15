import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuizSession } from '@/components/features/quiz/QuizSession';
import type { QuizQuestionInstance } from '@/core/quiz';

afterEach(cleanup);

it('cache le corrigé, demande une autoévaluation puis journalise le choix à la fin', () => {
  const question: QuizQuestionInstance = {
    id: 'q1', cardId: 'c1', subjectId: 's1', subjectName: 'Anatomie', chapterId: null,
    chapterName: null, format: 'recall', question: 'Quels muscles ?',
    options: ['Les quatre muscles du cours', 'À revoir'], correctIndex: 0,
    difficulty: 2, hint: '', masteryContext: '', examLikelihood: null,
  };
  const onAnswer = vi.fn();
  render(<QuizSession questions={[question]} index={0} onAnswer={onAnswer} />);
  expect(screen.queryByText('Les quatre muscles du cours')).toBeNull();
  expect(screen.queryByText('Voir mes résultats')).toBeNull();
  fireEvent.change(screen.getByLabelText('Ma réponse'), { target: { value: 'Mon rappel' } });
  fireEvent.click(screen.getByText('Comparer avec le cours'));
  expect(screen.getByText('Les quatre muscles du cours')).toBeTruthy();
  expect(onAnswer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^À revoir$/ }));
  fireEvent.click(screen.getByText('Voir mes résultats'));
  expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ selectedIndex: 1, correct: false, question }));
});
