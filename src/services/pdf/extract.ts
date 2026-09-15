import * as pdfjs from 'pdfjs-dist';
import '@/services/pdf/workerSrc';
import { restoreCourseLayoutPages } from '@/services/local/courseLayout';

/**
 * Extraction du texte d'un PDF, dans le navigateur.
 *
 * Le worker est fourni par Vite sous forme d'URL empaquetée plutôt que chargé
 * depuis un CDN comme le faisait le prototype : l'extraction fonctionne donc
 * hors ligne, et ne dépend pas de la disponibilité d'un tiers.
 */

export interface ExtractionProgress {
  page: number;
  pageCount: number;
}

export interface ExtractedPdf {
  text: string;
  pageCount: number;
  /** Pages dont l'extraction n'a produit aucun texte (PDF scanné, image). */
  emptyPages: number[];
  /**
   * Offset (dans `text`) où commence chaque page, page 1 en premier —
   * `pageOffsets[i]` est le début de la page `i+1`. C'est ce qui permet de
   * retrouver, pour un passage donné du texte, la page du PDF d'où il vient.
   */
  pageOffsets: number[];
}

export class PdfExtractionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PdfExtractionError';
  }
}

/**
 * Un recul horizontal important, à hauteur de ligne inchangée, signale un
 * changement de colonne — pas la suite naturelle d'une phrase. Fréquent sur
 * des diapositives exportées en PDF (deux colonnes, ou des zones de texte
 * séparées à la même hauteur) : sans cette détection, `joinTextItems` collait
 * la fin d'une colonne au début de l'autre en un seul fragment incohérent —
 * la cause la plus plausible d'un texte extrait « qui a l'air d'une mauvaise
 * OCR » alors qu'il n'y a ici AUCUNE OCR, seulement l'ordre dans lequel pdf.js
 * restitue le texte natif du PDF. En points PDF (1/72 de pouce).
 */
const COLUMN_JUMP_THRESHOLD = 40;

/**
 * Part du corps du texte au-delà de laquelle un écart horizontal se lit comme
 * une espace plutôt que comme du crénage. Une espace typographique vaut
 * environ 0,25 cadratin, le crénage à l'intérieur d'un mot reste bien en
 * dessous de 0,05 : 0,18 sépare les deux sans ambiguïté.
 */
const SPACE_GAP_RATIO = 0.18;

/**
 * Part du corps du texte au-delà de laquelle un écart VERTICAL se lit comme un
 * changement de paragraphe plutôt qu'un simple retour à la ligne.
 *
 * Le seuil était auparavant absolu (14 points). Sur un cours de diapositives —
 * le format le plus courant en fac — le texte est en corps 20 à 28, donc
 * l'interligne ordinaire dépasse largement 14 points : CHAQUE retour à la
 * ligne devenait une fin de paragraphe. Une puce tenant sur deux lignes se
 * retrouvait coupée en deux, et le découpage en fragments héritait de demi-
 * phrases comme « … qui se trouve sur les côtés de ». Un interligne simple
 * vaut environ 1,2 fois le corps ; un vrai saut de paragraphe est au-delà de
 * 1,8. Le plancher à 14 points préserve le comportement sur du texte de corps
 * ordinaire.
 */
const PARAGRAPH_GAP_RATIO = 1.8;

/**
 * Faut-il un espace entre deux fragments de la MÊME ligne ?
 *
 * pdf.js ne découpe pas le texte en mots : il le découpe là où le PDF change
 * de crénage, de police ou de style. « Le » arrive donc régulièrement en deux
 * fragments, « L » puis « e ». L'ancien code insérait un espace entre chaque
 * paire de fragments consécutifs, ce qui produisait « L e nerf ophtalmique »
 * — un défaut bien réel, observé sur un cours d'anatomie importé, et qui
 * contaminait ensuite TOUT ce qui découle du texte : recherche, flashcards,
 * réponses locales.
 *
 * La position seule ne suffit pas à trancher ; c'est l'ÉCART entre la fin du
 * fragment précédent (x + largeur) et le début du suivant qui le dit. Deux
 * glyphes d'un même mot se touchent ; deux mots sont séparés d'environ un
 * quart de cadratin. Le seuil est donc relatif au corps du texte, pas absolu :
 * un même écart en points ne veut pas dire la même chose en corps 8 et en
 * corps 24.
 *
 * Sans information de largeur (fragments synthétiques, anciens tests), on
 * retombe sur l'ancien comportement : un espace. Mieux vaut un espace de trop
 * que deux mots collés.
 */
function needsSpaceBetween(
  previousEndX: number | null,
  x: number | null,
  item: { width?: number; height?: number; transform?: number[] },
): boolean {
  if (previousEndX === null || x === null) return true;

  const fontSize = Math.abs(item.transform?.[3] ?? 0) || item.height || 10;
  // Un demi-point minimum : sous cette valeur, l'écart relève de l'arrondi.
  const threshold = Math.max(0.5, SPACE_GAP_RATIO * fontSize);
  return x - previousEndX > threshold;
}

/**
 * Recompose le texte d'une page en préservant les sauts de ligne.
 *
 * pdf.js renvoie des fragments positionnés, sans notion de ligne. Les
 * concaténer bêtement — ce que faisait le prototype — colle les titres aux
 * paragraphes et détruit la structure dont dépend le découpage en fragments.
 * On s'appuie ici sur le marqueur `hasEOL` fourni par pdf.js, sur les
 * ruptures de position verticale, puis sur un recul horizontal suspect (voir
 * `COLUMN_JUMP_THRESHOLD`).
 */
