import { Button } from '@/components/ui';
import type { AnatomyStructure } from '@/types';
import type { LearningResult } from '@/services/anatomy/learning';

/**
 * « Mode apprentissage » — volontairement scopé : un vrai mini-jeu « Trouve
 * la structure » construit sur les structures déjà chargées en 3D
 * (`services/anatomy/learning.ts`), PAS le mode apprentissage complet du
 * cahier des charges (progression multi-étapes os→muscles→nerfs→vaisseaux,
 * intégration à la répétition espacée) qui suppose la Phase Quiz, non
 * construite. Aucune question figée n'est inventée : la consigne est
 * toujours le vrai nom d'une structure réelle.
 */
export function LearningModeCard({
  active,
  target,
  result,
  streak,
  onStart,
  onStop,
  onNext,
}: {
  active: boolean;
  target: AnatomyStructure | null;
  result: LearningResult | null;
  streak: number;
  onStart: () => void;
  onStop: () => void;
  onNext: () => void;
}) {
  return (
    <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-3">
      <p className="mb-2 text-[0.85rem] font-semibold text-[var(--ink)]">Mode apprentissage</p>

      {!active ? (
        <>
          <p className="min-h-0 flex-1 overflow-y-auto text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
            Trouve la structure demandée en cliquant directement dans le modèle 3D — parmi les systèmes actuellement
            actifs.
          </p>
          <Button size="sm" onClick={onStart}>
            Commencer
          </Button>
        </>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {target ? (
              <p className="text-[0.9rem] text-[var(--ink)]">
                Trouve : <span className="font-semibold">{target.name}</span>
              </p>
            ) : (
              <p className="text-[0.82rem] text-[var(--ink-faint)]">
                Aucune structure disponible avec les systèmes actifs actuels — active au moins un système avec
                maillage 3D.
              </p>
            )}
            {result && (
              <p className={'mt-2 text-[0.85rem] font-medium ' + (result === 'correct' ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
                {result === 'correct' ? '✅ Correct !' : '❌ Ce n’est pas ça — réessaie.'}
              </p>
            )}
            <p className="mt-2 text-[0.72rem] text-[var(--ink-faint)]">Réussies cette session : {streak}</p>
          </div>
          <div className="flex gap-2">
            {result === 'correct' ? (
              <Button size="sm" onClick={onNext}>
                Question suivante
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onStop}>
                Arrêter
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
