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

const cleanLine = (line: string): string => line
  .replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')
  .replace(/[%()]?[❶-❿①-⑩ⓐ-ⓙ][%()]?/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Turn a cited course extract into a readable lesson without adding facts. */
function guidedExplanation(text: string): string {
  const title = text.split('\n').map(cleanLine).find((line) => /^\*\*.+\*\*$/.test(line));
  const groups = new Map<string, string[]>();
  let active = 'À connaître';
  for (const raw of text.split('\n')) {
    const line = cleanLine(raw).replace(/^\*\*|\*\*$/g, '');
    if (!line || (title && line === title.replace(/^\*\*|\*\*$/g, ''))) continue;
    const normalized = normalizeText(line);
    if (/se divise|branches? (?:terminale|collaterale)|donne \d+ branches?/.test(normalized)) active = 'Branches';
    else if (/rapport avec|en rapport/.test(normalized)) active = 'Trajet';
    else if (/chemine|entre dans|passe par|sort (?:du|de|par)|traverse/.test(normalized)) active = 'Trajet';
    else if (/innerve|innervation|sensitif|moteur/.test(normalized)) active = 'Rôle';
    const bucket = groups.get(active) ?? [];
    if (!bucket.includes(line)) bucket.push(line);
    groups.set(active, bucket);
    // Items following an announcing line belong to that announced list.
    if (/rapport avec|en rapport/.test(normalized)) active = 'Rapports anatomiques';
    if (/se divise|branches? (?:terminale|collaterale)|donne \d+ branches?/.test(normalized)) active = 'Branches';
  }
  if (groups.size < 2) return text;
  const order = ['Trajet', 'Rapports anatomiques', 'Branches', 'Rôle', 'À connaître'];
  const sections = order.flatMap((heading) => {
    const lines = groups.get(heading);
    return lines?.length ? [`### ${heading}`, ...lines.map((line) => `- ${line}`)] : [];
  });
  const present = order.filter((heading) => groups.has(heading));
  const intro = present.length > 1
    ? `Lis ce passage en ${present.length} blocs : ${present.map((part) => part.toLowerCase()).join(', ')}.`
    : '';
  return [title ?? '', intro, ...sections].filter(Boolean).join('\n\n');
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

  return {
    ...answer,
    text: guidedExplanation(answer.text),
  };
}
