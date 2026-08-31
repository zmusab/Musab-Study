import { Button } from '@/components/ui';

/** Isoler/Restaurer (§17) — la logique de masquage vit dans `services/anatomy/visibility.ts`, ce composant ne fait que déclencher l'état. */
export function IsolationControls({
  hasSelection,
  isolated,
  onIsolate,
  onRestore,
}: {
  hasSelection: boolean;
  isolated: boolean;
  onIsolate: () => void;
  onRestore: () => void;
}) {
  if (!hasSelection && !isolated) return null;
  return (
    <div className="flex items-center gap-2">
      {isolated ? (
        <Button size="sm" variant="secondary" onClick={onRestore}>
          Restaurer
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={onIsolate} disabled={!hasSelection}>
          Isoler
        </Button>
      )}
    </div>
  );
}
