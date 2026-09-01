import { memo } from 'react';
import { Button } from '@/components/ui';
import { StructureThumbnail } from './StructureThumbnail';
import type { AnatomyStructure } from '@/types';

/**
 * Mode isolation (§9) — carte pleine, pas un onglet.
 *
 * La vignette est un RENDU du maillage réel de la structure isolée : on voit
 * ce qu'on isole avant même de regarder le modèle. Une structure sans
 * géométrie affiche la pastille neutre, jamais une image de remplacement.
 */
export const IsolationCard = memo(function IsolationCard({
  structure,
  isolated,
  onIsolate,
  onRestore,
  onResetView,
}: {
  structure: AnatomyStructure | null;
  isolated: boolean;
  onIsolate: () => void;
  onRestore: () => void;
  onResetView: () => void;
}) {
  return (
    <section className="surface-card flex flex-col gap-3 p-4">
      <h2 className="text-[0.95rem] font-semibold text-[var(--ink)]">Mode isolation</h2>

      <div className="flex items-start gap-3">
        <StructureThumbnail structure={structure} size={64} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.88rem] font-medium leading-snug text-[var(--ink)]">
            {structure ? structure.name : 'Aucune structure sélectionnée'}
          </p>
          <p className="mt-1 text-[0.78rem] leading-snug text-[var(--ink-faint)]">
            {isolated && structure
              ? 'Isolée — tout le reste du modèle est masqué.'
              : structure
                ? 'Sélectionnée. Isole-la pour masquer tout le reste.'
                : 'Touche un point du modèle, un résultat de recherche ou une structure de la liste.'}
          </p>
        </div>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2">
        <Button size="sm" disabled={!structure || isolated} onClick={onIsolate}>
          Isoler la sélection
        </Button>
        <Button size="sm" variant="secondary" disabled={!structure || isolated} onClick={onIsolate}>
          Masquer le reste
        </Button>
        <Button size="sm" variant="secondary" disabled={!isolated} onClick={onRestore}>
          Restaurer
        </Button>
        <Button size="sm" variant="ghost" onClick={onResetView}>
          Réinitialiser la vue
        </Button>
      </div>
    </section>
  );
});
