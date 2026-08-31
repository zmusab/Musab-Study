import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import '@/services/pdf/workerSrc';

/**
 * Rendu de pages PDF sur canevas — pour la miniature de couverture ET pour le
 * lecteur intégré. Séparé de `extract.ts` (qui ne lit que le texte) : les deux
 * ouvrent le PDF indépendamment, ce qui coûte une seconde ouverture au moment
 * de l'import, mais garde chaque module simple et à responsabilité unique.
 */

export async function openPdfDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data }).promise;
}

/** Rend une page sur un canevas à la largeur cible, retourne l'échelle utilisée. */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetWidth: number,
): Promise<number> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });

  // `Math.round` : un canevas à taille fractionnaire force certains
  // navigateurs (Safari iPad inclus) à le redessiner flou.
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Contexte 2D indisponible.');

  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();
  return scale;
}

/** Miniature de couverture (page 1), encodée en JPEG pour rester légère en base. */
export async function renderThumbnail(
  file: File | ArrayBuffer,
  targetWidth = 220,
): Promise<Blob | null> {
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  let doc: PDFDocumentProxy;
  try {
    doc = await openPdfDocument(data);
  } catch {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    await renderPageToCanvas(doc, 1, canvas, targetWidth);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    });
  } catch {
    return null;
  } finally {
    await doc.destroy();
  }
}