export function joinTextItems(
  items: { str: string; hasEOL?: boolean; width?: number; height?: number; transform?: number[] }[],
): string {
  let out = '';
  let previousY: number | null = null;
  let previousX: number | null = null;
  let previousEndX: number | null = null;

  for (const item of items) {
    if (item.str.length === 0) continue;

    const x = item.transform?.[4] ?? null;
    const y = item.transform?.[5] ?? null;
    const sameLine = previousY !== null && y !== null && Math.abs(y - previousY) <= 1;
    const columnJump = sameLine && previousX !== null && x !== null && x < previousX - COLUMN_JUMP_THRESHOLD;

    if (columnJump) {
      out += '\n';
    } else if (previousY !== null && y !== null && Math.abs(y - previousY) > 1) {
      // Un écart vertical important indique un nouveau paragraphe, pas un
      // simple retour à la ligne — mais « important » dépend du corps du texte.
      const fontSize = Math.abs(item.transform?.[3] ?? 0) || item.height || 0;
      const paragraphGap = Math.max(14, PARAGRAPH_GAP_RATIO * fontSize);
      out += Math.abs(y - previousY) > paragraphGap ? '\n\n' : '\n';
    } else if (out.length > 0 && !out.endsWith('\n') && !out.endsWith(' ')) {
      // Deux fragments de la même ligne ne sont PAS forcément deux mots : voir
      // `needsSpaceBetween`.
      if (needsSpaceBetween(previousEndX, x, item)) out += ' ';
    }

    out += item.str;
    if (item.hasEOL) out += '\n';
    previousY = y;
    previousX = x;
    previousEndX = x !== null && typeof item.width === 'number' ? x + item.width : null;
  }

  return out;
}

export async function extractPdfText(
  file: File | ArrayBuffer,
  onProgress?: (progress: ExtractionProgress) => void,
  signal?: AbortSignal,
): Promise<ExtractedPdf> {
  let data: ArrayBuffer;
  try {
    data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  } catch (cause) {
    throw new PdfExtractionError('Impossible de lire le fichier.', cause);
  }

  let document: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    document = await pdfjs.getDocument({ data }).promise;
  } catch (cause) {
    throw new PdfExtractionError(
      "Ce fichier n'a pas pu être ouvert. Il est peut-être protégé par mot de passe ou endommagé.",
      cause,
    );
  }

  const pages: string[] = [];
  const emptyPages: number[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (signal?.aborted) throw new PdfExtractionError('Extraction annulée.');

      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = joinTextItems(
        content.items.filter((item): item is typeof item & { str: string } => 'str' in item),
      ).trim();

      if (text.length === 0) emptyPages.push(pageNumber);
      pages.push(text);

      onProgress?.({ page: pageNumber, pageCount: document.numPages });

      // Libère la page : sans cela, un PDF de 300 pages sature la mémoire de
      // l'iPad et Safari recharge l'onglet en pleine importation.
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }

  /*
   * REMISE EN FORME AVANT TOUT LE RESTE.
   *
   * `getTextContent()` rend une page comme une seule ligne : tous les items
   * joints par des espaces, sans un seul retour à la ligne. La hiérarchie du
   * polycopié — titre, puces, sous-puces — survit dans les caractères (« • »,
   * « § », « → »), mais plus dans la mise en page. Or tout ce qui vient
   * ensuite (découpage en fragments, détection de listes, extraction de
   * relations) raisonne LIGNE PAR LIGNE.
   *
   * Mesuré sur un cours réel de 10 pages : sans cette étape, le moteur local
   * en tirait 14 faits et ne répondait à AUCUNE des 8 questions de contrôle ;
   * avec, 21 faits et 6 réponses sur 8. C'est de loin le correctif le plus
   * rentable de toute la chaîne — et il ne touche pas un seul mot du cours,
   * il ne fait que replacer des fins de ligne (voir `courseLayout.ts`).
   */
  const laidOut = restoreCourseLayoutPages(pages);

  // Les offsets sont calculés sur le texte REMIS EN FORME, celui qui sera
  // effectivement stocké : les calculer sur le texte brut ferait pointer
  // chaque citation à côté.
  const joined = laidOut.join('\n\n');
  const leadingTrim = joined.length - joined.trimStart().length;
  const pageOffsets: number[] = [];
  let cursor = 0;
  for (const page of laidOut) {
    pageOffsets.push(Math.max(0, cursor - leadingTrim));
    cursor += page.length + 2; // +2 pour le séparateur "\n\n"
  }

  return {
    text: joined.trim(),
    pageCount: document.numPages,
    emptyPages,
    pageOffsets,
  };
}

/**
 * Diagnostic lisible d'une extraction.
 * Un PDF scanné produit un texte vide : mieux vaut le dire clairement que de
 * laisser importer un document dont l'IA ne pourra rien tirer.
 */
export function describeExtraction(result: ExtractedPdf): {
  ok: boolean;
  message: string;
  tone: 'success' | 'error' | 'info';
} {
  if (result.text.length === 0) {
    return {
      ok: false,
      tone: 'error',
      message:
        "Aucun texte n'a pu être extrait : ce PDF est probablement un scan (des images de pages). Copie-colle le texte à la main, ou utilise une version avec texte sélectionnable.",
    };
  }

  if (result.emptyPages.length > result.pageCount / 2) {
    return {
      ok: true,
      tone: 'info',
      message: `Texte extrait, mais ${result.emptyPages.length} page(s) sur ${result.pageCount} sont vides — probablement des schémas ou des scans.`,
    };
  }

  return {
    ok: true,
    tone: 'success',
    message: `${result.pageCount} page(s) extraite(s), ${result.text.length.toLocaleString('fr-FR')} caractères.`,
  };
}
