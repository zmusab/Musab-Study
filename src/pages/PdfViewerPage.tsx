import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button, EmptyState, Icon, Spinner } from '@/components/ui';
import { PdfPageCanvas } from '@/components/features/courses/PdfPageCanvas';
import { PdfSearchPanel } from '@/components/features/courses/PdfSearchPanel';
import { PdfAiPanel } from '@/components/features/courses/PdfAiPanel';
import { NotesPanel } from '@/components/features/courses/NotesPanel';
import { springSoft } from '@/components/motion/transitions';
import { db } from '@/data/db';
import { getDocumentFile, recordDocumentOpened, updateLastReadPage } from '@/data/repositories/documents';
import { openPdfDocument } from '@/services/pdf/render';
import { useProfile } from '@/hooks/useProfile';
import { useDocumentNotes } from '@/hooks/useNotes';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const MAX_PAGE_WIDTH = 900;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(a: React.Touch, b: React.Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Le lecteur PDF — la COUCHE DOCUMENT.
 *
 * Le PDF original s'ouvre ici, intact, avec ses pages telles quelles. Rien
 * dans cet écran ne montre le texte extrait : c'est délibéré, l'extraction
 * n'existe que pour l'IA (voir PdfAiPanel), jamais comme substitut de lecture.
 */
export function PdfViewerPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const profile = useProfile();
  const [searchParams] = useSearchParams();

  const doc = useLiveQuery(
    async () => (documentId ? ((await db.documents.get(documentId)) ?? null) : null),
    [documentId],
  );

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileMissing, setFileMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const readerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const hasJumpedRef = useRef(false);
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const [baseWidth, setBaseWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [panel, setPanel] = useState<'search' | 'ai' | 'notes' | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const notes = useDocumentNotes(documentId);

  // Marque le document comme consulté — alimente « Continuer mes cours » sur
  // l'accueil, indépendamment de la présence ou non du PDF original.
  useEffect(() => {
    if (documentId) void recordDocumentOpened(documentId);
  }, [documentId]);

  // Ouvre le PDF original (pas le texte) dès que le blob est disponible.
  useEffect(() => {
    if (!documentId) return undefined;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;

    setPdfDoc(null);
    setFileMissing(false);
    setLoadError(null);

    void (async () => {
      const file = await getDocumentFile(documentId);
      if (!file) {
        if (!cancelled) setFileMissing(true);
        return;
      }
      try {
        const buffer = await file.blob.arrayBuffer();
        opened = await openPdfDocument(buffer);
        if (!cancelled) setPdfDoc(opened);
        else await opened.destroy();
      } catch {
        if (!cancelled) setLoadError("Ce PDF n'a pas pu être ouvert.");
      }
    })();

    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [documentId]);

  // Largeur de page disponible, recalculée si l'écran tourne (iPad portrait/paysage).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setBaseWidth(Math.min(width - 24, MAX_PAGE_WIDTH));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  const targetWidth = Math.round(baseWidth * zoom);

  // Amortit la largeur transmise au RENDU (pas à la mise en page) : un
  // pincement à deux doigts déclenche `setZoom` à chaque frame, et redessiner
  // chaque page visible à pleine résolution 60 fois par seconde serait
  // franchement perceptible comme une lenteur sur iPad. La carte elle-même
  // suit `targetWidth` en direct pour un retour visuel fluide ; seul le
  // rendu pdf.js — le vrai coût — attend que le geste se stabilise.
  const [renderWidth, setRenderWidth] = useState(targetWidth);
  useEffect(() => {
    const timer = window.setTimeout(() => setRenderWidth(targetWidth), 150);
    return () => window.clearTimeout(timer);
  }, [targetWidth]);

  const registerPageRef = (pageNumber: number, el: HTMLDivElement | null) => {
    if (el) pageRefs.current.set(pageNumber, el);
    else pageRefs.current.delete(pageNumber);
  };

  const jumpToPage = (pageNumber: number) => {
    pageRefs.current.get(pageNumber)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Détermine la page « courante » par sa position réelle à l'écran plutôt
  // que par un ratio d'intersection à marge large (qui rapporterait ~100 %
  // pour toutes les pages d'un document court, rendant le résultat
  // arbitraire) : la page dont le haut est le plus proche du haut de la zone
  // de défilement est celle qu'on considère affichée.
  const updateCurrentPageFromScroll = () => {
    const containerTop = scrollRef.current?.getBoundingClientRect().top;
    if (containerTop === undefined) return;
    let best: number | null = null;
    let bestDistance = Infinity;
    for (const [pageNumber, el] of pageRefs.current) {
      const distance = Math.abs(el.getBoundingClientRect().top - containerTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = pageNumber;
      }
    }
    if (best !== null) setCurrentPage((current) => (current === best ? current : best!));
  };

  const onScroll = () => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateCurrentPageFromScroll();
    });
  };

  // Reprise de lecture / lien profond : une fois le PDF ouvert et les pages
  // montées, on saute directement à la page demandée — sans animation, un
  // défilement fluide sur 80 pages donnerait juste une longue attente.
  useEffect(() => {
    if (hasJumpedRef.current || !pdfDoc || !doc) return;
    hasJumpedRef.current = true;
    const paramPage = Number(searchParams.get('page'));
    const target =
      paramPage > 0 && paramPage <= (doc.pageCount ?? paramPage)
        ? paramPage
        : Math.max(1, doc.lastReadPage || 1);
    requestAnimationFrame(() => {
      pageRefs.current.get(target)?.scrollIntoView({ behavior: 'auto', block: 'start' });
      setCurrentPage(target);
    });
  }, [pdfDoc, doc, searchParams]);

  // Mémorise la position, avec un léger différé pour ne pas écrire à chaque frame de défilement.
  useEffect(() => {
    if (!documentId || !hasJumpedRef.current) return;
    const timer = window.setTimeout(() => {
      void updateLastReadPage(documentId, currentPage);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [documentId, currentPage]);

  const zoomIn = () => setZoom((z) => clamp(Math.round((z + 0.15) * 100) / 100, MIN_ZOOM, MAX_ZOOM));
  const zoomOut = () => setZoom((z) => clamp(Math.round((z - 0.15) * 100) / 100, MIN_ZOOM, MAX_ZOOM));

  // Écoute le changement d'état plein écran plutôt que de ne se fier qu'au
  // clic : l'utilisateur peut sortir du plein écran avec Échap ou un geste
  // système, sans repasser par le bouton.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === readerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Dégradation silencieuse : si l'API plein écran n'existe pas (Safari iOS ne
  // l'expose pas sur <div>), le bouton n'apparaît simplement pas — voir plus bas.
  //
  // C'est TOUTE la page lecteur (header compris) qui passe en plein écran, pas
  // seulement la zone de défilement : le navigateur affiche l'élément demandé
  // par-dessus tout le reste, sans exception de z-index — mettre en plein
  // écran uniquement la zone de pages aurait rendu le bouton « quitter » et
  // « retour » du header inatteignables une fois entré.
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await readerRef.current?.requestFullscreen();
      }
    } catch {
      // Refusé par le navigateur — rien à faire, le bouton reste inerte visuellement en retombant sur son état précédent.
    }
  };

  const onTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length === 2) {
      pinchRef.current = { startDist: touchDistance(event.touches[0]!, event.touches[1]!), startZoom: zoom };
    }
  };
  const onTouchMove = (event: React.TouchEvent) => {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      const dist = touchDistance(event.touches[0]!, event.touches[1]!);
      const ratio = dist / pinchRef.current.startDist;
      setZoom(clamp(pinchRef.current.startZoom * ratio, MIN_ZOOM, MAX_ZOOM));
    }
  };
  const onTouchEnd = () => {
    pinchRef.current = null;
  };

  const pageNumbers = useMemo(
    () => (doc?.pageCount ? Array.from({ length: doc.pageCount }, (_, i) => i + 1) : []),
    [doc?.pageCount],
  );

  if (doc === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState
          icon={<Icon name="courses" size={30} />}
          title="Document introuvable"
          description="Il a peut-être été supprimé."
          action={<Button onClick={() => navigate('/cours')}>Retour aux cours</Button>}
        />
      </div>
    );
  }

  if (doc === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  return (
    <div ref={readerRef} className="fixed inset-0 z-20 flex flex-col bg-[var(--bg)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-elevated)] px-3 py-2.5 pt-safe">
        <Link
          to={`/cours/${doc.subjectId}`}
          aria-label="Retour aux cours"
          data-touch-target
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="chevronLeft" size={18} />
        </Link>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.92rem] font-medium">{doc.name}</p>
          {doc.pageCount !== null && (
            <p className="text-[0.72rem] text-[var(--ink-faint)]">
              Page {currentPage} / {doc.pageCount}
            </p>
          )}
        </div>

        {doc.pageOffsets.length > 0 && (
          <>
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Zoom arrière"
              data-touch-target
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)] disabled:opacity-40"
            >
              <Icon name="zoomOut" size={17} />
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Zoom avant"
              data-touch-target
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)] disabled:opacity-40"
            >
              <Icon name="zoomIn" size={17} />
            </button>
            <button
              type="button"
              onClick={() => setPanel((p) => (p === 'search' ? null : 'search'))}
              aria-label="Rechercher dans ce PDF"
              data-touch-target
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
            >
              <Icon name="search" size={17} />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setPanel((p) => (p === 'notes' ? null : 'notes'))}
          aria-label="Mes notes"
          data-touch-target
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="notes" size={17} />
          {notes && notes.length > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[0.6rem] font-semibold leading-none text-white">
              {notes.length}
            </span>
          )}
        </button>
        {typeof document !== 'undefined' && document.fullscreenEnabled && (
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
            data-touch-target
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
          >
            <Icon name={isFullscreen ? 'fullscreenExit' : 'fullscreen'} size={17} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setPanel((p) => (p === 'ai' ? null : 'ai'))}
          aria-label="Assistant IA"
          data-touch-target
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="sparkles" size={17} />
        </button>
      </header>

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
      >
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="h-full overflow-y-auto scroll-contain px-3 py-4"
        >
          {fileMissing ? (
            doc.text.length > 0 ? (
              <div className="mx-auto max-w-2xl">
                <EmptyState
                  icon={<Icon name="courses" size={28} />}
                  title={doc.source === 'paste' ? 'Document collé, pas de PDF' : 'PDF non disponible'}
                  description={
                    doc.source === 'paste'
                      ? "Ce document a été ajouté par copier-coller : il n'y a pas de fichier PDF à afficher, seulement le texte."
                      : "Le fichier PDF original n'est pas disponible pour ce document (import antérieur au lecteur intégré, ou restauré depuis une sauvegarde — qui ne contient jamais les PDF, trop volumineux). Voici le texte extrait."
                  }
                />
                <div className="surface-card mt-4 whitespace-pre-wrap p-5 text-[0.92rem] leading-relaxed">
                  {doc.text}
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Icon name="courses" size={28} />}
                title="Aucun contenu disponible"
                description="Ni PDF ni texte n'ont été conservés pour ce document."
              />
            )
          ) : loadError ? (
            <EmptyState icon={<Icon name="courses" size={28} />} title="Erreur" description={loadError} />
          ) : !pdfDoc ? (
            <div className="flex items-center justify-center py-24">
              <Spinner size={22} />
            </div>
          ) : (
            <div className="flex flex-col gap-4 pb-8">
              {pageNumbers.map((pageNumber) => (
                <PdfPageCanvas
                  key={pageNumber}
                  doc={pdfDoc}
                  pageNumber={pageNumber}
                  boxWidth={targetWidth}
                  renderWidth={renderWidth}
                  registerRef={registerPageRef}
                />
              ))}
            </div>
          )}
        </div>

        <AnimatePresence>
          {panel && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={springSoft}
              className="absolute inset-y-0 right-0 z-10 w-full border-l border-[var(--line)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lift)] sm:w-96"
            >
              {panel === 'search' ? (
                <PdfSearchPanel
                  text={doc.text}
                  pageOffsets={doc.pageOffsets}
                  onJumpToPage={(page) => {
                    jumpToPage(page);
                    setPanel(null);
                  }}
                  onClose={() => setPanel(null)}
                />
              ) : panel === 'notes' ? (
                <NotesPanel
                  subjectId={doc.subjectId}
                  chapterId={doc.chapterId}
                  documentId={doc.id}
                  currentPage={currentPage}
                  onJumpToPage={(page) => {
                    jumpToPage(page);
                    setPanel(null);
                  }}
                  onClose={() => setPanel(null)}
                />
              ) : (
                <PdfAiPanel
                  subjectId={doc.subjectId}
                  chapterId={doc.chapterId}
                  documentId={doc.id}
                  currentPage={currentPage}
                  program={profile.program || 'dentisterie'}
                  onJumpToPage={jumpToPage}
                  onClose={() => setPanel(null)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
