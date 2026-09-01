import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'motion/react';
import { Icon } from '@/components/ui';
import { StructureThumbnail } from './StructureThumbnail';
import { groupBySystem, type SystemKey } from '@/services/anatomy/systemColors';
import type { AnatomyStructure, ID } from '@/types';

/**
 * CATALOGUE DES STRUCTURES d'une sous-région — complet, mais progressif.
 *
 * Deux exigences qui se contredisent en apparence :
 *  - TOUT ce que la sous-région contient réellement doit rester atteignable,
 *    rien n'est retiré pour raccourcir la liste ;
 *  - une liste plate de cinquante lignes n'est pas lisible.
 *
 * D'où : les structures sont regroupées par SYSTÈME (os, dents, muscles,
 * système nerveux, artères, veines, organes), chaque groupe se replie, et
 * l'affichage démarre sur une sélection compacte que « Voir plus » étend.
 * La carte grandit alors et la page s'allonge — c'est assumé : une page qui
 * défile vaut mieux qu'une liste tronquée.
 *
 * Les pastilles reprennent la palette partagée avec le convertisseur 3D : la
 * teinte d'un groupe est littéralement celle de ses maillages à l'écran.
 */

/** Groupes listés tant que « Voir plus » n'a pas été pressé. */
const COMPACT_GROUPS = 2;
/** Structures listées par groupe ouvert dans l'état compact. */
const COMPACT_PER_GROUP = 5;
/** Plafond du décalage de cascade : au-delà, l'attente se verrait. */
const MAX_STAGGER = 12;
/** Durée totale de la cascade de sortie — alignée sur `.anatomy-reveal-out`. */
const COLLAPSE_MS = 280;

interface DisplayGroup {
  key: SystemKey;
  label: string;
  hex: string;
  /** Toutes les structures du groupe — le compte affiché est celui-ci. */
  all: AnatomyStructure[];
  /** Celles réellement listées dans l'état courant. */
  visible: AnatomyStructure[];
  /** Celles listées dans l'état COMPACT — sert à savoir lesquelles sont nouvelles. */
  compactCount: number;
  open: boolean;
  /** Le groupe n'existe pas du tout dans l'état compact. */
  isExtra: boolean;
}

