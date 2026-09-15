import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { EmptyState } from '@/components/ui';

/**
 * Écran d'une section pas encore construite.
 *
 * Volontairement explicite plutôt que faussement fonctionnel : une section qui
 * fait semblant de marcher coûte plus cher qu'une section qui annonce
 * clairement qu'elle arrive.
 */
export function PlaceholderPage({
  title,
  icon,
  phase,
  description,
}: {
  title: string;
  icon: string;
  phase: string;
  description: string;
}) {
  return (
    <PageTransition>
      <PageHeader title={title} />
      <EmptyState
        icon={icon}
        title={`${phase} — en cours de construction`}
        description={description}
      />
    </PageTransition>
  );
}
