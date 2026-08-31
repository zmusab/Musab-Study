import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Extraction du texte d'un PDF, dans le navigateur.
 *
 * Le worker est fourni par Vite sous forme d'URL empaquetée plutôt que chargé
 * depuis un CDN comme le faisait le prototype : l'extraction fonctionne donc
 * hors ligne, et ne dépend pas de la disponibilité d'un tiers.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ExtractionProgress {
  page: number;
  pageCount: number;
}

export interface ExtractedPdf {
  text: string;
  pageCount: number;
  /** Pages dont l'extraction n'a produit aucun texte (PDF scanné, image). */
  emptyPages: number[];
}

export class PdfExtractionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PdfExtractionError';
  }
}

/**
 * Recompose le texte d'une page en préservant les sauts de ligne.
 *
 * pdf.js renvoie des fragments positionnés, sans notion de ligne. Les
 * concaténer bêtement — ce que faisait le prototype — colle les titres aux
 * paragraphes et détruit la structure dont dépend le découpage en fragments.
 * On s'appuie ici sur le marqueur `hasEOL` fourni par pdf.js, puis sur les
 * ruptures de position verticale.
 */
function joinTextItems(items: { str: string; hasEOL?: boolean; transform?: number[] }[]): string {
  let out = '';
  let previousY: number | null = null;

  for (const item of items) {
    const y = item.transform?.[5] ?? null;

    if (previousY !== null && y !== null && Math.abs(y - previousY) > 1) {
      // Un écart vertical important indique un nouveau paragraphe, pas un
      // simple retour à la ligne.
      out += Math.abs(y - previousY) > 14 ? '\n\n' : '\n';
    } else if (out.length > 0 && !out.endsWith('\n') && !out.endsWith(' ')) {
      out += ' ';
    }

    out += item.str;
    if (item.hasEOL) out += '\n';
    previousY = y;
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

  return {
    text: pages.join('\n\n').trim(),
    pageCount: document.numPages,
    emptyPages,
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
