import { Button } from '@/components/ui';
import { StructureThumbnail } from './StructureThumbnail';
import { subregionMeta } from '@/services/anatomy/regions';
import type { AnatomyStructure } from '@/types';
import type { LearningResult } from '@/services/anatomy/learning';

const SYSTEM_LABEL: Record<AnatomyStructure['category'], string> = {
  squelette: 'os',
  muscles: 'muscle',
  nerfs: 'structure nerveuse',
  vaisseaux: 'vaisseau',
  organes: 'organe',
};

/**
 * « Mode apprentissage » — volontairement scopé : un vrai mini-jeu « Trouve
 * la structure » construit sur les structures déjà chargées en 3D
 * (`services/anatomy/learning.ts`), PAS le mode apprentissage complet du
 * cahier des charges (progression multi-étapes os→muscles→nerfs→vaisseaux,
 * intégration à la répétition espacée) qui suppose la Phase Quiz, non
 * construite. Aucune question figée n'est inventée : la consigne est
 * toujours le vrai nom d'une structure réelle.
 *
 * La correction principale se joue SUR LE MODÈLE 3D (la bonne structure
 * passe au vert avec une coche, une réponse erronée au rouge avec une
 * croix — voir `computeVisibility` et `MarkerOverlay`). Cette carte n'est
 * que le rappel écrit : elle nomme la bonne structure et la situe, en
 * n'utilisant que des informations réellement présentes au catalogue.
 */
export function LearningModeCard({
  active,
  target,
  answered,
  result,
  streak,
  candidateCount,
  onStart,
  onStop,
  onNext,
}: {
  active: boolean;
  /** Nombre de structures réellement chargées et interrogeables. */
  candidateCount: number;
  target: AnatomyStructure | null;
  /** Structure réellement cliquée — non nulle seulement après une réponse. */
  answered: AnatomyStructure | null;
  result: LearningResult | null;
  streak: number;
  onStart: () => void;
  onStop: () => void;
  onNext: () => void;
}) {
  const place = subregionMeta(target?.subregion ?? null);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

      {!active ? (
        <>
          <p className="anatomy-card-hint">
            Trouve la structure demandée en cliquant directement dans le modèle 3D, parmi les systèmes actifs. La
            correction s’affiche sur le modèle : la bonne structure passe au vert, une erreur au rouge.
          </p>
          {/* Information RÉELLE plutôt qu'un vide : le nombre de structures
              actuellement chargées est exactement le vivier de questions. */}
          <div className="mt-auto flex flex-col gap-3">
            <div className="rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3 py-2.5">
              <p className="text-[0.78rem] text-[var(--ink-soft)]">
                <span className="font-semibold text-[var(--ink)]">{candidateCount}</span> structure
                {candidateCount > 1 ? 's' : ''} chargée{candidateCount > 1 ? 's' : ''} peuvent être demandées.
              </p>
              <p className="mt-0.5 text-[0.72rem] text-[var(--ink-faint)]">
                Ouvre une autre région ou active un système pour élargir le tirage.
              </p>
            </div>
            <Button onClick={onStart} disabled={candidateCount === 0}>
              Commencer
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {target ? (
              <p className="text-[0.84rem] leading-snug text-[var(--ink)]">
                Trouve : <span className="font-semibold">{target.name}</span>
              </p>
            ) : (
              <p className="text-[0.82rem] text-[var(--ink-faint)]">
                Aucune structure disponible avec les systèmes actifs actuels — active au moins un système avec
                maillage 3D.
              </p>
            )}

            {result === 'correct' && target && (
              <div className="mt-1.5 flex items-start gap-2 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--success)_14%,transparent)] p-2">
                <StructureThumbnail structure={target} size={26} />
                <p className="text-[0.74rem] leading-snug text-[var(--ink)]">
                  <span className="font-semibold text-[var(--success)]">Correct</span> — c’est bien {target.name}, en
                  vert sur le modèle.
                </p>
              </div>
            )}

            {result === 'wrong' && target && (
              <div className="mt-1.5 flex flex-col gap-1.5">
                {answered && (
                  <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] p-2">
                    <StructureThumbnail structure={answered} size={26} />
                    <p className="text-[0.74rem] leading-snug text-[var(--ink)]">
                      <span className="font-semibold text-[var(--danger)]">Ce n’est pas ça</span> — tu as cliqué sur{' '}
                      {answered.name} (en rouge sur le modèle).
                    </p>
                  </div>
                )}
                <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--success)_14%,transparent)] p-2">
                  <StructureThumbnail structure={target} size={26} />
                  <p className="text-[0.74rem] leading-snug text-[var(--ink)]">
                    <span className="font-semibold text-[var(--success)]">La bonne réponse</span> est {target.name}
                    {target.latinName ? <> ({target.latinName})</> : null} — {SYSTEM_LABEL[target.category]}
                    {place ? <> de la région « {place.label} »</> : null}. Elle est en vert sur le modèle.
                  </p>
                </div>
              </div>
            )}

            <p className="mt-1.5 text-[0.7rem] text-[var(--ink-faint)]">Réussies cette session : {streak}</p>
          </div>
          <div className="flex shrink-0 gap-2 pt-1.5">
            {result ? (
              <>
                <Button size="sm" onClick={onNext}>
                  Question suivante
                </Button>
                <Button size="sm" variant="ghost" onClick={onStop}>
                  Arrêter
                </Button>
              </>
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
