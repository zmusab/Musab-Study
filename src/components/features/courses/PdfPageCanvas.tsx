import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Spinner } from '@/components/ui';
import { renderPageToCanvas } from '@/services/pdf/render';

/**
 * Une page du lecteur, rendue à la demande.
 *
 * Rendre les 300 canevas d'un cours entier au chargement saturerait la
 * mémoire de Safari iPad en quelques secondes. `IntersectionObserver`
 * ne déclenche le rendu réel que pour les pages qui entrent dans une large
 * marge autour de l'écran (`rootMargin`), et le relâche (canevas vidé) une
 * fois la page repassée loin hors champ — le placeholder garde la hauteur
 * exacte, donc le défilement ne saute jamais.
 */
export function PdfPageCanvas({
  doc,
  pageNumber,
  targetWidth,
  registerRef,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  targetWidth: number;
  registerRef?: (pageNumber: number, el: HTMLDivElement | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    registerRef?.(pageNumber, el);

    // Marge large et déclencheur binaire : cet observer sert UNIQUEMENT à
    // décider quand rendre le canevas à l'avance, pas à savoir quelle page
    // est réellement affichée (voir le suivi par défilement dans
    // PdfViewerPage — un ratio d'intersection sur une marge aussi généreuse
    // rapporterait presque 100 % pour toutes les pages d'un document court).
    const observer = new IntersectionObserver(
      (entries) => setNearViewport(entries[0]!.isIntersecting),
      { rootMargin: '800px 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      registerRef?.(pageNumber, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

  useEffect(() => {
    if (!nearViewport || !canvasRef.current) return undefined;
    let cancelled = false;
    setRendered(false);

    void renderPageToCanvas(doc, pageNumber, canvasRef.current, targetWidth).then(() => {
      if (cancelled || !canvasRef.current) return;
      setAspect(canvasRef.current.height / canvasRef.current.width);
      setRendered(true);
    });

    return () => {
      cancelled = true;
    };
  }, [nearViewport, doc, pageNumber, targetWidth]);

  const height = aspect ? targetWidth * aspect : targetWidth * 1.414; // ratio A4 par défaut, avant le premier rendu

  return (
    <div
      ref={containerRef}
      data-page={pageNumber}
      className="relative mx-auto flex items-center justify-center overflow-hidden rounded-[var(--radius-card)] bg-white shadow-[var(--shadow-soft)]"
      style={{ width: targetWidth, height }}
    >
      {nearViewport ? (
        <canvas ref={canvasRef} className="block max-w-full" />
      ) : (
        <span className="text-[0.78rem] text-[var(--ink-faint)]">Page {pageNumber}</span>
      )}
      {nearViewport && !rendered && (
        <span className="absolute inset-0 flex items-center justify-center bg-white/60">
          <Spinner size={20} />
        </span>
      )}
    </div>
  );
}
