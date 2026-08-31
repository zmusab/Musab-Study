import { Link } from 'react-router-dom';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { Stagger, StaggerItem } from '@/components/motion/Motion';
import { NAV_ENTRIES } from '@/components/layout/navigation';
import { Icon } from '@/components/ui/Icon';

/**
 * Sommaire complet, accessible depuis l'onglet « Plus » du téléphone.
 * Sur grand écran, le rail latéral rend cette page inutile mais elle reste
 * atteignable — une destination ne doit jamais devenir inaccessible.
 */
export function MorePage() {
  return (
    <PageTransition>
      <PageHeader title="Toutes les sections" />
      <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {NAV_ENTRIES.map((entry) => (
          <StaggerItem key={entry.to}>
            <Link
              to={entry.to}
              className="surface-card flex h-full flex-col gap-2 p-4 transition-colors duration-150 hover:bg-[var(--surface-hover)]"
            >
              <Icon name={entry.icon} size={24} className="text-[var(--accent)]" />
              <span className="text-[0.9rem] font-semibold">{entry.label}</span>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </PageTransition>
  );
}
