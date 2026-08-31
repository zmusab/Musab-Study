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

/**
 * Plafond appliqué à `devicePixelRatio` pour le rendu. Sans lui, un iPhone
 * Pro (DPR 3) forcerait un canevas 9× plus lourd en pixels qu'un rendu à
 * densité 1 — un coût réel en temps de rendu et en mémoire pour un gain de
 * netteté imperceptible au-delà de la densité Retina standard de l'iPad.
 */
const MAX_RENDER_DPR = 2;

/**
 * Rend une page sur un canevas à la largeur CSS cible, à la densité de
 * l'écran (`devicePixelRatio`) plutôt qu'à la résolution CSS brute.
 *
 * Sans ce facteur, le canevas contient exactement autant de pixels que sa
 * taille affichée en CSS : net sur un écran à densité 1, mais flou sur tout
 * écran Retina — précisément parce que le navigateur doit alors agrandir un
 * bitmap plus petit que sa taille d'affichage réelle. C'est ce qui rendait le
 * PDF visiblement moins net que le fichier source sur iPad.
 */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetWidth: number,
): Promise<number> {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR);
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = (targetWidth * dpr) / base.width;
  const viewport = page.getViewport({ scale });

  // `Math.round` : un canevas à taille fractionnaire force certains
  // navigateurs (Safari iPad inclus) à le redessiner flou.
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  // La taille CSS reste celle voulue par la mise en page — seule la densité
  // du bitmap change. Sans ces deux lignes, le canevas s'afficherait `dpr`
  // fois trop grand (sa taille CSS suit ses attributs `width`/`height` par
  // défaut, qui viennent d'être multipliés par la densité).
  canvas.style.width = `${targetWidth}px`;
  canvas.style.height = `${Math.round(viewport.height / dpr)}px`;

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
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86);
    });
  } catch {
    return null;
  } finally {
    await doc.destroy();
  }
}
