import { cn } from '@/lib/cn';

/**
 * Indicateur d'attente — animation CSS pure (`animate-spin`), pas pilotée
 * par Framer Motion.
 *
 * Un indicateur JS (`motion.span` + `animate={{ rotate: 360 }}`) dépend du
 * thread principal React/Framer pour redémarrer sa boucle à chaque cycle :
 * un rendu chargé, un onglet remis au premier plan, ou une particularité de
 * Safari peut le figer visuellement — signalé en production sur iPad, alors
 * que l'application travaillait réellement. Une animation CSS `@keyframes`
 * tourne indépendamment de React, dans le moteur de rendu du navigateur :
 * elle ne peut pas se figer pour cette raison. `motion-reduce:` retire la
 * rotation et la remplace par un pouls très lent, sans dépendre d'un hook.
 */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Chargement"
      className={cn(
        'inline-block rounded-full border-2 border-current border-t-transparent opacity-75',
        'motion-safe:animate-spin motion-reduce:animate-pulse',
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}
