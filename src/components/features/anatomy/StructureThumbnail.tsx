import { useState } from 'react';
import type { AnatomyStructure } from '@/types';

/**
 * Vignette d'une structure anatomique.
 *
 * L'image est un RENDU DE LA GÉOMÉTRIE RÉELLE de la structure : elle est
 * produite par `scripts/anatomy/build-thumbnails.mjs`, qui rastérise le
 * maillage BodyParts3D d'origine (même correction d'axe et mêmes teintes que
 * le visualiseur 3D). Aucune icône décorative, aucun emoji : ce qui est
 * affiché correspond au maillage qui sera chargé si on ouvre la structure.
 *
 * Une structure qui n'a PAS de maillage (présente dans les cours seulement)
 * n'a volontairement pas de vignette : on affiche alors une pastille neutre
 * annoncée comme telle, jamais un substitut qui laisserait croire à une
 * géométrie inexistante.
 */
export function StructureThumbnail({
  structure,
  size = 28,
  className = '',
}: {
  structure: AnatomyStructure | null;
  size?: number;
  className?: string;
}) {
  // Une vignette manquante sur disque retombe sur la pastille neutre plutôt
  // que sur une image cassée.
  const [failed, setFailed] = useState(false);
  const hasMesh = Boolean(structure?.model3dRef) && !failed;

  const box = `${size}px`;

  if (!hasMesh) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-dashed border-[var(--line)] bg-[var(--surface-2)] ${className}`}
        style={{ width: box, height: box }}
        title="Géométrie 3D non disponible"
        aria-hidden
      >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3.4 20 8v8l-8 4.6L4 16V8Z"
            stroke="var(--ink-faint)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeDasharray="3 2.6"
          />
        </svg>
      </span>
    );
  }

  return (
    <img
      src={`/anatomy/thumbs/${structure!.id}.png`}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-[var(--radius-control)] bg-[var(--surface-2)] object-contain ${className}`}
      style={{ width: box, height: box }}
    />
  );
}
