import { memo } from 'react';
import { Button } from '@/components/ui';
import { StructureThumbnail } from './StructureThumbnail';
import { systemOf } from '@/services/anatomy/systemColors';
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
    <section className="anatomy-card">
      <h2 className="anatomy-card-title">Mode isolation</h2>

      {structure ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          {/* Vue anatomique réelle de la structure isolée, rendue depuis son
              maillage — on voit ce qu'on isole avant de regarder le modèle. */}
          <div
            className={
              'flex items-center justify-center rounded-[var(--radius-card)] border p-3 transition-colors ' +
              (isolated ? 'border-[var(--accent)] bg-[var(--accent-tint)]' : 'border-[var(--line)] bg-[var(--surface-2)]')
            }
          >
            <StructureThumbnail structure={structure} size={104} />
          </div>
          <div className="text-center">
            <p className="text-[0.9rem] font-medium leading-snug text-[var(--ink)]">{structure.name}</p>
            {/* Même pastille de système que sur le point du modèle. */}
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[0.72rem] text-[var(--ink-faint)]">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
                style={{ backgroundColor: systemOf(structure).hex }}
              />
              {systemOf(structure).label}
            </p>
            <p className="mt-1 text-[0.78rem] leading-snug text-[var(--ink-faint)]">
              {isolated ? 'Isolée — tout le reste du modèle est masqué.' : 'Sélectionnée. Isole-la pour masquer le reste.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
          <StructureThumbnail structure={null} size={72} />
          <p className="text-[0.88rem] font-medium text-[var(--ink-soft)]">Aucune structure sélectionnée</p>
          <p className="max-w-[22rem] text-[0.78rem] leading-snug text-[var(--ink-faint)]">
            Touche un point du modèle, un résultat de recherche ou une structure de la liste pour l’isoler.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
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
