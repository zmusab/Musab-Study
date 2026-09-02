import { Button, Modal } from '@/components/ui';
import type { SeriesScope } from '@/data/repositories/calendar';

/**
 * PORTÉE D'UNE MODIFICATION SUR UN ÉVÉNEMENT RÉCURRENT.
 *
 * Une récurrence est une série : changer son horaire peut vouloir dire trois
 * choses très différentes. Les deviner à la place de l'utilisateur serait le
 * meilleur moyen de lui effacer un semestre — on demande.
 *
 * « Cette occurrence et les suivantes » ne touche jamais au passé : ce qui a
 * déjà eu lieu reste tel qu'il a eu lieu.
 */
const OPTIONS: { scope: SeriesScope; label: string; hint: string }[] = [
  {
    scope: 'occurrence',
    label: 'Uniquement cette occurrence',
    hint: 'Le reste de la série ne bouge pas.',
  },
  {
    scope: 'following',
    label: 'Cette occurrence et les suivantes',
    hint: 'Les occurrences passées restent inchangées.',
  },
  { scope: 'series', label: 'Toute la série', hint: 'Du premier au dernier.' },
];

export function SeriesScopeModal({
  open,
  title,
  description,
  destructive = false,
  onClose,
  onChoose,
}: {
  open: boolean;
  title: string;
  description: string;
  destructive?: boolean;
  onClose: () => void;
  onChoose: (scope: SeriesScope) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Annuler
        </Button>
      }
    >
      <div className="flex flex-col gap-2" data-series-scope>
        {OPTIONS.map((option) => (
          <button
            key={option.scope}
            type="button"
            onClick={() => onChoose(option.scope)}
            data-series-scope-option={option.scope}
            data-touch-target
            className="rounded-[var(--radius-card)] border border-[var(--line)] p-3 text-left transition-colors hover:bg-[var(--surface-2)]"
          >
            <span
              className="block text-[0.92rem] font-medium"
              style={destructive ? { color: 'var(--danger)' } : undefined}
            >
              {option.label}
            </span>
            <span className="mt-0.5 block text-[0.8rem] leading-relaxed text-[var(--ink-faint)]">
              {option.hint}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
