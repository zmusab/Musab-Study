import { citationFromChunk } from './citation';
import { courseSections } from './courseLayout';
import { extractFacts, type RawFact } from './relationExtraction';
import { splitIntoSentences, stripBulletPrefix } from './textStructure';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { Citation, DocumentChunk } from '@/types';

/**
 * RÉSUMÉ ET FICHE DE RÉVISION, SANS IA.
 *
 * Le résumé de chapitre et la fiche de révision étaient les deux dernières
 * fonctions d'étude entièrement bloquées derrière une clé API : sans clé,
 * l'assistant répondait « Ajoute ta clé API dans Paramètres » et il ne se
 * passait rien. Deux fonctions centrales, indisponibles à qui n'a pas de
 * compte chez un fournisseur d'IA — exactement ce que ce projet refuse.
 *
 * ── CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS ────────────────────────
 * Il ne REFORMULE rien. Un résumé reformulé demande un modèle de langue ;
 * c'est le bouton « Régénérer avec l'IA », et il reste là.
 *
 * Ce qu'il fait est un résumé EXTRACTIF : il RANGE le cours sans le réécrire.
 * Chaque ligne rendue est un sous-extrait exact du document, et l'étudiant
 * peut la retrouver mot pour mot dans son PDF. C'est moins qu'une explication,
 * et c'est plus qu'un écran vide.
 *
 * Deux formes, parce que les deux demandes sont différentes :
 *  - le RÉSUMÉ suit le cours dans son ordre — le plan du document, ses titres
 *    et ce qu'ils annoncent ;
 *  - la FICHE range par NATURE de savoir — définitions, chiffres à retenir,
 *    énumérations, pièges — parce qu'on ne révise pas dans l'ordre où on a
 *    appris.
 */

export interface LocalStudySheet {
  text: string;
  citations: Citation[];
}

/** Lignes d'une section, puces retirées, vides écartées. */
function bodyOf(lines: readonly string[]): string[] {
  return lines.map((line) => stripBulletPrefix(line).trim()).filter(Boolean);
}

/** Ordre du document : un résumé qui saute d'un chapitre à l'autre n'en est pas un. */
function inReadingOrder(chunks: readonly DocumentChunk[]): DocumentChunk[] {
  return [...chunks].sort(
    (a, b) => a.documentId.localeCompare(b.documentId) || a.index - b.index,
  );
}

/** Au-delà, ce n'est plus un résumé mais une recopie du cours. */
const MAX_SECTIONS = 14;
const MAX_LINES_PER_SECTION = 4;

/**
 * PLAN DU COURS — ses titres, et sous chacun ses premières lignes.
 *
 * C'est ce qu'un étudiant écrit lui-même quand il résume : il garde la
 * charpente et coupe les développements.
 */
