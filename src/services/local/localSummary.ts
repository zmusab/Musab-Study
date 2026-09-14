import { citationFromChunk } from './citation';
import { extractFacts, type RawFact } from './relationExtraction';
import { bulletDepth, splitIntoSentences, stripBulletPrefix, topLevelColonIndex } from './textStructure';
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
 * LE DOCUMENT REMIS BOUT À BOUT, SANS LES RECOUVREMENTS.
 *
 * Les fragments se chevauchent volontairement (voir `chunking.ts`) pour
 * qu'une phrase coupée reste retrouvable. Lire le plan fragment par fragment
 * faisait donc surgir des titres qui n'existent pas : le résumé s'ouvrait sur
 * « ### supérieur ou Grand Oblique », qui est la FIN d'une ligne reprise du
 * fragment précédent.
 *
 * On recolle donc le document dans l'ordre, en écartant toute ligne déjà vue,
 * et on garde pour chaque ligne le fragment d'où elle vient — la citation en
 * a besoin.
 */
function documentLines(chunks: readonly DocumentChunk[]): { text: string; chunk: DocumentChunk }[] {
  const seen = new Set<string>();
  const lines: { text: string; chunk: DocumentChunk }[] = [];

  for (const [position, chunk] of inReadingOrder(chunks).entries()) {
    const raws = chunk.text.split('\n');
    for (const [index, raw] of raws.entries()) {
      const text = raw.trim();
      if (text.length === 0) continue;
      const key = stripBulletPrefix(text).trim().toLowerCase();
      if (key.length === 0 || seen.has(key)) continue;

      /*
        LE RECOUVREMENT COUPE UNE LIGNE EN DEUX, et sa FIN ouvre le fragment
        suivant. « § Oblique supérieur ou Grand Oblique » reparaissait donc en
        tête du fragment d'après sous la forme « supérieur ou Grand Oblique »,
        qui n'est identique à aucune ligne déjà vue — et le plan s'ornait d'un
        intertitre « ### supérieur ou Grand Oblique ».

        Un début de fragment qui TERMINE une ligne déjà lue est ce morceau-là,
        pas une ligne nouvelle. Le test ne porte que sur les premières lignes
        d'un fragment, là où le recouvrement se trouve.
      */
      if (position > 0 && index < OVERLAP_LINES && [...seen].some((previous) => previous.endsWith(key))) {
        continue;
      }

      seen.add(key);
      lines.push({ text, chunk });
    }
  }
  return lines;
}

/**
 * LES BLOCS DU COURS — ce qu'un étudiant recopierait comme plan.
 *
 * Un bloc commence à une ligne qui ANNONCE : un titre reconnu, ou une ligne
 * de premier niveau suivie de lignes plus profondes. C'est la structure réelle
 * d'un polycopié — « 4 muscles droits : » puis ses quatre puces — et c'est
 * précisément ce que la lecture par titres seuls laissait tomber : sur le
 * cours du trijumeau, elle ne retenait QUE DEUX blocs sur six, sans le dire,
 * tout en s'annonçant « le plan de ton cours ».
 */
interface OutlineBlock {
  heading: string;
  body: string[];
  chunk: DocumentChunk;
}

/*
  UNE LIGNE SANS PUCE EST UN TITRE, une ligne à puce est son contenu.

  `bulletDepth` numérote les niveaux de puces (• = 0, § = 1, o = 2) et rend
  `null` pour une ligne ordinaire. Confondre ce `null` avec le niveau 0 mettait
  « Le nerf ophtalmique de Willis » et « • Il chemine par le canal… » au même
  rang : le titre perdait son contenu et disparaissait du plan, qui s'ouvrait
  alors sur « ### Puis il entre dans le sillon carotidien ».

  Une ligne nue est donc AU-DESSUS de toutes les puces. C'est la hiérarchie
  que Word a écrite et que l'extraction PDF a conservée dans les marqueurs.
*/
const PLAIN_LINE_DEPTH = -1;

/** Lignes de tête d'un fragment où le recouvrement peut se trouver. */
const OVERLAP_LINES = 3;

function depthOf(line: string): number {
  return bulletDepth(line) ?? PLAIN_LINE_DEPTH;
}

