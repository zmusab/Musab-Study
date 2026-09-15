import { findLocalAnswer, type LocalAnswer } from './localAnswer';
import { normalizeText, significantWords } from '@/core/text';
import { answerPassageQuestion } from './passageRelations';
import { correctCourseQuery } from './querySpelling';
import type { ScoredChunk, ContextLookup } from '@/services/rag/retrieval';

/** Local conversation policy. No network, generated medical facts or model dependency. */
export function resolveStudyQuestion(question: string, previousTopic?: string): string {
  question = question.replace(/\b(nerfs?)d\s+e\b/gi, '$1 de');
  const normalized = normalizeText(question).trim();
  const followUp = /^(?:et\s+)?(?:son role|son trajet|ses branches|a quoi ca sert|ou passe.t.il|explique(?:.moi)? (?:encore|plus simplement)|plus simplement|je (?:ne )?comprends (?:toujours )?pas)[\s?.!]*$/;
  return previousTopic && followUp.test(normalized)
    ? `${question} : ${previousTopic}`
    : question;
}

export function studyTopic(question: string): string {
  return [...significantWords(question, true)].join(' ');
}

export function answerWithStudyTutor(
  question: string,
  chunks: ScoredChunk[],
  lookup: ContextLookup,
): LocalAnswer | null {
  question = correctCourseQuery(resolveStudyQuestion(question), chunks.map(({ chunk }) => chunk.text));
  const normalized = normalizeText(question);
  const passageAnswer = answerPassageQuestion(question, chunks, lookup);
  if (passageAnswer) return passageAnswer;
  const corpus = normalizeText(chunks.map(({ chunk }) => chunk.text).join('\n'));
  // These are different nerves, not interchangeable spellings. Ask before substituting.
  if (/\boptiques?\b/.test(normalized) && !/\boptiques?\b/.test(corpus) && /\bophtalmiques?\b/.test(corpus)) {
    return {
      text: 'Tu demandes le **nerf optique**, mais les passages retrouvés parlent du **nerf ophtalmique**. Les deux noms ne sont pas interchangeables.\n\nVeux-tu étudier le nerf ophtalmique de ton document ? Écris « explique le nerf ophtalmique ». Pour le nerf optique, ajoute le passage correspondant : je ne vais pas te répondre sur une autre structure.',
      citations: [],
    };
  }
  const answer = findLocalAnswer(resolveStudyQuestion(question), chunks, lookup);
  if (!answer) return null;
  const explanatory = /comprend|comprendre|expliqu|simplement/.test(normalized);
  if (!explanatory) return answer;

  const content = normalizeText(answer.text);
  const guide: string[] = [];
  if (/chemine|traverse|entre dans|passe par|sort par/.test(content)) {
    guide.push('**Le trajet : où passe-t-il ?** Lis les lieux dans l’ordre indiqué. « Traverse » ou « entre dans » décrit un passage.');
  }
  if (/rapport avec|en rapport|voisin/.test(content)) {
    guide.push('**Les rapports : qu’y a-t-il à côté ?** « En rapport avec » décrit un voisinage ; cela ne signifie pas que le nerf traverse cette structure.');
  }
  if (/branches|se divise/.test(content)) {
    guide.push('**Les branches : en quoi se divise-t-il ?** Représente le nerf comme un tronc, puis place chaque branche citée à son point de division.');
  }
  if (/innerve|innervation/.test(content)) {
    guide.push('**L’innervation : quel territoire dessert-il ?** Distingue le territoire indiqué des endroits par lesquels le nerf passe.');
  }

  // A teaching scaffold surrounds extracted content; facts remain attributable to the course.
  return {
    ...answer,
    text: answer.text +
      '\n\n### Pour comprendre et retenir\n' +
      (guide.length ? guide.join('\n\n') : 'Cache le passage et reformule son idée principale avec tes mots.') + '\n\n' +
      '**À toi : quel point reste flou : le rôle, le trajet ou les branches ?**',
  };
}
