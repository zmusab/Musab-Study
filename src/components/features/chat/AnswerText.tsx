import { Fragment, type ReactNode } from 'react';

/**
 * Mise en forme des réponses de l'assistant.
 *
 * Les modèles répondent naturellement en Markdown léger : des titres, des
 * listes, des termes en gras. Affiché tel quel — c'était le cas jusqu'ici —
 * cela donne un mur de texte parsemé de `##` et de `**`, illisible pour
 * réviser. Ce rendu couvre exactement ce que les modèles produisent en
 * pratique, sans dépendance ni analyseur complet : titres, listes à puces,
 * listes numérotées, gras.
 *
 * Rien n'est INTERPRÉTÉ au-delà de la forme : le texte affiché reste
 * exactement celui qui a été vérifié (`verifyCourseAnswer`), à la
 * présentation près.
 */

/** `**gras**` → <strong>. Le reste du segment est rendu tel quel. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-${index}`} className="font-semibold text-[var(--ink)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={`${keyPrefix}-${index}`}>{part}</Fragment>;
  });
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[] };

/** Découpe le texte en blocs — exporté pour être testé sans rendu React. */
export function parseAnswerBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushParagraph();
      continue;
    }

    const heading = /^#{1,4}\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: heading[1]! });
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'bullets') last.items.push(bullet[1]!);
      else blocks.push({ kind: 'bullets', items: [bullet[1]!] });
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'numbers') last.items.push(numbered[1]!);
      else blocks.push({ kind: 'numbers', items: [numbered[1]!] });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

export function AnswerText({ text }: { text: string }) {
  const blocks = parseAnswerBlocks(text);

  return (
    <div className="flex flex-col gap-2.5 text-[0.92rem] leading-relaxed">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h3 key={index} className="mt-1 text-[0.95rem] font-semibold">
              {inline(block.text, `h-${index}`)}
            </h3>
          );
        }
        if (block.kind === 'bullets') {
          return (
            <ul key={index} className="flex list-disc flex-col gap-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item, `b-${index}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'numbers') {
          return (
            <ol key={index} className="flex list-decimal flex-col gap-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item, `n-${index}-${itemIndex}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {inline(block.text, `p-${index}`)}
          </p>
        );
      })}
    </div>
  );
}
