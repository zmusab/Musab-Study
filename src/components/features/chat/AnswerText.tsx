import { Fragment, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

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

/**
 * RÉVÉLATION MOT À MOT.
 *
 * La réponse tombait d'un bloc. Une cascade par BLOC existait déjà (50 ms
 * d'écart), mais une réponse de deux paragraphes n'a que deux blocs : à
 * l'écran, ça reste une apparition instantanée.
 *
 * Chaque mot porte donc son propre délai d'animation. C'est du CSS pur — une
 * `animation-delay` calculée au rendu, pas un compteur qui re-rendrait React
 * quarante fois par seconde : le texte apparaît en se composant, sans coûter
 * une seule image de plus au fil principal.
 *
 * Le délai est PLAFONNÉ : sans cela, une réponse de trois cents mots mettrait
 * dix secondes à finir de s'afficher, et le lecteur attendrait la fin de son
 * propre cours.
 */
const WORD_STEP_MS = 16;
const MAX_REVEAL_MS = 2000;

/** Compteur mutable de mots, partagé par tous les segments d'une réponse. */
interface WordClock {
  index: number;
}

function words(text: string, keyPrefix: string, clock: WordClock): ReactNode[] {
  // On conserve les espaces (`split` capturant) : sans eux, tous les mots se
  // colleraient les uns aux autres.
  return text.split(/(\s+)/).map((part, index) => {
    if (part.trim().length === 0) return <Fragment key={`${keyPrefix}-s${index}`}>{part}</Fragment>;
    const delay = Math.min(clock.index * WORD_STEP_MS, MAX_REVEAL_MS);
    clock.index += 1;
    return (
      <span key={`${keyPrefix}-w${index}`} className="reveal-word" style={{ animationDelay: `${delay}ms` }}>
        {part}
      </span>
    );
  });
}

/** `**gras**` → <strong>. Le reste du segment est révélé mot à mot. */
function inline(text: string, keyPrefix: string, clock: WordClock): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-${index}`} className="font-semibold text-[var(--ink)]">
          {words(part.slice(2, -2), `${keyPrefix}-${index}`, clock)}
        </strong>
      );
    }
    return <Fragment key={`${keyPrefix}-${index}`}>{words(part, `${keyPrefix}-${index}`, clock)}</Fragment>;
  });
}

/** Une puce, avec son niveau : 0 pour « - », 1 pour « ␣␣- » (sous-liste). */
interface BulletItem {
  text: string;
  depth: 0 | 1;
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: BulletItem[] }
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
    // L'indentation compte AVANT le trim : c'est elle qui distingue une
    // énumération de ses éléments (« trois branches : » puis les trois noms).
    const indent = line.length - line.trimStart().length;

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
      const item: BulletItem = { text: bullet[1]!, depth: indent >= 2 ? 1 : 0 };
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'bullets') last.items.push(item);
      else blocks.push({ kind: 'bullets', items: [item] });
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

function renderBlock(block: Block, index: number, clock: WordClock): ReactNode {
  if (block.kind === 'heading') {
    return (
      <h3 className="mt-1 text-[0.95rem] font-semibold">
        {inline(block.text, `h-${index}`, clock)}
      </h3>
    );
  }
  if (block.kind === 'bullets') {
    return (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {block.items.map((item, itemIndex) => (
          <li
            key={itemIndex}
            // Les sous-puces sont décalées et marquées d'un cercle creux :
            // une énumération se lit alors comme une liste d'éléments, pas
            // comme quatre affirmations de même rang.
            className={item.depth === 1 ? 'ml-5 list-[circle] text-[var(--ink-soft)]' : undefined}
          >
            {inline(item.text, `b-${index}-${itemIndex}`, clock)}
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'numbers') {
    return (
      <ol className="flex list-decimal flex-col gap-1 pl-5">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{inline(item, `n-${index}-${itemIndex}`, clock)}</li>
        ))}
      </ol>
    );
  }
  return <p className="whitespace-pre-wrap">{inline(block.text, `p-${index}`, clock)}</p>;
}

/** Au-delà, un délai supplémentaire ne se voit plus et ralentirait pour rien une longue réponse. */
const MAX_STAGGER_BLOCKS = 8;
const STAGGER_STEP_S = 0.05;

/**
 * Chaque bloc (titre, paragraphe, liste) apparaît avec un léger décalage en
 * cascade plutôt que tous d'un coup — une réponse longue se lit alors comme
 * en train de « se composer », sans dépendre d'une diffusion réelle du
 * fournisseur (voir `services/ai/orchestrator.ts` : seul Claude, en mode
 * cours, diffuse token par token ; OpenAI et Gemini livrent leur réponse en
 * un seul bloc, qui a donc besoin de cette apparition progressive après
 * réception complète).
 */
export function AnswerText({ text }: { text: string }) {
  const blocks = parseAnswerBlocks(text);
  const reduced = useReducedMotion();

  /*
   * Une seule horloge pour toute la réponse : le compteur de mots traverse les
   * blocs. Deux horloges (une par bloc) feraient repartir chaque paragraphe de
   * zéro, et les blocs se révéleraient en parallèle au lieu de s'enchaîner.
   *
   * Elle est recréée à chaque rendu, ce qui est voulu : le texte d'une réponse
   * ne change pas après réception, et une réponse re-rendue (changement de
   * thème, redimensionnement) rejoue simplement son apparition.
   */
  const clock: WordClock = { index: 0 };

  return (
    <div className="flex flex-col gap-2.5 text-[0.92rem] leading-relaxed">
      {blocks.map((block, index) => (
        <motion.div
          key={index}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: reduced ? 0 : Math.min(index, MAX_STAGGER_BLOCKS) * STAGGER_STEP_S }}
        >
          {renderBlock(block, index, clock)}
        </motion.div>
      ))}
    </div>
  );
}