function outlineBlocks(chunks: readonly DocumentChunk[]): OutlineBlock[] {
  const lines = documentLines(chunks);
  const blocks: OutlineBlock[] = [];
  let headDepth = PLAIN_LINE_DEPTH;

  for (const line of lines) {
    const depth = depthOf(line.text);
    const text = stripBulletPrefix(line.text).trim();
    if (text.length === 0) continue;

    // Aussi haut ou plus haut que le titre courant : c'est un nouveau bloc.
    if (blocks.length === 0 || depth <= headDepth) {
      blocks.push({ heading: text, body: [], chunk: line.chunk });
      headDepth = depth;
      continue;
    }
    blocks[blocks.length - 1]!.body.push(text);
  }

  /*
    Un bloc SANS CORPS n'est pas un titre, c'est une phrase du cours : elle
    rejoint le bloc précédent plutôt que de s'afficher comme un intertitre
    vide. Sans cela, « Le nerf maxillaire est un nerf sensitif. » devenait un
    titre de section à lui tout seul.
  */
  const merged: OutlineBlock[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (block.body.length === 0 && previous && previous.body.length > 0) {
      previous.body.push(block.heading);
      continue;
    }
    merged.push(block);
  }
  return merged.filter((block) => block.body.length > 0);
}

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

  /*
    UN PLAN QUI SAUTE LES DEUX TIERS DU COURS N'EST PAS LE PLAN DU COURS.

    Mesuré sur le polycopié du trijumeau : le résumé s'annonçait « Le plan de
    ton cours, dans son ordre » et n'en montrait que DEUX blocs sur six. Les
    muscles droits, le nerf maxillaire, le nerf mandibulaire et les ganglions
    disparaissaient — sans que rien ne le signale.

    La cause : une section SANS TITRE était purement ignorée. Or un polycopié
    n'intitule pas tout. « 4 muscles droits : » puis ses quatre puces est un
    bloc parfaitement structuré ; il n'a simplement pas été reconnu comme un
    titre parce que c'est une ligne de texte ordinaire.

    Une section sans titre est donc rendue sous SA PREMIÈRE LIGNE — qui est,
    dans un cours, l'annonce de ce qui suit. Rien n'est inventé : ce titre est
    une ligne du document, déplacée d'un cran.
  */
  for (const block of outlineBlocks(chunks)) {
    if (kept >= MAX_SECTIONS) break;
    const key = block.heading.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    lines.push(`### ${block.heading}`);
    for (const line of block.body.slice(0, MAX_LINES_PER_SECTION)) lines.push(`- ${line}`);
    if (block.body.length > MAX_LINES_PER_SECTION) {
      /*
        Un plan qui tronque le DIT, plutôt que de laisser croire que le bloc
        s'arrête là. En italique et sans puce : ce n'est pas une ligne du
        cours, et rien dans la mise en forme ne doit le faire croire — c'est
        la même règle que la note de bas de résumé.
      */
      const reste = block.body.length - MAX_LINES_PER_SECTION;
      lines.push(`_… et ${reste} ligne${reste > 1 ? 's' : ''} de plus dans ton cours._`);
    }
    lines.push('');
    citations.push(citationFromChunk(block.chunk, lookup, block.body[0]!));
    kept += 1;
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



/** Vrai si l'extrait ANNONCE sa liste — un deux-points de premier niveau. */
function announces(fact: RawFact): boolean {
  const first = stripBulletPrefix(fact.sourceExcerpt.trim().split('\n')[0] ?? '').trim();
  return topLevelColonIndex(first) > 0;
}

/**
 * CE QU'ANNONCE UNE ÉNUMÉRATION, et pas seulement son sujet.
 *
 * La fiche affichait trois fois de suite « Le nerf ophtalmique de Willis »
 * comme intitulé de liste — ses rapports, ses branches terminales, son
 * trajet — et rien ne permettait de savoir laquelle on lisait. Le cours, lui,
 * les distingue : « … se divise en 3 branches terminales : », « … est en
 * rapport avec : ». C'est cette ligne d'annonce qu'il faut afficher.
 *
 * Elle est prise telle quelle dans l'extrait, jusqu'au deux-points de premier
 * niveau — le même découpage que les réponses du chat. À défaut, on retombe
 * sur le sujet.
 */
function enumerationLead(fact: RawFact): string {
  const first = stripBulletPrefix(fact.sourceExcerpt.trim().split('\n')[0] ?? '').trim();
  if (first.length === 0) return fact.subject;
  const colon = topLevelColonIndex(first);
  const announcement = colon > 0 ? first.slice(0, colon).trim() : first;
  // Plus informatif que le sujet seul, et pas au point d'être la liste entière.
  return announcement.length > fact.subject.length && announcement.length <= 140
    ? announcement
    : fact.subject;
}

/** Rubriques de la fiche, dans l'ordre où on révise. */
const SHEET_SECTIONS: { heading: string; keep: (fact: RawFact) => boolean }[] = [
  { heading: 'Les définitions', keep: (fact) => fact.predicate === 'definition' },
  {
    heading: 'Ce qui se compte',
    keep: (fact) => fact.countWord !== null && fact.countNoun !== null,
  },
  {
    heading: 'Les énumérations à connaître',
    /*
      UNE ÉNUMÉRATION À CONNAÎTRE EST UNE ÉNUMÉRATION ANNONCÉE.

      La rubrique contenait aussi ceci :

          - Le nerf ophtalmique de Willis
            - Il chemine par le canal le plus interne de Cavum Meckeli
            - Puis il entre dans le sillon carotidien…

      Ce n'est pas une liste à apprendre, c'est un titre de section suivi de
      ses deux premières phrases — et il portait le MÊME intitulé que la vraie
      liste des trois branches terminales, juste au-dessus. Deux entrées
      identiques à l'œil, dont une seule était une énumération.

      Une liste que le cours veut faire retenir s'annonce : « se divise en 3
      branches terminales : », « en rapport avec : ». C'est ce deux-points qui
      la distingue, et il est écrit dans le document.
    */
    keep: (fact) => (fact.items?.length ?? 0) >= 2 && announces(fact),
  },
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
        lines.push(`- ${enumerationLead(fact)}`);
        for (const item of fact.items) lines.push(`  - ${item}`);
      } else {
        lines.push(`- ${fact.sourceExcerpt.trim()}`);
      }
      citations.push(citationFromChunk(chunk, lookup, fact.sourceExcerpt));
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    /*
      « PIÈGES » PROMETTAIT PLUS QUE LE CONTENU.

      La rubrique rassemble ce que le cours signale à part : « Attention »,
      « Ne pas confondre », mais aussi « Remarque » et « PS ». Les deux
      dernières ne sont pas des pièges, ce sont des notes — et annoncer un
      piège pour une note fait douter de la rubrique entière.
    */
    lines.push('### Ce que ton cours signale à part');
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