export function StructureCatalogue({
  structures,
  selectedId,
  onSelectStructure,
}: {
  /** Doit être une référence STABLE : le catalogue s'y réinitialise. */
  structures: AnatomyStructure[];
  selectedId: ID | null;
  onSelectStructure: (id: ID) => void;
}) {
  const reducedMotion = useReducedMotion();
  const groups = useMemo(() => groupBySystem(structures), [structures]);

  const [expanded, setExpanded] = useState(false);
  /** Vrai pendant la cascade de sortie : les lignes partantes restent montées. */
  const [collapsing, setCollapsing] = useState(false);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<SystemKey>>(() => defaultOpen(groups));
  const collapseTimer = useRef<number | null>(null);

  // Changer de sous-région repart de l'état compact : hériter d'une liste
  // déroulée d'une autre région n'aurait aucun sens.
  useEffect(() => {
    setExpanded(false);
    setCollapsing(false);
    setOpenKeys(defaultOpen(groups));
  }, [groups]);

  useEffect(
    () => () => {
      if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    },
    [],
  );

  const build = (open: boolean): DisplayGroup[] =>
    groups.slice(0, open ? groups.length : COMPACT_GROUPS).map((group, index) => {
      const isOpen = openKeys.has(group.system.key);
      const compactCount =
        index < COMPACT_GROUPS && isOpen ? Math.min(group.structures.length, COMPACT_PER_GROUP) : 0;
      return {
        key: group.system.key,
        label: group.system.label,
        hex: group.system.hex,
        all: group.structures,
        visible: isOpen ? (open ? group.structures : group.structures.slice(0, COMPACT_PER_GROUP)) : [],
        compactCount,
        open: isOpen,
        isExtra: index >= COMPACT_GROUPS,
      };
    });

  // Pendant le repli, on affiche encore l'état étendu : les lignes qui
  // partent doivent exister dans le DOM pour pouvoir s'animer.
  const displayed = build(expanded || collapsing);
  const shownCompact = build(false).reduce((n, g) => n + g.visible.length, 0);
  const hidden = structures.length - shownCompact;

  const toggleExpanded = () => {
    if (!expanded) {
      setCollapsing(false);
      setExpanded(true);
      return;
    }
    setExpanded(false);
    // Sans mouvement demandé, on démonte immédiatement : pas de délai
    // artificiel pour quelqu'un qui a désactivé les animations.
    if (reducedMotion) return;
    setCollapsing(true);
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => setCollapsing(false), COLLAPSE_MS);
  };

  const toggleGroup = (key: SystemKey) =>
    setOpenKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (groups.length === 0) {
    return <p className="anatomy-card-hint">Aucune structure n’est rattachée à cette zone dans le catalogue.</p>;
  }

  // Index de cascade : il redémarre à 0 sur le PREMIER élément réellement
  // nouveau, pour que l'animation parte de l'endroit où le regard se pose
  // plutôt que du haut d'une liste déjà visible.
  let cursor = 0;

  return (
    <div className="flex flex-col gap-2" data-anatomy-catalogue>
      {displayed.map((group) => {
        const headerIsNew = group.isExtra;
        const headerIndex = headerIsNew ? cursor++ : 0;
        return (
          <section key={group.key} data-anatomy-system={group.key}>
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={group.open}
              data-touch-target
              className={cls(
                'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]',
                headerIsNew && (collapsing ? 'anatomy-reveal-out' : 'anatomy-reveal'),
              )}
              style={revealStyle(headerIndex)}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
                style={{ backgroundColor: group.hex }}
              />
              <span className="flex-1 truncate text-[0.82rem] font-medium text-[var(--ink)]">{group.label}</span>
              <span
                data-anatomy-system-count={group.all.length}
                className="shrink-0 text-[0.7rem] tabular-nums text-[var(--ink-faint)]"
              >
                {group.all.length}
              </span>
              <span
                aria-hidden
                className="flex shrink-0 items-center text-[var(--ink-faint)] transition-transform duration-200"
                style={{ transform: group.open ? 'rotate(90deg)' : 'none' }}
              >
                <Icon name="chevronRight" size={13} />
              </span>
            </button>

            {group.visible.length > 0 && (
              <ul className="mt-0.5 flex flex-col gap-0.5 pl-1">
                {group.visible.map((structure, i) => {
                  // Une ligne est « nouvelle » si elle n'était pas listée dans
                  // l'état compact : c'est elle, et elle seule, qu'on anime.
                  const isNew = group.isExtra || i >= group.compactCount;
                  const index = isNew ? cursor++ : 0;
                  return (
                    <li
                      key={structure.id}
                      className={cls(isNew && (collapsing ? 'anatomy-reveal-out' : 'anatomy-reveal'))}
                      style={revealStyle(index)}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectStructure(structure.id)}
                        title={structure.name}
                        data-anatomy-structure-row
                        className={cls(
                          'flex w-full items-center gap-2 rounded-[var(--radius-control)] border-l-2 p-1 text-left text-[0.8rem] transition-colors',
                          structure.id === selectedId
                            ? 'bg-[var(--accent-tint)] text-[var(--accent-ink)]'
                            : 'text-[var(--ink-soft)] hover:bg-[var(--surface-2)]',
                        )}
                        // Le liseré reprend la teinte du système : la couleur
                        // du modèle 3D se prolonge jusque dans la liste.
                        style={{ borderLeftColor: group.hex }}
                      >
                        <StructureThumbnail structure={structure} size={26} />
                        <span className="truncate">{structure.name}</span>
                        {/* Distinction honnête (§7/§19) : une structure sans
                            maillage n'est pas absente du projet — elle est
                            réelle, recherchable, explicable, simplement
                            dépourvue de géométrie dans les données ouvertes.
                            C'est le cas des nerfs périphériques, que rien ici
                            ne simule. */}
                        {!structure.model3dRef && (
                          <span
                            className="ml-auto shrink-0 text-[0.62rem] text-[var(--ink-faint)]"
                            title="Géométrie 3D non disponible dans la source actuelle — structure réelle, accessible par la recherche, la fiche et l’IA."
                          >
                            cours
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {hidden > 0 && (
        <button
          type="button"
          onClick={toggleExpanded}
          data-anatomy-see-more
          data-touch-target
          aria-expanded={expanded}
          className="mt-0.5 flex items-center justify-center gap-1.5 self-center rounded-full border border-[var(--line)] px-3 py-1.5 text-[0.78rem] font-medium text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          {/* La clé fait rejouer le fondu au changement de libellé : le texte
              du bouton ne saute pas d'un mot à l'autre. */}
          <span key={expanded ? 'less' : 'more'} className="anatomy-label-swap">
            {expanded ? 'Voir moins' : `Voir plus — ${hidden} structure${hidden > 1 ? 's' : ''}`}
          </span>
          <span
            aria-hidden
            className="flex items-center transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(-90deg)' : 'rotate(90deg)' }}
          >
            <Icon name="chevronRight" size={12} />
          </span>
        </button>
      )}
    </div>
  );
}

/** Les deux premiers groupes sont ouverts d'emblée : une carte qui n'affiche
 *  que des en-têtes repliés n'apprend rien au premier coup d'œil. */
function defaultOpen(groups: { system: { key: SystemKey } }[]): ReadonlySet<SystemKey> {
  return new Set(groups.slice(0, COMPACT_GROUPS).map((g) => g.system.key));
}

const revealStyle = (index: number) => ({ '--reveal-index': Math.min(index, MAX_STAGGER) }) as CSSProperties;

const cls = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');
