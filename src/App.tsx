import { AnimatePresence } from 'motion/react';
import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ConfirmProvider, ToastProvider, Spinner } from '@/components/ui';
import { ThemeProvider } from '@/hooks/useTheme';
import { MorePage } from '@/pages/MorePage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

/**
 * Routage en HashRouter.
 *
 * GitHub Pages et Vercel n'ont pas de réécriture d'URL identique côté serveur :
 * avec des chemins classiques, ouvrir directement /revisions pourrait renvoyer
 * une 404 selon l'hébergeur. Le hash garde les liens profonds fonctionnels
 * partout, y compris depuis l'écran d'accueil iOS une fois l'application
 * installée.
 *
 * Les écrans qui embarquent une dépendance lourde (pdf.js pour les Cours, le
 * SDK Anthropic pour l'IA et le Podcast) sont chargés à la demande : ouvrir
 * l'application pour réviser des flashcards ne doit pas télécharger
 * l'extracteur PDF. `Suspense` affiche un indicateur cohérent avec le reste de
 * l'interface pendant le chargement du code de la page.
 */

const CoursesPage = lazy(() => import('@/pages/CoursesPage').then((m) => ({ default: m.CoursesPage })));
const SubjectDetailPage = lazy(() =>
  import('@/pages/SubjectDetailPage').then((m) => ({ default: m.SubjectDetailPage })),
);
const ChatPage = lazy(() => import('@/pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const PodcastPage = lazy(() => import('@/pages/PodcastPage').then((m) => ({ default: m.PodcastPage })));
const PodcastEpisodePage = lazy(() =>
  import('@/pages/PodcastEpisodePage').then((m) => ({ default: m.PodcastEpisodePage })),
);
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const FlashcardsPage = lazy(() =>
  import('@/pages/FlashcardsPage').then((m) => ({ default: m.FlashcardsPage })),
);
const RecherchePage = lazy(() =>
  import('@/pages/RecherchePage').then((m) => ({ default: m.RecherchePage })),
);
const RevisionsPage = lazy(() =>
  import('@/pages/RevisionsPage').then((m) => ({ default: m.RevisionsPage })),
);
const PdfViewerPage = lazy(() =>
  import('@/pages/PdfViewerPage').then((m) => ({ default: m.PdfViewerPage })),
);
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })));
const AnatomyPage = lazy(() => import('@/pages/AnatomyPage').then((m) => ({ default: m.AnatomyPage })));
const ProgressionPage = lazy(() =>
  import('@/pages/ProgressionPage').then((m) => ({ default: m.ProgressionPage })),
);
const CalendarPage = lazy(() => import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-[var(--ink-faint)]">
      <Spinner size={22} />
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    // `mode="wait"` : la page sortante disparaît avant l'entrée de la suivante,
    // sinon la hauteur du document sauterait pendant la transition.
    <AnimatePresence mode="wait" initial={false}>
      <Suspense fallback={<RouteFallback />}>
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<HomePage />} />
          <Route path="/cours" element={<CoursesPage />} />
          <Route path="/cours/:subjectId" element={<SubjectDetailPage />} />
          <Route path="/document/:documentId" element={<PdfViewerPage />} />
          <Route path="/ia" element={<ChatPage />} />
          <Route path="/revisions" element={<RevisionsPage />} />
          <Route path="/flashcards" element={<FlashcardsPage />} />
          <Route
            path="/quiz"
            element={
              <PlaceholderPage
                title="Quiz"
                icon="❓"
                phase="Phase 7"
                description="Quiz paramétrable par matière, chapitre, nombre de questions, type et difficulté."
              />
            }
          />
          <Route path="/podcast" element={<PodcastPage />} />
          <Route path="/podcast/:episodeId" element={<PodcastEpisodePage />} />
          <Route path="/progression" element={<ProgressionPage />} />
          <Route path="/anatomie" element={<AnatomyPage />} />
          <Route path="/calendrier" element={<CalendarPage />} />
          <Route
            path="/notes"
            element={
              <PlaceholderPage
                title="Notes"
                icon="📝"
                phase="Phase 10"
                description="Notes liées à une matière et à un chapitre, avec recherche."
              />
            }
          />
          <Route path="/recherche" element={<RecherchePage />} />
          <Route path="/plus" element={<MorePage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AnimatePresence>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <HashRouter>
            <AppShell>
              <AnimatedRoutes />
            </AppShell>
          </HashRouter>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
