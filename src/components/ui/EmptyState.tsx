import type { ReactNode } from 'react';
import { FadeUp } from '@/components/motion/Motion';

/**
 * État vide. Toujours formulé comme une prochaine action à faire, jamais
 * comme un constat d'absence : « Aucune donnée » n'aide personne à avancer.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <FadeUp className="rounded-[var(--radius-card)] border border-dashed border-[var(--line)] px-6 py-12 text-center">
      {/* `flex justify-center` et pas seulement `text-center` : la preflight
          Tailwind passe les <svg> en `display: block`, un simple
          alignement de texte les laissait collés à gauche. */}
      {icon && <div className="mb-3 flex justify-center text-3xl opacity-70">{icon}</div>}
      <h3 className="text-[1.02rem] mb-1.5">{title}</h3>
      {description && (
        <p className="mx-auto max-w-md text-[0.88rem] leading-relaxed text-[var(--ink-soft)]">
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </FadeUp>
  );
}
