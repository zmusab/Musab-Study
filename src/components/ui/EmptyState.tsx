import type { ReactNode } from 'react';
import { FadeUp } from '@/components/motion/Motion';

/**
 * État vide. Toujours formulé comme une prochaine action à faire, jamais
 * comme un constat d'absence : « Aucune donnée » n'aide personne à avancer.
 *
 * Ce n'est plus une grande boîte en pointillés. Un rectangle tireté de la
 * largeur de la page, posé sur un écran par ailleurs presque vide, ressemble à
 * une zone de dépôt de fichier ou à un composant qui n'a pas fini de charger —
 * pas à une invitation. C'est désormais une composition centrée : une
 * notation scientifique en filigrane, l'icône, le titre, la phrase, l'action.
 * Aucune bordure : le vide autour suffit à isoler le bloc.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  /**
   * Filigrane — une formule réelle en rapport avec l'écran. Purement
   * décoratif, donc `aria-hidden` et jamais porteur d'information.
   */
  mark,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  mark?: string;
}) {
  return (
    <FadeUp className="relative overflow-hidden px-6 py-14 text-center">
      {/*
        Le filigrane est posé DERRIÈRE L'ICÔNE, en haut — pas au centre. Centré,
        il traversait le titre et la phrase : deux textes superposés, tous deux
        moins lisibles. En haut il occupe la seule zone vide du bloc.
      */}
      {mark && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-3 select-none whitespace-nowrap font-serif text-[2.6rem] italic leading-none text-[var(--ink)] opacity-[0.06] sm:text-[3.4rem]"
        >
          {mark}
        </span>
      )}

      <div className="relative">
        {/* `flex justify-center` et pas seulement `text-center` : la preflight
            Tailwind passe les <svg> en `display: block`, un simple
            alignement de texte les laissait collés à gauche. */}
        {icon && (
          <div className="mb-4 flex justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--ink-soft)]">
              {icon}
            </span>
          </div>
        )}
        <h3 className="mb-2 text-[1.15rem]">{title}</h3>
        {description && (
          <p className="mx-auto max-w-sm text-[0.88rem] leading-relaxed text-[var(--ink-soft)]">
            {description}
          </p>
        )}
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </FadeUp>
  );
}
