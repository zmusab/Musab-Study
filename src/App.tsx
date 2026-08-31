import { AnimatePresence } from 'motion/react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/hooks/useTheme';
import { MorePage } from '@/pages/MorePage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ChatPage } from '@/pages/ChatPage';
import { CoursesPage } from '@/pages/CoursesPage';
import { SubjectDetailPage } from '@/pages/SubjectDetailPage';

/**
 * Routage en HashRouter.
 *
 * GitHub Pages n'a pas de réécriture d'URL côté serveur : avec des chemins
 * classiques, ouvrir directement /revisions renverrait une 404. Le hash garde
 * les liens profonds fonctionnels, y compris depuis l'écran d'accueil iOS une
 * fois l'application installée.
 */

function AnimatedRoutes() {
  const location = useLocation();

  return (
    // `mode="wait"` : la page sortante disparaît avant l'entrée de la suivante,
    // sinon la hauteur du document sauterait pendant la transition.
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={
            <PlaceholderPage
              title="Accueil"
              icon="🏠"
              phase="Phase 9"
              description="Le tableau de bord affichera tes cartes dues, la matière à travailler en priorité et tes prochains examens, à partir de tes données réelles."
            />
          }
        />
        <Route path="/cours" element={<CoursesPage />} />
        <Route path="/cours/:subjectId" element={<SubjectDetailPage />} />
        <Route path="/ia" element={<ChatPage />} />
        <Route
          path="/revisions"
          element={
            <PlaceholderPage
              title="Révisions"
              icon="🧠"
              phase="Phase 6"
              description="La session de répétition espacée. L'algorithme est déjà écrit et testé — il attend son interface."
            />
          }
        />
        <Route
          path="/flashcards"
          element={
            <PlaceholderPage
              title="Flashcards"
              icon="🃏"
              phase="Phase 5"
              description="Génération assistée par l'IA carte par carte, bibliothèque, recherche et suivi de maîtrise."
            />
          }
        />
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
        <Route
          path="/anatomie"
          element={
            <PlaceholderPage
              title="Anatomie"
              icon="🫀"
              phase="Phase 12"
              description="Structures anatomiques reliées à tes cours, avec une architecture prête à recevoir un modèle 3D sous licence."
            />
          }
        />
        <Route
          path="/calendrier"
          element={
            <PlaceholderPage
              title="Calendrier"
              icon="📅"
              phase="Phase 8"
              description="Vues jour, semaine et mois, plan de révision avant examen, et export .ics vers Apple Calendar."
            />
          }
        />
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
        <Route
          path="/recherche"
          element={
            <PlaceholderPage
              title="Recherche"
              icon="🔎"
              phase="Phase 10"
              description="Recherche unifiée dans tes cours, notes, cartes, questions et structures anatomiques."
            />
          }
        />
        <Route
          path="/progression"
          element={
            <PlaceholderPage
              title="Progression"
              icon="📊"
              phase="Phase 11"
              description="Maîtrise par matière et par chapitre, taux de réussite, temps étudié et points faibles."
            />
          }
        />
        <Route path="/plus" element={<MorePage />} />
        <Route path="/parametres" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
