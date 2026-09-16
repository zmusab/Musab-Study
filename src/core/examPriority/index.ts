import type { CalendarEvent, KnowledgeConcept, KnowledgeEvidence, KnowledgeFact, LearnerFactState } from '@/types';

export type ExamPriorityLevel = 'very-high' | 'high' | 'medium' | 'low';

export interface ExamPriority {
  factId: string;
  level: ExamPriorityLevel;
  /** Importance du contenu, indépendante de ce que l'étudiant sait déjà. */
  contentImportance: number;
  /** Urgence pour cet étudiant maintenant. */
  learnerUrgency: number;
  reasons: string[];
}

const listPredicates = new Set(['composition', 'classification']);
const relationPredicates = new Set(['function', 'location', 'possession']);

/**
 * Classe une priorité sans inventer de pourcentage de chance d'examen.
 * Les raisons affichées correspondent uniquement aux signaux effectivement
 * présents dans l'application : structure du fait, redondance de la source,
 * échéance proche et maîtrise mesurée.
 */
export function rankExamPriority(
  facts: readonly KnowledgeFact[],
  states: readonly LearnerFactState[],
  evidence: readonly KnowledgeEvidence[],
  events: readonly CalendarEvent[],
  now: Date = new Date(),
): ExamPriority[] {
  const stateByFact = new Map(states.map((state) => [state.factId, state]));
  const activeEvidenceCount = new Map<string, number>();
  for (const item of evidence) if (item.active) activeEvidenceCount.set(item.factId, (activeEvidenceCount.get(item.factId) ?? 0) + 1);
  const daysToExamBySubject = new Map<string, number>();
  for (const event of events) {
    if (!event.subjectId || event.done || !['exam', 'midterm', 'final'].includes(event.kind)) continue;
    const days = Math.ceil((new Date(`${event.day}T23:59:59`).getTime() - now.getTime()) / 86_400_000);
    if (days < 0) continue;
    const previous = daysToExamBySubject.get(event.subjectId);
    if (previous === undefined || days < previous) daysToExamBySubject.set(event.subjectId, days);
  }

  return facts
    .filter((fact) => fact.status === 'verified')
    .map((fact) => {
      const reasons: string[] = [];
      let contentImportance = fact.importance * 2;
      if (listPredicates.has(fact.predicate)) {
        contentImportance += 2;
        reasons.push('liste ou classification à retenir');
      } else if (relationPredicates.has(fact.predicate)) {
        contentImportance += 1;
        reasons.push('relation anatomique ou fonctionnelle');
      }
      if ((activeEvidenceCount.get(fact.id) ?? 0) > 1) {
        contentImportance += 1;
        reasons.push('présent dans plusieurs passages du cours');
      }
      if (fact.importance >= 3) reasons.push('marqué important dans le contenu');

      let learnerUrgency = 0;
      const state = stateByFact.get(fact.id);
      if (!state || state.status === 'unseen') {
        learnerUrgency += 2;
        reasons.push('encore non travaillé');
      } else if (state.status === 'fragile') {
        learnerUrgency += 4;
        reasons.push('maîtrise fragile après tes réponses');
      } else if (state.status === 'learning') {
        learnerUrgency += 2;
        reasons.push('encore en apprentissage');
      }
      if (state?.nextReviewAt && new Date(state.nextReviewAt) <= now) {
        learnerUrgency += 2;
        reasons.push('révision factuelle due');
      }
      const days = daysToExamBySubject.get(fact.subjectId);
      if (days !== undefined && days <= 7) {
        learnerUrgency += 3;
        reasons.push(`évaluation dans ${days === 0 ? 'moins d’un jour' : `${days} jour${days > 1 ? 's' : ''}`}`);
      } else if (days !== undefined && days <= 21) {
        learnerUrgency += 1;
        reasons.push('évaluation prochaine');
      }

      const total = contentImportance + learnerUrgency;
      const level: ExamPriorityLevel = total >= 10 ? 'very-high' : total >= 7 ? 'high' : total >= 4 ? 'medium' : 'low';
      return { factId: fact.id, level, contentImportance, learnerUrgency, reasons };
    })
    .sort((a, b) => (b.contentImportance + b.learnerUrgency) - (a.contentImportance + a.learnerUrgency));
}

export interface PriorityFactView extends ExamPriority {
  fact: KnowledgeFact;
  concept: KnowledgeConcept | null;
}

export function priorityFactViews(
  priorities: readonly ExamPriority[],
  facts: readonly KnowledgeFact[],
  concepts: readonly KnowledgeConcept[],
): PriorityFactView[] {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
  return priorities.flatMap((priority) => {
    const fact = factById.get(priority.factId);
    return fact ? [{ ...priority, fact, concept: conceptById.get(fact.conceptId) ?? null }] : [];
  });
}
