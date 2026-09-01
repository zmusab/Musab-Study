import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icon } from '@/components/ui';
import type { AnatomyStructure, Citation } from '@/types';

/**
 * Intégration cours (§12) — carte pleine.
 *
 * Elle montre l'état RÉEL du lien entre la structure sélectionnée et les
 * cours importés : nombre de passages retrouvés, document et page cliquables.
 * Quand aucune fiche n'a été générée, elle le dit — jamais de source
 * inventée, jamais de compteur décoratif.
 */
export const CourseIntegrationCard = memo(function CourseIntegrationCard({
  structure,
  citations,
  loading,
}: {
  structure: AnatomyStructure | null;
  /** Citations de la fiche « cours » déjà générée pour cette structure. */
  citations: Citation[] | null;
  loading: boolean;
}) {
  const count = citations?.length ?? 0;

  return (
    <section className="anatomy-card">
      <h2 className="anatomy-card-title">Intégration cours</h2>

      {!structure ? (
        <p className="anatomy-card-hint">
          Sélectionne une structure pour voir si elle apparaît dans tes cours importés. Toutes les informations
          affichées viennent de tes PDF, avec la page source cliquable — jamais inventées.
        </p>
      ) : loading ? (
        <p className="anatomy-card-hint">Lecture de tes cours…</p>
      ) : count === 0 ? (
        <p className="anatomy-card-hint">
          Aucune fiche générée depuis tes cours pour{' '}
          <span className="font-medium text-[var(--ink)]">{structure.name}</span>. Ouvre l’onglet « Informations » du
          panneau pour en générer une : les passages utilisés seront listés ici, avec leur page.
        </p>
      ) : (
        <>
          <p className="anatomy-card-hint">
            <span className="font-medium text-[var(--ink)]">{structure.name}</span> — {count} passage
            {count > 1 ? 's' : ''} de tes cours.
          </p>
          <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {citations!.slice(0, 4).map((citation, index) => (
              <li key={`${citation.chunkId}-${index}`}>
                {/* La page peut être absente d'un PDF non paginé : on ne
                    fabrique pas de numéro, le lien ouvre alors le document. */}
                <Link
                  to={citation.page === null ? `/document/${citation.documentId}` : `/document/${citation.documentId}?page=${citation.page}`}
                  className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[0.78rem] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                >
                  <Icon name="notes" size={14} className="shrink-0 text-[var(--ink-faint)]" />
                  <span className="min-w-0 flex-1 truncate">{citation.documentName}</span>
                  <span className="shrink-0 text-[var(--ink-faint)]">
                    {citation.page === null ? 'document' : `p. ${citation.page}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link to="/cours" className="mt-auto self-start">
        <Button size="sm" variant="secondary">
          Voir mes cours →
        </Button>
      </Link>
    </section>
  );
});