function outline(chunks: readonly DocumentChunk[], lookup: ContextLookup): LocalStudySheet | null {
  const lines: string[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  let kept = 0;

  for (const chunk of inReadingOrder(chunks)) {
    for (const section of courseSections(chunk.text)) {
      if (kept >= MAX_SECTIONS) break;
      const body = bodyOf(section.lines);
      if (!section.heading || body.length === 0) continue;

      // Les fragments se CHEVAUCHENT : sans ce garde-fou, chaque section
      // reviendrait deux fois dans le résumé.
      const key = section.heading.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      lines.push(`### ${section.heading}`);
      for (const line of body.slice(0, MAX_LINES_PER_SECTION)) lines.push(`- ${line}`);
      lines.push('');
      citations.push(citationFromChunk(chunk, lookup, body[0]!));
      kept += 1;
    }
  }

  if (kept === 0) return openingLines(chunks, lookup);
  return {
    text: [
      '**Le plan de ton cours**, dans son ordre.',
      '',
      ...lines,
      '_Chaque ligne vient telle quelle de ton document. Le moteur local le range ; il ne le reformule pas._',
    ].join('\n'),
    citations,
  };
}

/**
 * REPLI : un cours SANS TITRES a droit à un résumé lui aussi.
 *
 * `outline` s'appuie sur les intertitres du document. Une note tapée au
 * clavier, un cours rédigé d'un seul tenant, un PDF dont l'extraction n'a rien
 * dégagé n'en ont aucun — et la fonction rendait alors `null`, c'est-à-dire
 * rien du tout. Or c'est justement le cas d'un texte au fil de l'eau, celui
 * qu'on a le plus besoin de dégrossir.
 *
 * On revient donc au résumé extractif le plus ancien qui soit : la PREMIÈRE
 * PHRASE de chaque passage, dans l'ordre du document. En français comme
 * ailleurs, un paragraphe annonce ce qu'il développe.
 */
function openingLines(chunks: readonly DocumentChunk[], lookup: ContextLookup): LocalStudySheet | null {
  const lines: string[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const chunk of inReadingOrder(chunks)) {
    if (lines.length >= MAX_SECTIONS) break;
    const first = bodyOf(chunk.text.split('\n'))
      .flatMap((line) => splitIntoSentences(line))
      .find((sentence) => sentence.length >= 30);
    if (!first) continue;

    // Les fragments se chevauchent : la même phrase ouvre volontiers deux
    // fragments voisins.
    const key = first.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    lines.push(`- ${first}`);
    citations.push(citationFromChunk(chunk, lookup, first));
  }

  if (lines.length === 0) return null;
  return {
    text: [
      '**L’essentiel de ton cours**, passage par passage.',
      '',
      ...lines,
      '',
      '_Chaque ligne vient telle quelle de ton document. Le moteur local le range ; il ne le reformule pas._',
    ].join('\n'),
    citations,
  };
}

/** Rubriques de la fiche, dans l'ordre où on révise. */
const SHEET_SECTIONS: { heading: string; keep: (fact: RawFact) => boolean }[] = [
  { heading: 'Les définitions', keep: (fact) => fact.predicate === 'definition' },
  {
    heading: 'Ce qui se compte',
    keep: (fact) => fact.countWord !== null && fact.countNoun !== null,
  },
  { heading: 'Les énumérations à connaître', keep: (fact) => (fact.items?.length ?? 0) >= 2 },
  { heading: 'À quoi ça sert', keep: (fact) => fact.predicate === 'function' },
  { heading: 'Où ça se situe', keep: (fact) => fact.predicate === 'location' },
];

/**
 * PIÈGES ANNONCÉS PAR LE COURS LUI-MÊME.
 *
 * Rien n'est deviné : ce sont les avertissements que l'enseignant a écrits.
 * « PS : » est inclus parce que ce polycopié s'en sert systématiquement pour
 * les remarques qui n'entrent pas dans le plan — et ce sont précisément
 * celles qu'on oublie.
 */
const WARNING = /\b(attention|ne pas confondre|piège|remarque|à retenir|important)\b|^PS\s*:/i;

const MAX_PER_SHEET_SECTION = 6;

function sheet(chunks: readonly DocumentChunk[], lookup: ContextLookup): LocalStudySheet | null {
  const facts: { fact: RawFact; chunk: DocumentChunk }[] = [];
  const warnings: { line: string; chunk: DocumentChunk }[] = [];
  /*
    DEUX registres séparés, et c'est délibéré.

    Un seul registre partagé faisait disparaître la rubrique « pièges » en
    entier : une ligne « PS : … » produit souvent aussi un fait, elle était
    donc déjà notée comme vue, et l'avertissement passait à la trappe. Or ce
    sont exactement les lignes qu'un étudiant oublie — et la seule rubrique de
    la fiche que l'enseignant a écrite POUR être retenue.
  */
  const seenFacts = new Set<string>();
  const seenWarnings = new Set<string>();

  for (const chunk of inReadingOrder(chunks)) {
    for (const fact of extractFacts(chunk)) {
      if (fact.confidence === 'low') continue;
      const key = fact.sourceExcerpt.trim().toLowerCase();
      if (seenFacts.has(key)) continue;
      seenFacts.add(key);
      facts.push({ fact, chunk });
    }
    for (const raw of chunk.text.split('\n')) {
      const line = stripBulletPrefix(raw).trim();
      if (line.length < 12 || !WARNING.test(line)) continue;
      const key = line.toLowerCase();
      if (seenWarnings.has(key)) continue;
      seenWarnings.add(key);
      warnings.push({ line, chunk });
    }
  }

  const lines: string[] = [];
  const citations: Citation[] = [];
  const used = new Set<RawFact>();

  for (const section of SHEET_SECTIONS) {
    const group = facts.filter(({ fact }) => !used.has(fact) && section.keep(fact)).slice(0, MAX_PER_SHEET_SECTION);
    if (group.length === 0) continue;

    lines.push(`### ${section.heading}`);
    for (const { fact, chunk } of group) {
      used.add(fact);
      if (fact.countWord && fact.countNoun) {
        lines.push(`- ${fact.subject} : **${fact.countWord} ${fact.countNoun}**.`);
      } else if (fact.items && fact.items.length >= 2) {
        lines.push(`- ${fact.subject}`);
        for (const item of fact.items) lines.push(`  - ${item}`);
      } else {
        lines.push(`- ${fact.sourceExcerpt.trim()}`);
      }
      citations.push(citationFromChunk(chunk, lookup, fact.sourceExcerpt));
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push('### Les pièges signalés par ton cours');
    for (const { line, chunk } of warnings.slice(0, MAX_PER_SHEET_SECTION)) {
      lines.push(`- ${line}`);
      citations.push(citationFromChunk(chunk, lookup, line));
    }
    lines.push('');
  }

  if (lines.length === 0) return null;
  return {
    text: [
      '**Ta fiche de révision**, rangée par nature de savoir.',
      '',
      ...lines,
      '_Chaque ligne vient telle quelle de ton document. Le moteur local le range ; il ne le reformule pas._',
    ].join('\n'),
    citations,
  };
}

/**
 * Fiche ou résumé, sans réseau. `null` quand le cours indexé ne permet pas
 * d'en tirer quoi que ce soit de vérifiable — l'appelant le dit alors
 * franchement plutôt que de rendre une page vide.
 */
export function buildLocalStudySheet(
  mode: 'summary' | 'sheet',
  chunks: readonly DocumentChunk[],
  lookup: ContextLookup,
): LocalStudySheet | null {
  if (chunks.length === 0) return null;
  return mode === 'summary' ? outline(chunks, lookup) : sheet(chunks, lookup);
}
